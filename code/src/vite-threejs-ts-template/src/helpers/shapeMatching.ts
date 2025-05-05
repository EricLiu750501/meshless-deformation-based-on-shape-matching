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

import {Vector3, Object3D, Mesh, BufferGeometry, Matrix3} from 'three';


// 提取頂點
function getVerticesFromObject(object: Object3D) {
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


/**
 * 從 Apq 做極分解，取得旋轉 R
 */
function extractRotation(Apq: Matrix3): Matrix3 {
  // A^T * A
  const AtA = Apq.clone().transpose().multiply(Apq);
  
  // S = sqrt(AtA)，要用 SVD 或 Eigen decomposition
  // 這裡簡化：若用 Three.js 沒有直接的方法，需要自己實作
  // 先假設 AtA 是對稱的，可以用近似方法
  const S = AtA.clone(); // <- TODO:這裡應該要做平方根，可以找庫支援
  
  // R = Apq * S^-1
  const Sinv = S.clone().invert();
  const R = Apq.clone().multiply(Sinv);
  
  return R;
}

function root()

function shapeMatching(object: Object3D, targetVertices: Vector3[]) {
    const originalVertices = getVerticesFromObject(object);
    const originalCentroid = calculateCentroid(originalVertices);
    const targetCentroid = calculateCentroid(targetVertices);
    if (originalVertices.length != targetVertices.length) {
        throw new Error("Initial and target shapes must have the same number of vertices.");
    }
    // console.log(vertices);
    // console.log(targetVertices);
    // 這裡可以進行形狀匹配的邏輯
    // 例如，計算頂點之間的距離，或使用其他算法來比較形狀
}




export { getVerticesFromObject, shapeMatching};
