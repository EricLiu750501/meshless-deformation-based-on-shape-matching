// 頂點格式： [x, y, z]
// const vertices = [
//   -0.5, -0.5, -0.5,  // 點 0
//    0.5, -0.5, -0.5,  // 點 1
//    0.5,  0.5, -0.5,  // 點 2
//   -0.5,  0.5, -0.5,  // 點 3
//   -0.5, -0.5,  0.5,  // 點 4
//    0.5, -0.5,  0.5,  // 點 5
//    0.5,  0.5,  0.5,  // 點 6
//   -0.5,  0.5,  0.5   // 點 7
// ];

// import * as THREE from 'three';

import {Vector3, Object3D, Mesh, BufferGeometry, Matrix3, BufferAttribute} from 'three';


// 提取頂點
function getVerticesFromObject(object: Object3D) : Vector3[] {
    const vertices: Vector3[] = [];
    // 如果物件是 Group，需要遍歷所有 children
    object.traverse((child) => {
        if (child instanceof Mesh) {
            const geometry = child.geometry;

            if (geometry instanceof BufferGeometry) {
                const positionAttribute = geometry.attributes.position;

                // 取得所有頂點
                for (let i = 0; i < positionAttribute.count; i++) {
                    const vertex = new Vector3(
                        positionAttribute.getX(i),
                        positionAttribute.getY(i),
                        positionAttribute.getZ(i)
                    );
                    vertices.push(vertex);
                }

                // 顯示頂點
                // console.log(vertices);
            }
        }
    });
    return vertices;
}


export function getWorldVertices(mesh: Mesh): Vector3[] {
    const geometry = mesh.geometry as BufferGeometry;
    const positionAttr = geometry.attributes.position as BufferAttribute;

    const vertices: Vector3[] = [];
    for (let i = 0; i < positionAttr.count; i++) {
        const vertex = new Vector3().fromBufferAttribute(positionAttr, i);
        mesh.localToWorld(vertex); // 轉成世界座標
        vertices.push(vertex);
    }
    return vertices;
}

export function getAllWorldVertices(object: Object3D): Vector3[] {
    const worldVertices: Vector3[] = []

    object.traverse((child) => {
        if (child instanceof Mesh) {
            const geometry = child.geometry as BufferGeometry
            const positionAttr = geometry.attributes.position as BufferAttribute

            for (let i = 0; i < positionAttr.count; i++) {
                const vertex = new Vector3().fromBufferAttribute(positionAttr, i)
                child.localToWorld(vertex)
                worldVertices.push(vertex)
            }
        }
    })

    return worldVertices
}

/**
 * Calculate the centroid (mean position) of a set of vertices
 * @param shape - An array of 3D vertices (Vector3), Assume that all vertices weight = 1
 * @returns The centroid as a Vector3
 */
function calculateCentroid(shape: Vector3[]): Vector3 {
    const sum = new Vector3();

    for (let i = 0; i < shape.length; i++) {
        sum.add(shape[i]);
    }

    return sum.divideScalar(shape.length);
}

function calculateRelatedPosition(shape: Vector3[], centroid: Vector3): Vector3[] {
    const relatedPosition: Vector3[] = [];

    // 遍歷每個頂點，並計算其相對於質心的位置
    for (let i = 0; i < shape.length; i++) {
        const vertex = shape[i];
        const relativePos = vertex.clone().sub(centroid);
        relatedPosition.push(relativePos);
    }

    return relatedPosition;
}


// P is current RelatedPosition, Q is init RelatedPosition. 
function calculateA_pq(p:Vector3[], q:Vector3[], masses:number[]):Matrix3 {
    const A_pq = new Matrix3();
    for (let i = 0; i < p.length; i++) {
        const pi = p[i];
        const qi = q[i];
        const m = masses[i];
        // 外積
        const outerProduct = new Matrix3().set(
            qi.x * pi.x, qi.x * pi.y, qi.x * pi.z,
            qi.y * pi.x, qi.y * pi.y, qi.y * pi.z,
            qi.z * pi.x, qi.z * pi.y, qi.z * pi.z
        ).multiplyScalar(m);
        A_pq.elements.forEach((val, idx) => {
            A_pq.elements[idx] += outerProduct.elements[idx];
        });
    }
    return A_pq;

}

function addMatrix3(a: Matrix3, b: Matrix3): Matrix3 {
    const ae = a.elements;
    const be = b.elements;
    const result = new Matrix3();
    const re = result.elements;

    for (let i = 0; i < 9; i++) {
        re[i] = ae[i] + be[i];
    }

    return result;
}


/**
 * 從 Apq 做極分解，取得旋轉 R
 */
function extractRotation(Apq: Matrix3): Matrix3 {
    let R = Apq.clone();
    const tmp = new Matrix3();
    const RT = new Matrix3();

    const maxIterations = 10;
    for (let i = 0; i < maxIterations; i++) {
        RT.copy(R).transpose();
        tmp.copy(R).invert().transpose(); // approximate inverse transpose

        R = addMatrix3(R, tmp).multiplyScalar(0.5);
    }

    return R;
}


function shapeMatching(object: Object3D, targetVertices: Vector3[], targetCentroid: Vector3, masses: number[]) {
    const currentVertices = getAllWorldVertices(object);
    const numPoints = currentVertices.length;

    console.group("shapeMatching");
    console.log("currentVertices", currentVertices);
    console.log("currentCentroid", object.position);
    console.log("targetVertices", targetVertices);
    console.log("targetCentroid", targetCentroid);
    console.groupEnd();

    if (targetVertices.length !== numPoints || masses.length !== numPoints) {
        throw new Error("Vertex count mismatch");
    }

    // Step 1: Compute centroids
    const currentCentroid = object.position.clone();

    // Step 2: Compute relative positions
    const p = calculateRelatedPosition(currentVertices, currentCentroid);
    const q = calculateRelatedPosition(targetVertices, targetCentroid);

    // Step 3: Compute A_pq
    const A_pq = calculateA_pq(p, q, masses);

    // Step 4: Extract rotation
    const R = extractRotation(A_pq);

    // Step 5: Apply transformation to original (target) shape
    const newVertices:Vector3[] = [];
    for (let i = 0; i < numPoints; i++) {
        const rotated = q[i].clone().applyMatrix3(R);
        const newPos = rotated.add(currentCentroid);
        newVertices.push(newPos);
    }

    // Step 6: 將新頂點位置寫入 geometry
    object.traverse((child) => {
        if (child instanceof Mesh) {
            const geometry = child.geometry;
            if (geometry instanceof BufferGeometry) {
                const positionAttr = geometry.attributes.position;
                for (let i = 0; i < newVertices.length; i++) {
                    const v = newVertices[i];
                    positionAttr.setXYZ(i, v.x, v.y, v.z);
                }
                positionAttr.needsUpdate = true;
            }
        }
    });
}




export { getVerticesFromObject, shapeMatching};
