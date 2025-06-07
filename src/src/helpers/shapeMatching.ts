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

// Deformation types
export type DeformationType = 'rotation' | 'linear' | 'quadratic';

// Interface for simulation parameters
export interface ShapeMatchingParams {
  deformationType: DeformationType;
  beta: number;
  tau: number;
  perturbation: number;
  dampingFactor: number;
  fixedVertices?: Set<number>; // Optional set of vertex indices that should not be deformed
}

// Physics state interface for enhanced shape matching
export interface PhysicsState {
  positions: Vector3[]
  velocities: Vector3[]
  forces: Vector3[]
  masses: number[]
  restPositions: Vector3[]
  Q: Matrix3[]
  AqqInv: Matrix3
}

// 提取頂點
export function getVerticesFromObject(object: Object3D) : Vector3[] {
    // Debug: Log object info
    console.log("getVerticesFromObject - Processing object:", object);
    const vertices: Vector3[] = [];
    object.traverse((child) => {
        if (child instanceof Mesh) {
            const geometry = child.geometry as BufferGeometry;
            if (!geometry.attributes.position) {
                console.warn(`getVerticesFromObject: Mesh child '${child.name}' has no position attribute.`);
                return;
            }
            const positionAttr = geometry.attributes.position;
            // Debug: Log attribute info
            if (positionAttr.count < 1 || positionAttr.itemSize !== 3) {
                console.warn(`getVerticesFromObject: Invalid position attribute at mesh '${child.name}', count=${positionAttr.count}, itemSize=${positionAttr.itemSize}`);
                return;
            }
            // Log a sample
            console.log("Position attribute data sample:", {
                array: Array.from(positionAttr.array).slice(0, 3),
                itemSize: positionAttr.itemSize,
                normalized: positionAttr.normalized
            });
            for (let i = 0; i < positionAttr.count; i++) {
                const v = new Vector3();
                v.fromBufferAttribute(positionAttr, i);
                if (!isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z) ||
                    isNaN(v.x) || isNaN(v.y) || isNaN(v.z)) {
                    console.error(`Invalid vertex coordinates at index ${i}: x=${v.x}, y=${v.y}, z=${v.z}`);
                    vertices.push(new Vector3(0, 0, 0));
                } else {
                    vertices.push(v);
                }
            }
        }
    });
    return vertices;
}


export function getWorldVertices(mesh: Mesh): Vector3[] {
    const geometry = mesh.geometry as BufferGeometry;
    const positionAttr = geometry.attributes.position as BufferAttribute;

    // Validate position attribute
    if (!positionAttr) {
        console.warn("Missing position attribute in mesh geometry");
        return [];
    }    // First, validate the mesh's transform matrix
    // Force matrix world update to ensure we have current transformation
    mesh.updateMatrixWorld(true);
    
    const matrix = mesh.matrixWorld;
    let validMatrix = true;
    
    for (let j = 0; j < 16; j++) {
        if (!isFinite(matrix.elements[j]) || isNaN(matrix.elements[j])) {
            console.error(`Invalid matrix element at index ${j}: ${matrix.elements[j]}`);
            validMatrix = false;
            break;
        }
    }
    
    if (!validMatrix) {
        console.error("Invalid transformation matrix detected for mesh, returning empty array");
        return [];
    }

    // Also check mesh's position, scale, rotation
    const pos = mesh.position;
    const scale = mesh.scale;
    const rotation = mesh.rotation;
    
    if (!isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z) ||
        !isFinite(scale.x) || !isFinite(scale.y) || !isFinite(scale.z) ||
        !isFinite(rotation.x) || !isFinite(rotation.y) || !isFinite(rotation.z)) {
        console.error("Invalid mesh transform properties:", {
            position: pos,
            scale: scale,
            rotation: rotation
        });
        return [];
    }

    const vertices: Vector3[] = [];
    for (let i = 0; i < positionAttr.count; i++) {
        try {
            const vertex = new Vector3().fromBufferAttribute(positionAttr, i);
            
            // Validate vertex before transformation
            if (vertex.x === undefined || vertex.y === undefined || vertex.z === undefined) {
                console.warn(`Vertex at index ${i} has undefined properties before transformation: x=${vertex.x}, y=${vertex.y}, z=${vertex.z}`);
                vertices.push(new Vector3(0, 0, 0));
                continue;
            }
            
            if (!isFinite(vertex.x) || !isFinite(vertex.y) || !isFinite(vertex.z) ||
                isNaN(vertex.x) || isNaN(vertex.y) || isNaN(vertex.z)) {
                console.warn(`Invalid vertex before transformation at index ${i}: x=${vertex.x}, y=${vertex.y}, z=${vertex.z}`);
                vertices.push(new Vector3(0, 0, 0));
                continue;
            }
              // Debug: Log the vertex before transformation
            if (i < 3) {
                console.log(`getWorldVertices - Before transform vertex ${i}: (${vertex.x}, ${vertex.y}, ${vertex.z})`);
                console.log(`Matrix elements before localToWorld:`, matrix.elements);
            }
            
            // CRITICAL FIX: Check matrix elements before transformation
            const hasInfiniteMatrix = matrix.elements.some(element => 
                !isFinite(element) || isNaN(element) || element === Infinity || element === -Infinity
            );
            
            if (hasInfiniteMatrix) {
                console.error(`Matrix contains infinite values before localToWorld transformation at vertex ${i}:`, matrix.elements);
                console.error(`Mesh details:`, {
                    position: mesh.position,
                    rotation: mesh.rotation,
                    scale: mesh.scale,
                    matrixWorld: mesh.matrixWorld.elements
                });
                // Reset the matrix to identity to prevent corruption
                mesh.matrixWorld.identity();
                mesh.position.set(0, 0, 0);
                mesh.rotation.set(0, 0, 0);
                mesh.scale.set(1, 1, 1);
                mesh.updateMatrixWorld(true);
                console.warn(`Reset corrupted matrix for mesh, using identity matrix`);
            }
            
            mesh.localToWorld(vertex); // 轉成世界座標
            
            // Debug: Log the vertex after transformation
            if (i < 3) {
                console.log(`getWorldVertices - After transform vertex ${i}: (${vertex.x}, ${vertex.y}, ${vertex.z})`);
            }
            
            // Validate vertex after transformation
            if (vertex.x === undefined || vertex.y === undefined || vertex.z === undefined) {
                console.warn(`Vertex at index ${i} has undefined properties after transformation: x=${vertex.x}, y=${vertex.y}, z=${vertex.z}`);
                vertices.push(new Vector3(0, 0, 0));
                continue;
            }
            
            if (!isFinite(vertex.x) || !isFinite(vertex.y) || !isFinite(vertex.z) ||
                isNaN(vertex.x) || isNaN(vertex.y) || isNaN(vertex.z)) {
                console.warn(`Invalid vertex after transformation at index ${i}: x=${vertex.x}, y=${vertex.y}, z=${vertex.z}`);
                vertices.push(new Vector3(0, 0, 0));
                continue;
            }
            
            vertices.push(vertex);
        } catch (error) {
            console.error(`Error processing vertex at index ${i}:`, error);
            vertices.push(new Vector3(0, 0, 0));
        }
    }
    return vertices;
}

export function getAllWorldVertices(object: Object3D): Vector3[] {
    const vertices: Vector3[] = [];
    object.traverse((child) => {
        if (child instanceof Mesh) {
            const geometry = child.geometry as BufferGeometry;
            if (!geometry.attributes.position) {
                console.warn(`getAllWorldVertices: Mesh child '${child.name}' has no position attribute.`);
                return; // Skip this mesh
            }
            const positionAttribute = geometry.attributes.position;

            // Ensure matrixWorld is up-to-date
            child.updateMatrixWorld(true);
            const matrix = child.matrixWorld;

            // Check for corrupted matrix
            const hasInfiniteMatrix = matrix.elements.some(element =>
                !isFinite(element) || isNaN(element) || element === Infinity || element === -Infinity
            );

            if (hasInfiniteMatrix) {
                console.error(`getAllWorldVertices: Matrix for child '${child.name}' contains infinite/NaN values. Elements:`, matrix.elements);
                // Add placeholder vertices if matrix is corrupt, then skip this child
                for (let i = 0; i < positionAttribute.count; i++) {
                    vertices.push(new Vector3(0, 0, 0));
                }
                return; // Skip further processing for this child
            }

            for (let i = 0; i < positionAttribute.count; i++) {
                const localVertex = new Vector3();
                // Read local vertex from buffer
                localVertex.fromBufferAttribute(positionAttribute, i);

                // Validate local vertex coordinates (before world transformation)
                if (!isFinite(localVertex.x) || !isFinite(localVertex.y) || !isFinite(localVertex.z) ||
                    isNaN(localVertex.x) || isNaN(localVertex.y) || isNaN(localVertex.z)) {
                    console.error(`getAllWorldVertices: Invalid LOCAL vertex coordinates at index ${i} for child '${child.name}': (${localVertex.x}, ${localVertex.y}, ${localVertex.z}). Using (0,0,0) instead.`);
                    vertices.push(new Vector3(0, 0, 0)); // Push a default valid vertex
                    continue; // Skip to next vertex
                }

                // Transform local vertex to world coordinates
                const worldVertex = localVertex.clone().applyMatrix4(matrix);

                // Validate world vertex coordinates (after world transformation)
                if (!isFinite(worldVertex.x) || !isFinite(worldVertex.y) || !isFinite(worldVertex.z) ||
                    isNaN(worldVertex.x) || isNaN(worldVertex.y) || isNaN(worldVertex.z)) {
                    console.error(`getAllWorldVertices: Invalid WORLD vertex coordinates at index ${i} for child '${child.name}' after transformation: (${worldVertex.x}, ${worldVertex.y}, ${worldVertex.z}). Using (0,0,0) instead.`);
                    vertices.push(new Vector3(0, 0, 0)); // Push a default valid vertex
                } else {
                    vertices.push(worldVertex);
                }
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
// function calculateCentroid(shape: Vector3[]): Vector3 {
//     const sum = new Vector3();
//
//     for (let i = 0; i < shape.length; i++) {
//         sum.add(shape[i]);
//     }
//
//     return sum.divideScalar(shape.length);
// }

/**
 * Calculate the centroid (mean position) of a set of vertices with masses
 * @param vertices - An array of 3D vertices (Vector3)
 * @param masses - Array of masses corresponding to each vertex
 * @returns The weighted centroid as a Vector3
 */
function calculateCentroidWithMasses(vertices: Vector3[], masses: number[]): Vector3 {
    if (vertices.length !== masses.length) {
        throw new Error("Vertices and masses arrays must have the same length");
    }
    
    if (vertices.length === 0) {
        return new Vector3(0, 0, 0);
    }

    // Debug: Log inputs
    console.log("calculateCentroidWithMasses - Input validation:");
    console.log(`vertices.length=${vertices.length}, masses.length=${masses.length}`);
    for (let i = 0; i < Math.min(3, vertices.length); i++) {
        const v = vertices[i];
        const m = masses[i];
        console.log(`Input ${i}: vertex=(${v.x}, ${v.y}, ${v.z}), mass=${m}`);
    }

    const weightedSum = new Vector3();
    let totalMass = 0;

    for (let i = 0; i < vertices.length; i++) {
        const vertex = vertices[i];
        const mass = masses[i];
        
        // Validate vertex and mass
        if (!vertex || !isFinite(vertex.x) || !isFinite(vertex.y) || !isFinite(vertex.z) ||
            isNaN(vertex.x) || isNaN(vertex.y) || isNaN(vertex.z)) {
            console.warn(`Invalid vertex at index ${i} in calculateCentroidWithMasses:`, vertex);
            continue;
        }
        
        if (!isFinite(mass) || isNaN(mass) || mass <= 0) {
            console.warn(`Invalid mass at index ${i} in calculateCentroidWithMasses:`, mass);
            continue;
        }
        
        const weightedVertex = vertex.clone().multiplyScalar(mass);
        weightedSum.add(weightedVertex);
        totalMass += mass;
    }

    if (totalMass === 0) {
        // If all masses are zero, return simple centroid
        console.warn("Total mass is zero, calculating simple centroid");
        const sum = new Vector3();
        for (let i = 0; i < vertices.length; i++) {
            const vertex = vertices[i];
            if (vertex && isFinite(vertex.x) && isFinite(vertex.y) && isFinite(vertex.z)) {
                sum.add(vertex);
            }
        }
        return sum.divideScalar(vertices.length);
    }

    const result = weightedSum.divideScalar(totalMass);
    
    // Debug: Log result
    console.log(`calculateCentroidWithMasses result: (${result.x}, ${result.y}, ${result.z}), totalMass=${totalMass}`);
    
    // Validate result
    if (!isFinite(result.x) || !isFinite(result.y) || !isFinite(result.z) ||
        isNaN(result.x) || isNaN(result.y) || isNaN(result.z)) {
        console.error("Invalid centroid computed:", result);
        return new Vector3(0, 0, 0);
    }
    
    return result;
}

function calculateRelatedPosition(shape: Vector3[], centroid: Vector3): Vector3[] {
    const relatedPosition: Vector3[] = [];

    // Debug: Log inputs
    console.log("calculateRelatedPosition - Input validation:");
    console.log(`shape.length=${shape.length}, centroid=(${centroid.x}, ${centroid.y}, ${centroid.z})`);

    // Validate inputs
    if (!centroid || !isFinite(centroid.x) || !isFinite(centroid.y) || !isFinite(centroid.z) ||
        isNaN(centroid.x) || isNaN(centroid.y) || isNaN(centroid.z)) {
        console.error("Invalid centroid in calculateRelatedPosition:", centroid);
        return shape.map(() => new Vector3(0, 0, 0));
    }    // 遍歷每個頂點，並計算其相對於質心的位置
    for (let i = 0; i < shape.length; i++) {
        const vertex = shape[i];
        
        // Validate vertex - check for undefined properties first
        if (!vertex) {
            console.warn(`Null vertex at index ${i} in calculateRelatedPosition`);
            relatedPosition.push(new Vector3(0, 0, 0));
            continue;
        }
        
        // Check if properties exist
        if (vertex.x === undefined || vertex.y === undefined || vertex.z === undefined) {
            console.warn(`Vertex at index ${i} has undefined properties: x=${vertex.x}, y=${vertex.y}, z=${vertex.z}`, vertex);
            relatedPosition.push(new Vector3(0, 0, 0));
            continue;
        }
        
        // Check if properties are valid numbers
        if (!isFinite(vertex.x) || !isFinite(vertex.y) || !isFinite(vertex.z) ||
            isNaN(vertex.x) || isNaN(vertex.y) || isNaN(vertex.z)) {
            console.warn(`Invalid vertex at index ${i} in calculateRelatedPosition: x=${vertex.x}, y=${vertex.y}, z=${vertex.z}`, vertex);
            relatedPosition.push(new Vector3(0, 0, 0));
            continue;
        }
        
        const relativePos = vertex.clone().sub(centroid);
        
        // Debug: Log first few calculations
        if (i < 3) {
            console.log(`RelatedPosition ${i}: vertex=(${vertex.x}, ${vertex.y}, ${vertex.z}) - centroid=(${centroid.x}, ${centroid.y}, ${centroid.z}) = (${relativePos.x}, ${relativePos.y}, ${relativePos.z})`);
        }
        
        // Validate result
        if (!isFinite(relativePos.x) || !isFinite(relativePos.y) || !isFinite(relativePos.z) ||
            isNaN(relativePos.x) || isNaN(relativePos.y) || isNaN(relativePos.z)) {
            console.warn(`Invalid relative position computed at index ${i}:`, relativePos);
            relatedPosition.push(new Vector3(0, 0, 0));
            continue;
        }
        
        relatedPosition.push(relativePos);
    }

    return relatedPosition;
}


// P is current RelatedPosition, Q is init RelatedPosition. 
function calculateA_pq(p:Vector3[], q:Vector3[], masses:number[]):Matrix3 {
    // Validate inputs
    if (p.length !== q.length || p.length !== masses.length) {
        console.warn("Mismatched array lengths in calculateA_pq, returning identity");
        return new Matrix3().identity();
    }
    
    if (p.length === 0) {
        console.warn("Empty arrays in calculateA_pq, returning identity");
        return new Matrix3().identity();
    }      // Debug: Log the first few elements to see what's going on
    console.log("Debug calculateA_pq - First 3 elements:");
    for (let i = 0; i < Math.min(3, p.length); i++) {
        console.log(`Index ${i}: p=(${p[i].x}, ${p[i].y}, ${p[i].z}), q=(${q[i].x}, ${q[i].y}, ${q[i].z}), mass=${masses[i]}`);
    }
    console.log(`Total elements: p.length=${p.length}, q.length=${q.length}, masses.length=${masses.length}`);
    
    const A_pq = new Matrix3();
    for (let i = 0; i < p.length; i++) {
        const pi = p[i];
        const qi = q[i];
        const m = masses[i];
        
        // Validate individual vectors and mass
        if (!isFinite(pi.x) || !isFinite(pi.y) || !isFinite(pi.z) ||
            !isFinite(qi.x) || !isFinite(qi.y) || !isFinite(qi.z) ||
            !isFinite(m) || isNaN(pi.x) || isNaN(pi.y) || isNaN(pi.z) ||
            isNaN(qi.x) || isNaN(qi.y) || isNaN(qi.z) || isNaN(m)) {
            console.warn(`Invalid data at index ${i} in calculateA_pq, skipping`);
            continue;
        }
          // 外積 - pi ⊗ qi (pi * qi^T for shape matching)
        const outerProduct = new Matrix3().set(
            pi.x * qi.x, pi.x * qi.y, pi.x * qi.z,
            pi.y * qi.x, pi.y * qi.y, pi.y * qi.z,
            pi.z * qi.x, pi.z * qi.y, pi.z * qi.z
        ).multiplyScalar(m);
        
        // Validate outer product before adding
        const validOuterProduct = outerProduct.elements.every(val => isFinite(val) && !isNaN(val));
        if (!validOuterProduct) {
            console.warn(`Invalid outer product at index ${i} in calculateA_pq, skipping`);
            continue;
        }
        
        A_pq.elements.forEach((_, idx) => {
            A_pq.elements[idx] += outerProduct.elements[idx];
        });
    }
    
    // Final validation of result
    const validResult = A_pq.elements.every(val => isFinite(val) && !isNaN(val));
    if (!validResult) {
        console.warn("Invalid result matrix in calculateA_pq, returning identity");
        return new Matrix3().identity();
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
 * Calculate quadratic terms for each vertex
 * @param q - relative positions from centroid
 * @returns Array of 9-element vectors containing [x, y, z, x², y², z², xy, yz, zx]
 */
function calculateQuadraticTerms(q: Vector3[]): number[][] {
    const quadraticTerms: number[][] = [];
    
    for (const qi of q) {
        const qTilde = [
            qi.x, qi.y, qi.z,                    // linear terms
            qi.x * qi.x, qi.y * qi.y, qi.z * qi.z, // quadratic terms
            qi.x * qi.y, qi.y * qi.z, qi.z * qi.x  // cross terms
        ];
        quadraticTerms.push(qTilde);
    }
    
    return quadraticTerms;
}

/**
 * Create 9x9 matrix for quadratic deformation
 */
function calculateAqqInvQuadratic(qQuadratic: number[][], masses: number[], perturbation: number = 1e-6): number[][] {
    // Initialize 9x9 matrix
    const Aqq = Array(9).fill(0).map(() => Array(9).fill(0));
    
    // Build Aqq matrix
    for (let i = 0; i < qQuadratic.length; i++) {
        const qi = qQuadratic[i];
        const mass = masses[i];
        
        for (let j = 0; j < 9; j++) {
            for (let k = 0; k < 9; k++) {
                Aqq[j][k] += mass * qi[j] * qi[k];
            }
        }
    }
    
    // Add regularization (perturbation to diagonal)
    for (let i = 0; i < 9; i++) {
        Aqq[i][i] += perturbation;
    }
    
    // Simple matrix inversion for 9x9 (using Gaussian elimination)
    return invertMatrix9x9(Aqq);
}

/**
 * Simple 9x9 matrix inversion using Gaussian elimination
 */
function invertMatrix9x9(matrix: number[][]): number[][] {
    const n = 9;
    const augmented = matrix.map((row, i) => [
        ...row,
        ...Array(n).fill(0).map((_, j) => i === j ? 1 : 0)
    ]);
    
    // Forward elimination
    for (let i = 0; i < n; i++) {
        // Find pivot
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
                maxRow = k;
            }
        }
        
        // Swap rows
        [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
        
        // Make diagonal element 1
        const pivot = augmented[i][i];
        if (Math.abs(pivot) < 1e-10) continue; // Skip singular matrix
        
        for (let k = 0; k < 2 * n; k++) {
            augmented[i][k] /= pivot;
        }
        
        // Eliminate column
        for (let k = 0; k < n; k++) {
            if (k !== i) {
                const factor = augmented[k][i];
                for (let j = 0; j < 2 * n; j++) {
                    augmented[k][j] -= factor * augmented[i][j];
                }
            }
        }
    }
    
    // Extract inverse matrix
    return augmented.map(row => row.slice(n));
}

/**
 * Calculate ApqTilde (3x9 matrix) for quadratic deformation
 */
function calculateApqTilde(p: Vector3[], qQuadratic: number[][], masses: number[]): number[][] {
    const ApqTilde = Array(3).fill(0).map(() => Array(9).fill(0));
    
    for (let i = 0; i < p.length; i++) {
        const pi = p[i];
        const qTilde = qQuadratic[i];
        const mass = masses[i];
        
        // ApqTilde += mass * pi * qTilde^T
        ApqTilde[0][0] += mass * pi.x * qTilde[0]; // x * x
        ApqTilde[0][1] += mass * pi.x * qTilde[1]; // x * y
        ApqTilde[0][2] += mass * pi.x * qTilde[2]; // x * z
        ApqTilde[0][3] += mass * pi.x * qTilde[3]; // x * x²
        ApqTilde[0][4] += mass * pi.x * qTilde[4]; // x * y²
        ApqTilde[0][5] += mass * pi.x * qTilde[5]; // x * z²
        ApqTilde[0][6] += mass * pi.x * qTilde[6]; // x * xy
        ApqTilde[0][7] += mass * pi.x * qTilde[7]; // x * yz
        ApqTilde[0][8] += mass * pi.x * qTilde[8]; // x * zx
        
        ApqTilde[1][0] += mass * pi.y * qTilde[0]; // y * x
        ApqTilde[1][1] += mass * pi.y * qTilde[1]; // y * y
        ApqTilde[1][2] += mass * pi.y * qTilde[2]; // y * z
        ApqTilde[1][3] += mass * pi.y * qTilde[3]; // y * x²
        ApqTilde[1][4] += mass * pi.y * qTilde[4]; // y * y²
        ApqTilde[1][5] += mass * pi.y * qTilde[5]; // y * z²
        ApqTilde[1][6] += mass * pi.y * qTilde[6]; // y * xy
        ApqTilde[1][7] += mass * pi.y * qTilde[7]; // y * yz
        ApqTilde[1][8] += mass * pi.y * qTilde[8]; // y * zx
        
        ApqTilde[2][0] += mass * pi.z * qTilde[0]; // z * x
        ApqTilde[2][1] += mass * pi.z * qTilde[1]; // z * y
        ApqTilde[2][2] += mass * pi.z * qTilde[2]; // z * z
        ApqTilde[2][3] += mass * pi.z * qTilde[3]; // z * x²
        ApqTilde[2][4] += mass * pi.z * qTilde[4]; // z * y²
        ApqTilde[2][5] += mass * pi.z * qTilde[5]; // z * z²
        ApqTilde[2][6] += mass * pi.z * qTilde[6]; // z * xy
        ApqTilde[2][7] += mass * pi.z * qTilde[7]; // z * yz
        ApqTilde[2][8] += mass * pi.z * qTilde[8]; // z * zx
    }
    
    return ApqTilde;
}

/**
 * Matrix multiplication for 3x9 and 9x9 matrices
 */
function multiplyMatrix3x9_9x9(A: number[][], B: number[][]): number[][] {
    const result = Array(3).fill(0).map(() => Array(9).fill(0));
    
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 9; j++) {
            for (let k = 0; k < 9; k++) {
                result[i][j] += A[i][k] * B[k][j];
            }
        }
    }
    
    return result;
}

/**
 * Matrix multiplication for 3x9 and 9xN matrices (where N is number of vertices)
 */

/**
 * Extract rotation matrix using Gram-Schmidt orthogonalization
 * This is used as a fallback when polar decomposition fails
 */
// Note: computeMatrixInverseSqrt function removed as we now use more stable polar decomposition

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


export function shapeMatching(object: Object3D, targetVertices: Vector3[], targetCentroid: Vector3, masses: number[], dampingFactor: number = 0.1) {
    const currentVertices = getAllWorldVertices(object);
    const numPoints = currentVertices.length;

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

    // Step 6: Apply damping to make the transition more gradual
    object.traverse((child) => {
        if (child instanceof Mesh) {
            const geometry = child.geometry;
            if (geometry instanceof BufferGeometry) {
                const positionAttr = geometry.attributes.position;
                for (let i = 0; i < Math.min(newVertices.length, positionAttr.count); i++) {
                    const currentPos = new Vector3(
                        positionAttr.getX(i),
                        positionAttr.getY(i),
                        positionAttr.getZ(i)
                    );
                    
                    // Convert new vertex from world to local space
                    const targetPos = newVertices[i].clone();
                    child.worldToLocal(targetPos);
                    
                    // Apply damping: interpolate between current and target position
                    const dampedPos = currentPos.lerp(targetPos, dampingFactor);
                    
                    // Set the new position
                    positionAttr.setXYZ(i, dampedPos.x, dampedPos.y, dampedPos.z);
                }
                positionAttr.needsUpdate = true;
            }
        }
    });
}

export function enhancedShapeMatching(
    object: Object3D, 
    targetVertices: Vector3[], 
    _targetCentroid: Vector3, // Note: Not used directly, computed from movable vertices for better fixed vertex handling
    masses: number[], 
    params: ShapeMatchingParams
) {
    // Debug: Check targetVertices for NaN values
    console.log("=== enhancedShapeMatching Debug ===");
    console.log("targetVertices length:", targetVertices.length);
    console.log("First 3 targetVertices (before coordinate conversion):");
    for (let i = 0; i < Math.min(3, targetVertices.length); i++) {
        const v = targetVertices[i];
        console.log(`Target vertex ${i}: (${v.x}, ${v.y}, ${v.z})`);
        if (!isFinite(v.x) || !isFinite(v.y) || !isFinite(v.z) ||
            isNaN(v.x) || isNaN(v.y) || isNaN(v.z)) {
            console.error(`FOUND NaN in targetVertices at index ${i}:`, v);
        }
    }

    // CRITICAL FIX: Convert target vertices to world coordinates to match currentVertices
    // The issue was that targetVertices are in local coordinates but currentVertices are in world coordinates
    const targetVerticesWorld: Vector3[] = [];
    let vertexIndex = 0;
    
    object.traverse((child) => {
        if (child instanceof Mesh) {
            const geometry = child.geometry as BufferGeometry;
            const positionAttr = geometry.attributes.position;
              for (let i = 0; i < positionAttr.count; i++) {
                if (vertexIndex < targetVertices.length) {
                    const localVertex = targetVertices[vertexIndex].clone();
                    
                    // CRITICAL FIX: Check mesh matrix before localToWorld transformation
                    child.updateMatrixWorld(true);
                    const matrix = child.matrixWorld;
                    
                    const hasInfiniteMatrix = matrix.elements.some(element => 
                        !isFinite(element) || isNaN(element) || element === Infinity || element === -Infinity
                    );
                    
                    if (hasInfiniteMatrix) {
                        console.error(`Matrix contains infinite values in enhancedShapeMatching at vertex ${vertexIndex}:`, matrix.elements);
                        console.error(`Child mesh details:`, {
                            position: child.position,
                            rotation: child.rotation,  
                            scale: child.scale
                        });
                        // Reset the matrix to identity to prevent corruption
                        child.matrixWorld.identity();
                        child.position.set(0, 0, 0);
                        child.rotation.set(0, 0, 0);
                        child.scale.set(1, 1, 1);
                        child.updateMatrixWorld(true);
                        console.warn(`Reset corrupted matrix in enhancedShapeMatching, using identity matrix`);
                    }
                    
                    // Convert from local to world coordinates
                    child.localToWorld(localVertex);
                    
                    // Validate the result
                    if (!isFinite(localVertex.x) || !isFinite(localVertex.y) || !isFinite(localVertex.z) ||
                        isNaN(localVertex.x) || isNaN(localVertex.y) || isNaN(localVertex.z)) {
                        console.error(`Invalid world vertex after transformation at index ${vertexIndex}: (${localVertex.x}, ${localVertex.y}, ${localVertex.z})`);
                        targetVerticesWorld.push(new Vector3(0, 0, 0));
                    } else {
                        targetVerticesWorld.push(localVertex);
                    }
                    
                    vertexIndex++;
                }
            }
        }
    });

    console.log("First 3 targetVertices (after world coordinate conversion):");
    for (let i = 0; i < Math.min(3, targetVerticesWorld.length); i++) {
        const v = targetVerticesWorld[i];
        console.log(`World target vertex ${i}: (${v.x}, ${v.y}, ${v.z})`);
    }

    const currentVertices = getAllWorldVertices(object);
    const numPoints = currentVertices.length;

    if (targetVerticesWorld.length !== numPoints || masses.length !== numPoints) {
        console.error("Vertex count mismatch:", {
            current: numPoints,
            target: targetVerticesWorld.length,
            masses: masses.length
        });
        return;
    }

    // Add safety checks
    if (numPoints === 0) {
        console.warn("No vertices found for shape matching");
        return;
    }

    // Check for invalid masses
    const validMasses = masses.every(m => m > 0 && isFinite(m));
    if (!validMasses) {
        console.warn("Invalid masses detected, using default values");
        masses = masses.map(() => 1.0);
    }

    // Handle fixed vertices by excluding them from shape matching calculations
    const fixedVertices = params.fixedVertices || new Set<number>();
    
    // If all vertices are fixed, don't apply any deformation
    if (fixedVertices.size >= numPoints) {
        console.warn("All vertices are fixed, skipping deformation");
        return;
    }

    // Filter out fixed vertices for shape matching calculations
    const movableIndices: number[] = [];
    const movableCurrentVertices: Vector3[] = [];
    const movableTargetVertices: Vector3[] = [];
    const movableMasses: number[] = [];    for (let i = 0; i < numPoints; i++) {
        if (!fixedVertices.has(i)) {
            movableIndices.push(i);
            movableCurrentVertices.push(currentVertices[i].clone());
            movableTargetVertices.push(targetVerticesWorld[i].clone());
            movableMasses.push(masses[i]);
        }
    }

    // If no movable vertices, skip deformation
    if (movableIndices.length === 0) {
        console.warn("No movable vertices found, skipping deformation");
        return;
    }    // Calculate centroids based only on movable vertices
    const movableCurrentCentroid = calculateCentroidWithMasses(movableCurrentVertices, movableMasses);
    const movableTargetCentroid = calculateCentroidWithMasses(movableTargetVertices, movableMasses);

    // Debug: Log centroid values
    console.log("Debug centroids:", {
        currentCentroid: movableCurrentCentroid,
        targetCentroid: movableTargetCentroid,
        numMovableVertices: movableCurrentVertices.length
    });

    // CRITICAL FIX: Use consistent centroid for q calculation and goal position reconstruction
    // Following C++ implementation pattern - use target centroid for both q calculation and reconstruction
    const p = calculateRelatedPosition(movableCurrentVertices, movableCurrentCentroid);
    const q = calculateRelatedPosition(movableTargetVertices, movableTargetCentroid);

    // Debug: Log relative positions
    console.log("Debug relative positions - First 3 elements:");
    for (let i = 0; i < Math.min(3, p.length); i++) {
        console.log(`Index ${i}: p=(${p[i].x}, ${p[i].y}, ${p[i].z}), q=(${q[i].x}, ${q[i].y}, ${q[i].z})`);
    }

    // Safety check for degenerate configurations
    const pMagnitude = Math.sqrt(p.reduce((sum, v) => sum + v.lengthSq(), 0));
    const qMagnitude = Math.sqrt(q.reduce((sum, v) => sum + v.lengthSq(), 0));
    
    if (pMagnitude < 1e-10 || qMagnitude < 1e-10) {
        console.warn("Degenerate configuration detected, skipping deformation");
        return;
    }

    let movableNewVertices: Vector3[] = [];    try {        switch (params.deformationType) {
            case 'rotation':
                movableNewVertices = computeRotationDeformation(p, q, movableMasses, movableTargetCentroid);
                break;
            case 'linear':
                movableNewVertices = computeLinearDeformation(p, q, movableMasses, movableTargetCentroid, params.beta);
                break;
            case 'quadratic':
                movableNewVertices = computeQuadraticDeformation(p, q, movableMasses, movableTargetCentroid, params.beta, params.perturbation);
                break;
        }

        // Validate computed vertices with fallback hierarchy
        const validVertices = movableNewVertices.every(v => 
            isFinite(v.x) && isFinite(v.y) && isFinite(v.z) &&
            !isNaN(v.x) && !isNaN(v.y) && !isNaN(v.z)
        );        if (!validVertices) {
            console.warn(`Invalid vertices in ${params.deformationType} deformation, trying fallback`);
              // Fallback hierarchy: quadratic -> linear -> rotation -> identity
            if (params.deformationType === 'quadratic') {
                console.log("Falling back to linear deformation");
                movableNewVertices = computeLinearDeformation(p, q, movableMasses, movableTargetCentroid, params.beta);
                
                // Validate linear fallback
                const validLinearFallback = movableNewVertices.every(v => 
                    isFinite(v.x) && isFinite(v.y) && isFinite(v.z) &&
                    !isNaN(v.x) && !isNaN(v.y) && !isNaN(v.z)
                );
                
                if (!validLinearFallback) {
                    console.log("Linear fallback failed, using rotation-only");
                    movableNewVertices = computeRotationDeformation(p, q, movableMasses, movableTargetCentroid);
                    
                    // Validate rotation fallback
                    const validRotationFallback = movableNewVertices.every(v => 
                        isFinite(v.x) && isFinite(v.y) && isFinite(v.z) &&
                        !isNaN(v.x) && !isNaN(v.y) && !isNaN(v.z)
                    );
                    
                    if (!validRotationFallback) {
                        console.log("Rotation fallback failed, using identity transformation");
                        movableNewVertices = q.map(vertex => vertex.clone().add(movableTargetCentroid));
                    }
                }
            } else if (params.deformationType === 'linear') {
                console.log("Falling back to rotation deformation");
                movableNewVertices = computeRotationDeformation(p, q, movableMasses, movableTargetCentroid);
                
                // Validate rotation fallback
                const validRotationFallback = movableNewVertices.every(v => 
                    isFinite(v.x) && isFinite(v.y) && isFinite(v.z) &&
                    !isNaN(v.x) && !isNaN(v.y) && !isNaN(v.z)
                );
                  if (!validRotationFallback) {
                    console.log("Rotation fallback failed, using identity transformation");
                    movableNewVertices = q.map(vertex => vertex.clone().add(movableTargetCentroid));
                }
            } else {
                // rotation deformation failed - use identity transformation
                console.warn("Rotation deformation failed, using identity transformation");
                movableNewVertices = q.map(vertex => vertex.clone().add(movableTargetCentroid));
            }
            
            // Final validation after all fallbacks
            const finalValidation = movableNewVertices.every(v => 
                isFinite(v.x) && isFinite(v.y) && isFinite(v.z) &&
                !isNaN(v.x) && !isNaN(v.y) && !isNaN(v.z)
            );
            
            if (!finalValidation) {
                console.error("All fallbacks failed, skipping deformation");
                return;
            }
        }

        // Reconstruct full vertex array with fixed vertices maintaining their positions
        const newVertices: Vector3[] = new Array(numPoints);
        let movableIndex = 0;

        for (let i = 0; i < numPoints; i++) {
            if (fixedVertices.has(i)) {
                // Keep fixed vertices at their current positions
                newVertices[i] = currentVertices[i].clone();
            } else {
                // Use computed positions for movable vertices
                newVertices[i] = movableNewVertices[movableIndex];
                movableIndex++;
            }
        }

        // Apply the computed deformation (fixed vertices will be skipped in applyDeformation)
        applyDeformation(object, newVertices, params.dampingFactor, params.fixedVertices);
    } catch (error) {
        console.error("Error in shape matching:", error);
    }
}

// 修復茶壺變形過大的關鍵函數
function computeRotationDeformation(
    p: Vector3[], 
    q: Vector3[], 
    masses: number[], 
    currentCentroid: Vector3
): Vector3[] {
    // 1. 添加輸入驗證和範圍檢查
    const maxDeformation = 5.0; // 限制最大變形範圍
    
    // 檢查相對位置的量級
    const pMagnitude = Math.sqrt(p.reduce((sum, v) => sum + v.lengthSq(), 0));
    const qMagnitude = Math.sqrt(q.reduce((sum, v) => sum + v.lengthSq(), 0));
    
    if (pMagnitude > maxDeformation || qMagnitude > maxDeformation) {
        console.warn(`Large deformation detected: p=${pMagnitude}, q=${qMagnitude}, clamping to safe range`);
        
        // 縮放到安全範圍
        const pScale = Math.min(1.0, maxDeformation / pMagnitude);
        const qScale = Math.min(1.0, maxDeformation / qMagnitude);
        
        p.forEach(v => v.multiplyScalar(pScale));
        q.forEach(v => v.multiplyScalar(qScale));
    }
    
    // Compute A_pq matrix
    const A_pq = calculateA_pq(p, q, masses);
    
    // 添加數值穩定性檢查
    const frobenius = Math.sqrt(A_pq.elements.reduce((sum, val) => sum + val * val, 0));
    if (frobenius < 1e-8) {
        console.warn("Degenerate A_pq matrix, using identity transformation");
        return q.map(qi => qi.clone().add(currentCentroid));
    }
    
    // 2. 限制變形矩陣的條件數
    let R: Matrix3;
    if (isCubeGeometry(q)) {
        console.log("Cube geometry detected, using special cube rotation matrix");
        R = calculateCubeRotationMatrix(A_pq);
    } else {
        // 對於復雜幾何（如 teapot），使用更穩定的旋轉提取
        R = extractRotationStableWithLimits(A_pq);
    }
    
    // 3. 應用變形並限制結果
    const newVertices: Vector3[] = [];
    for (let i = 0; i < q.length; i++) {
        const rotated = q[i].clone().applyMatrix3(R);
        let newPos = rotated.add(currentCentroid);
        
        // 限制單個頂點的位移
        const displacement = newPos.clone().sub(currentCentroid);
        if (displacement.length() > maxDeformation) {
            displacement.normalize().multiplyScalar(maxDeformation);
            newPos = currentCentroid.clone().add(displacement);
        }
        
        // 添加數值檢查
        if (!isFinite(newPos.x) || !isFinite(newPos.y) || !isFinite(newPos.z)) {
            newVertices.push(q[i].clone().add(currentCentroid));
        } else {
            newVertices.push(newPos);
        }
    }
    
    return newVertices;
}

// 改進的旋轉提取，添加條件數限制
function extractRotationStableWithLimits(Apq: Matrix3): Matrix3 {
    // 檢查矩陣條件數
    const condition = estimateConditionNumber(Apq);
    if (condition > 1e6) {
        console.warn(`High condition number detected: ${condition}, using regularization`);
        
        // 添加正則化到對角線
        const regularization = 1e-4;
        Apq.elements[0] += regularization;
        Apq.elements[4] += regularization;
        Apq.elements[8] += regularization;
    }
    
    // 使用改進的 Gram-Schmidt 正交化
    const elements = Apq.elements;
    
    // 提取列向量
    let u1 = new Vector3(elements[0], elements[3], elements[6]);
    let u2 = new Vector3(elements[1], elements[4], elements[7]);
    let u3 = new Vector3(elements[2], elements[5], elements[8]);
    
    // 限制向量的量級
    const maxVectorLength = 10.0;
    if (u1.length() > maxVectorLength) u1.normalize().multiplyScalar(maxVectorLength);
    if (u2.length() > maxVectorLength) u2.normalize().multiplyScalar(maxVectorLength);
    if (u3.length() > maxVectorLength) u3.normalize().multiplyScalar(maxVectorLength);
    
    // 數值穩定性檢查
    if (u1.length() < 1e-10) u1.set(1, 0, 0);
    if (u2.length() < 1e-10) u2.set(0, 1, 0);
    if (u3.length() < 1e-10) u3.set(0, 0, 1);
    
    // Gram-Schmidt 正交化
    u1.normalize();
    
    // u2 正交於 u1
    u2.sub(u1.clone().multiplyScalar(u2.dot(u1)));
    if (u2.length() < 1e-10) {
        // 選擇與 u1 垂直的向量
        if (Math.abs(u1.x) < 0.9) {
            u2.set(1, 0, 0);
        } else {
            u2.set(0, 1, 0);
        }
        u2.sub(u1.clone().multiplyScalar(u2.dot(u1)));
    }
    u2.normalize();
    
    // u3 = u1 × u2 確保右手坐標系
    u3.crossVectors(u1, u2);
    if (u3.length() < 1e-10) {
        u3.set(0, 0, 1);
        u3.sub(u1.clone().multiplyScalar(u3.dot(u1)));
        u3.sub(u2.clone().multiplyScalar(u3.dot(u2)));
    }
    u3.normalize();
    
    // 確保行列式為正（右手坐標系）
    const det = u1.dot(new Vector3().crossVectors(u2, u3));
    if (det < 0) {
        u3.multiplyScalar(-1);
    }
    
    return new Matrix3().set(
        u1.x, u2.x, u3.x,
        u1.y, u2.y, u3.y,
        u1.z, u2.z, u3.z
    );
}

// 估算矩陣條件數
function estimateConditionNumber(matrix: Matrix3): number {
    const elements = matrix.elements;
    
    // 簡單的 Frobenius 範數估算
    const frobeniusNorm = Math.sqrt(elements.reduce((sum, val) => sum + val * val, 0));
    
    // 估算最小奇異值
    const det = matrix.determinant();
    const minSingularValue = Math.abs(det) / (frobeniusNorm * frobeniusNorm);
    
    if (minSingularValue < 1e-12) {
        return 1e12; // 很大的條件數
    }
    
    return frobeniusNorm / minSingularValue;
}

// 修復線性變形函數
function computeLinearDeformation(
    p: Vector3[], 
    q: Vector3[], 
    masses: number[], 
    currentCentroid: Vector3, 
    beta: number
): Vector3[] {
    // 1. 添加輸入範圍檢查
    const maxDeformation = 5.0;
    
    const pMagnitude = Math.sqrt(p.reduce((sum, v) => sum + v.lengthSq(), 0));
    const qMagnitude = Math.sqrt(q.reduce((sum, v) => sum + v.lengthSq(), 0));
    
    if (pMagnitude > maxDeformation || qMagnitude > maxDeformation) {
        console.warn(`Large linear deformation detected, clamping to safe range`);
        
        const pScale = Math.min(1.0, maxDeformation / pMagnitude);
        const qScale = Math.min(1.0, maxDeformation / qMagnitude);
        
        p.forEach(v => v.multiplyScalar(pScale));
        q.forEach(v => v.multiplyScalar(qScale));
    }
    
    // Compute A_pq matrix
    const A_pq = calculateA_pq(p, q, masses);
    
    // Extract rotation with limits
    const R = extractRotationStableWithLimits(A_pq);
    
    // 2. 更保守的 beta 值限制
    const safeBeta = Math.min(beta, 0.3); // 進一步限制線性變形影響
    
    // Compute Aqq inverse for linear transformation
    const Aqq = new Matrix3();
    for (let i = 0; i < q.length; i++) {
        const qi = q[i];
        const mass = masses[i];
        const outerProduct = new Matrix3().set(
            qi.x * qi.x, qi.x * qi.y, qi.x * qi.z,
            qi.y * qi.x, qi.y * qi.y, qi.y * qi.z,
            qi.z * qi.x, qi.z * qi.y, qi.z * qi.z
        ).multiplyScalar(mass);
        
        Aqq.elements.forEach((_, idx) => {
            Aqq.elements[idx] += outerProduct.elements[idx];
        });
    }
    
    // 增加正則化強度
    const regularization = 1e-3; // 增加 100 倍正則化
    Aqq.elements[0] += regularization;
    Aqq.elements[4] += regularization;
    Aqq.elements[8] += regularization;
    
    // Check if matrix is invertible
    const det = Aqq.determinant();
    if (Math.abs(det) < 1e-8) { // 更嚴格的檢查
        console.warn("Singular Aqq matrix detected, using rotation only");
        return computeRotationDeformation(p, q, masses, currentCentroid);
    }
    
    // Compute linear transformation matrix A
    const A = new Matrix3().multiplyMatrices(A_pq, Aqq.clone().invert());
    
    // 3. 限制變形矩陣的元素大小
    for (let i = 0; i < 9; i++) {
        if (Math.abs(A.elements[i]) > 5.0) {
            console.warn("Large transformation matrix element detected, clamping");
            A.elements[i] = Math.sign(A.elements[i]) * 5.0;
        }
    }
    
    // Volume preservation using C++ method: A = A / cbrt(volume)
    const volume = A.determinant();
    if (Math.abs(volume) > 1e-10) {
        const volumeScale = 1.0 / Math.cbrt(Math.abs(volume));
        // 限制體積縮放因子
        const clampedVolumeScale = Math.max(0.1, Math.min(10.0, volumeScale));
        A.multiplyScalar(clampedVolumeScale);
    }
    
    // Validate transformation matrix
    const validMatrix = A.elements.every(val => isFinite(val) && !isNaN(val) && Math.abs(val) < 100);
    if (!validMatrix) {
        console.warn("Invalid transformation matrix, using rotation only");
        return computeRotationDeformation(p, q, masses, currentCentroid);
    }
    
    // Blend between rotation and linear transformation
    const T = new Matrix3();
    for (let i = 0; i < 9; i++) {
        T.elements[i] = safeBeta * A.elements[i] + (1 - safeBeta) * R.elements[i];
    }
    
    // Apply transformation with additional safety checks
    const newVertices: Vector3[] = [];
    for (let i = 0; i < q.length; i++) {
        const transformed = q[i].clone().applyMatrix3(T);
        let newPos = transformed.add(currentCentroid);
        
        // 限制單個頂點的位移
        const displacement = newPos.clone().sub(currentCentroid);
        if (displacement.length() > maxDeformation) {
            displacement.normalize().multiplyScalar(maxDeformation);
            newPos = currentCentroid.clone().add(displacement);
        }
        
        newVertices.push(newPos);
    }
    
    return newVertices;
}
// 為復雜幾何體添加穩定的旋轉提取
function extractRotationStable(Apq: Matrix3): Matrix3 {
    // 使用 Gram-Schmidt 正交化，對復雜幾何更穩定
    const elements = Apq.elements;
    
    // 提取列向量
    let u1 = new Vector3(elements[0], elements[3], elements[6]);
    let u2 = new Vector3(elements[1], elements[4], elements[7]);
    let u3 = new Vector3(elements[2], elements[5], elements[8]);
    
    // 數值穩定性檢查
    if (u1.length() < 1e-10) u1.set(1, 0, 0);
    if (u2.length() < 1e-10) u2.set(0, 1, 0);
    if (u3.length() < 1e-10) u3.set(0, 0, 1);
    
    // Gram-Schmidt 正交化
    u1.normalize();
    
    // u2 正交於 u1
    u2.sub(u1.clone().multiplyScalar(u2.dot(u1)));
    if (u2.length() < 1e-10) {
        // 選擇與 u1 垂直的向量
        if (Math.abs(u1.x) < 0.9) {
            u2.set(1, 0, 0);
        } else {
            u2.set(0, 1, 0);
        }
        u2.sub(u1.clone().multiplyScalar(u2.dot(u1)));
    }
    u2.normalize();
    
    // u3 = u1 × u2 確保右手坐標系
    u3.crossVectors(u1, u2);
    if (u3.length() < 1e-10) {
        u3.set(0, 0, 1);
        u3.sub(u1.clone().multiplyScalar(u3.dot(u1)));
        u3.sub(u2.clone().multiplyScalar(u3.dot(u2)));
    }
    u3.normalize();
    
    // 確保行列式為正（右手坐標系）
    const det = u1.dot(new Vector3().crossVectors(u2, u3));
    if (det < 0) {
        u3.multiplyScalar(-1);
    }
    
    return new Matrix3().set(
        u1.x, u2.x, u3.x,
        u1.y, u2.y, u3.y,
        u1.z, u2.z, u3.z
    );
}

// 為二次變形添加更好的數值穩定性
function computeQuadraticDeformation(
    p: Vector3[], 
    q: Vector3[], 
    masses: number[], 
    currentCentroid: Vector3, 
    beta: number, 
    perturbation: number
): Vector3[] {
    try {
        // 對於復雜幾何，增加正則化
        const adjustedPerturbation = perturbation * 10; // 增加 10 倍正則化
        
        // Calculate quadratic terms for target configuration
        const qQuadratic = calculateQuadraticTerms(q);
        
        // Calculate ApqTilde (3x9 matrix)
        const ApqTilde = calculateApqTilde(p, qQuadratic, masses);
        
        // 數值穩定性檢查
        const hasValidApqTilde = ApqTilde.every(row => 
            row.every(val => isFinite(val) && !isNaN(val))
        );
        
        if (!hasValidApqTilde) {
            console.warn("Invalid ApqTilde for complex geometry, falling back to linear");
            return computeLinearDeformation(p, q, masses, currentCentroid, beta);
        }
        
        // Calculate AqqInv for quadratic terms with increased regularization
        const AqqInvQuadratic = calculateAqqInvQuadratic(qQuadratic, masses, adjustedPerturbation);
        
        // 更嚴格的驗證
        const validInverse = AqqInvQuadratic.every(row => 
            row.every(val => isFinite(val) && !isNaN(val) && Math.abs(val) < 1e6)
        );
        
        if (!validInverse) {
            console.warn("Unstable quadratic inverse for complex geometry, falling back to linear");
            return computeLinearDeformation(p, q, masses, currentCentroid, beta);
        }
        
        // 計算線性變形用於混合
        const A_pq = calculateA_pq(p, q, masses);
        const R = extractRotationStable(A_pq);
        
        // 限制 beta 值以避免過度變形
        const safeBeta = Math.min(beta, 0.3); // 限制二次項影響
        
        // Create Rtilde (3x9) - rotation extended to quadratic space
        const Rtilde = Array(3).fill(0).map(() => Array(9).fill(0));
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                Rtilde[i][j] = R.elements[i * 3 + j];
            }
        }
        
        // Compute Atilde = ApqTilde * AqqInvQuadratic
        const Atilde = multiplyMatrix3x9_9x9(ApqTilde, AqqInvQuadratic);
        
        // 數值穩定性檢查和限制
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 9; j++) {
                if (!isFinite(Atilde[i][j]) || Math.abs(Atilde[i][j]) > 100) {
                    console.warn("Unstable Atilde values, falling back to linear");
                    return computeLinearDeformation(p, q, masses, currentCentroid, beta);
                }
            }
        }
        
        // Blend between quadratic and rotation transformation (保守混合)
        const T = Array(3).fill(0).map(() => Array(9).fill(0));
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 9; j++) {
                T[i][j] = safeBeta * Atilde[i][j] + (1 - safeBeta) * Rtilde[i][j];
            }
        }
        
        // Apply transformation to quadratic terms
        const transformedVertices: Vector3[] = [];
        for (let i = 0; i < qQuadratic.length; i++) {
            const vertex = new Vector3();
            
            // Apply transformation T to qTilde[i]
            for (let j = 0; j < 9; j++) {
                vertex.x += T[0][j] * qQuadratic[i][j];
                vertex.y += T[1][j] * qQuadratic[i][j];
                vertex.z += T[2][j] * qQuadratic[i][j];
            }
            
            // 限制變形幅度
            const maxDisplacement = 5.0; // 限制最大位移
            vertex.clampLength(0, maxDisplacement);
            
            // Validate the computed vertex
            if (!isFinite(vertex.x) || !isFinite(vertex.y) || !isFinite(vertex.z)) {
                console.warn("Invalid vertex computed in quadratic deformation, using rotation");
                const rotated = q[i].clone().applyMatrix3(R);
                transformedVertices.push(rotated.add(currentCentroid));
            } else {
                // Add current centroid
                vertex.add(currentCentroid);
                transformedVertices.push(vertex);
            }
        }
        
        return transformedVertices;
    } catch (error) {
        console.error("Error in quadratic deformation for complex geometry:", error);
        console.warn("Falling back to linear deformation");
        return computeLinearDeformation(p, q, masses, currentCentroid, beta);
    }
}
/**
 * Apply deformation to Three.js object based on computed vertex positions
 * @param object - The Three.js object to deform
 * @param newVertices - Array of new vertex positions
 * @param dampingFactor - Damping factor for smooth transitions (0-1)
 * @param fixedVertices - Optional set of vertex indices that should not be moved
 */
function applyDeformation(
    object: Object3D,
    newVertices: Vector3[],
    dampingFactor: number = 0.1,
    fixedVertices?: Set<number>
): void {
    let vertexIndex = 0;
    
    object.traverse((child) => {
        if (child instanceof Mesh) {
            const geometry = child.geometry as BufferGeometry;
            if (!geometry.attributes.position) {
                console.warn(`applyDeformation: Mesh child '${child.name}' has no position attribute.`);
                return;
            }
            
            const positionAttribute = geometry.attributes.position as BufferAttribute;
            const positionArray = positionAttribute.array as Float32Array;
            
            // Apply deformation to each vertex
            for (let i = 0; i < positionAttribute.count; i++) {
                // Skip fixed vertices
                if (fixedVertices && fixedVertices.has(vertexIndex)) {
                    vertexIndex++;
                    continue;
                }
                
                if (vertexIndex < newVertices.length) {
                    const newPos = newVertices[vertexIndex];
                    
                    // Validate new position
                    if (!isFinite(newPos.x) || !isFinite(newPos.y) || !isFinite(newPos.z) ||
                        isNaN(newPos.x) || isNaN(newPos.y) || isNaN(newPos.z)) {
                        console.warn(`Invalid new position at vertex ${vertexIndex}, skipping deformation`);
                        vertexIndex++;
                        continue;
                    }
                    
                    // Get current position
                    const currentPos = new Vector3();
                    currentPos.fromBufferAttribute(positionAttribute, i);
                    
                    // Convert world position back to local position
                    const worldToLocal = child.matrixWorld.clone().invert();
                    const localNewPos = newPos.clone().applyMatrix4(worldToLocal);
                    
                    // Apply damping for smooth transition
                    const dampedPos = new Vector3().lerpVectors(currentPos, localNewPos, 1.0 - dampingFactor);
                    
                    // Validate damped position
                    if (!isFinite(dampedPos.x) || !isFinite(dampedPos.y) || !isFinite(dampedPos.z) ||
                        isNaN(dampedPos.x) || isNaN(dampedPos.y) || isNaN(dampedPos.z)) {
                        console.warn(`Invalid damped position at vertex ${vertexIndex}, skipping deformation`);
                        vertexIndex++;
                        continue;
                    }
                    
                    // Update position attribute
                    positionArray[i * 3] = dampedPos.x;
                    positionArray[i * 3 + 1] = dampedPos.y;
                    positionArray[i * 3 + 2] = dampedPos.z;
                }
                
                vertexIndex++;
            }
            
            // Mark position attribute for update
            positionAttribute.needsUpdate = true;
            
            // Recompute normals for proper lighting
            geometry.computeVertexNormals();
        }
    });
}

// 立方體檢測和特殊處理功能
function isCubeGeometry(vertices: Vector3[]): boolean {
  if (vertices.length !== 8) return false
  
  // 檢查是否為標準立方體的8個頂點 (以原點為中心的單位立方體)
  const expectedPositions = [
    [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
    [-0.5, -0.5, 0.5],  [0.5, -0.5, 0.5],  [0.5, 0.5, 0.5],  [-0.5, 0.5, 0.5]
  ]
  
  const tolerance = 0.1
  let matchCount = 0
  
  // 對每個期望位置，檢查是否有對應的頂點
  for (const expected of expectedPositions) {
    for (const vertex of vertices) {
      if (Math.abs(vertex.x - expected[0]) < tolerance &&
          Math.abs(vertex.y - expected[1]) < tolerance &&
          Math.abs(vertex.z - expected[2]) < tolerance) {
        matchCount++
        break
      }
    }
  }
  
  return matchCount >= 6 // 至少6個頂點匹配才認為是立方體
}

// 立方體的特殊旋轉矩陣計算
function calculateCubeRotationMatrix(Apq: Matrix3): Matrix3 {
  // 對於立方體，使用更嚴格的正交化流程以避免變形為長方形
  const elements = Apq.elements
  
  // 提取行向量而不是列向量，這對立方體更合適
  let v1 = new Vector3(elements[0], elements[1], elements[2])
  let v2 = new Vector3(elements[3], elements[4], elements[5])
  let v3 = new Vector3(elements[6], elements[7], elements[8])
  
  // 確保向量有效
  if (v1.length() < 1e-6) v1.set(1, 0, 0)
  if (v2.length() < 1e-6) v2.set(0, 1, 0)
  if (v3.length() < 1e-6) v3.set(0, 0, 1)
  
  // 立方體特殊的正交化：保持軸對齊特性
  const u1 = v1.clone().normalize()
  
  // 第二個向量：去除與第一個向量的投影
  const u2 = v2.clone()
  u2.sub(u1.clone().multiplyScalar(v2.dot(u1)))
  
  if (u2.length() < 1e-6) {
    // 選擇與u1垂直的軸
    if (Math.abs(u1.x) < 0.9) {
      u2.set(1, 0, 0)
    } else {
      u2.set(0, 1, 0)
    }
    u2.sub(u1.clone().multiplyScalar(u2.dot(u1)))
  }
  u2.normalize()
  
  // 第三個向量：叉積確保正交
  const u3 = new Vector3().crossVectors(u1, u2).normalize()
  
  // 特殊處理：對於立方體，強制保持軸對齊
  const threshold = 0.8
  
  // 檢查是否接近軸對齊，如果是則強制對齊
  const axes = [
    new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1),
    new Vector3(-1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 0, -1)
  ]
    // 對每個正交化的向量，檢查是否接近某個軸
  const vectors = [u1, u2, u3]
  for (let i = 0; i < vectors.length; i++) {
    const u = vectors[i]
    for (const axis of axes) {
      if (Math.abs(u.dot(axis)) > threshold) {
        u.copy(axis)
        break
      }
    }
  }
  
  // 確保右手坐標系
  if (u1.dot(new Vector3().crossVectors(u2, u3)) < 0) {
    u3.multiplyScalar(-1)
  }
  
  return new Matrix3().set(
    u1.x, u1.y, u1.z,
    u2.x, u2.y, u2.z,
    u3.x, u3.y, u3.z
  )
}

// Apply physics state back to Three.js object
export function applyPhysicsToObject(object: Object3D, physicsState: PhysicsState): void {
  let vertexIndex = 0
  
  object.traverse((child) => {
    if (child instanceof Mesh) {
      const geometry = child.geometry
      if (geometry instanceof BufferGeometry) {
        const positionAttr = geometry.attributes.position
        
        for (let i = 0; i < positionAttr.count; i++) {
          if (vertexIndex < physicsState.positions.length) {
            const pos = physicsState.positions[vertexIndex]
            positionAttr.setXYZ(i, pos.x, pos.y, pos.z)
            vertexIndex++
          }
        }
        
        positionAttr.needsUpdate = true
        geometry.computeVertexNormals()
      }
    }
  })
}

// Initialize physics state for an object
export function initializePhysicsState(_object: Object3D, vertices: Vector3[]): PhysicsState {
  const positions = vertices.map(v => v.clone())
  const velocities = vertices.map(() => new Vector3())
  const forces = vertices.map(() => new Vector3())
  const masses = vertices.map(() => 1.0) // Default mass
  const restPositions = vertices.map(v => v.clone())
  const Q = vertices.map(() => new Matrix3().identity())
  const AqqInv = new Matrix3().identity()
  
  return {
    positions,
    velocities,
    forces,
    masses,
    restPositions,
    Q,
    AqqInv
  }
}

/**
 * Get effective beta value based on deformation type (matching C++ implementation)
 */
function getEffectiveBeta(params: ShapeMatchingParams): number {
  switch (params.deformationType) {
    case 'rotation':
      // C++ implementation: rotation mode always uses beta = 0 for pure rotation
      return 0.0;
    case 'linear':
      // C++ implementation: linear mode uses the configured beta value
      return params.beta;
    case 'quadratic':
      // C++ implementation: quadratic mode uses the configured beta value
      return params.beta;
    default:
      console.warn(`Unknown deformation type: ${params.deformationType}, defaulting to beta = 0`);
      return 0.0;
  }
}

// Integrate physics for one time step - Following C++ reference implementation
export function integratePhysics(
  physicsState: PhysicsState,
  params: ShapeMatchingParams,
  dt: number
): void {
  const { positions, velocities, forces, masses } = physicsState
  const numVertices = positions.length
  const fixedVertices = params.fixedVertices || new Set<number>()
  
  // 1. 計算形狀匹配目標位置
  const movablePositions: Vector3[] = []
  const movableRestPositions: Vector3[] = []
  const movableMasses: number[] = []
  
  for (let i = 0; i < numVertices; i++) {
    if (!fixedVertices.has(i)) {
      movablePositions.push(positions[i])
      movableRestPositions.push(physicsState.restPositions[i])
      movableMasses.push(masses[i])
    }
  }
  
  if (movablePositions.length === 0) return
    const currentCentroid = calculateCentroidWithMasses(movablePositions, movableMasses)
  const restCentroid = calculateCentroidWithMasses(movableRestPositions, movableMasses)
  
  const p = calculateRelatedPosition(movablePositions, currentCentroid)
  const q = calculateRelatedPosition(movableRestPositions, restCentroid)
    
  // Get effective beta value based on deformation type (C++ style)
  const effectiveBeta = getEffectiveBeta(params)
  
  // Create params with effective beta for goal position calculation
  const effectiveParams = { ...params, beta: effectiveBeta }
  
  // 計算變形矩陣 (根據變形類型)
  // CRITICAL FIX: Use restCentroid for goal position reconstruction to match C++ implementation
  let goalPositions: Vector3[]
  
  if (params.deformationType === 'quadratic') {
    goalPositions = computeQuadraticGoalPositions(p, q, movableMasses, restCentroid, effectiveParams)
  } else if (params.deformationType === 'linear') {
    goalPositions = computeLinearGoalPositions(p, q, movableMasses, restCentroid, effectiveParams)
  } else { // rotation mode
    // For rotation mode, force beta = 0 to use pure rotation (matching C++ implementation)
    goalPositions = computeRotationGoalPositions(p, q, movableMasses, restCentroid)
  }
  
  // 重構完整頂點陣列
  const fullGoalPositions: Vector3[] = new Array(numVertices)
  let movableIndex = 0
  
  for (let i = 0; i < numVertices; i++) {
    if (fixedVertices.has(i)) {
      fullGoalPositions[i] = positions[i].clone()
    } else {
      fullGoalPositions[i] = goalPositions[movableIndex]
      movableIndex++
    }
  }
  
  // 2. 積分步驟 - 嚴格按照 C++ 實現
  const alpha = dt / params.tau // alpha = dt / tau (C++ 中的計算方式)
  const dampingCoeff = params.dampingFactor // Rb_ in C++ (線性阻尼係數)
  
  for (let i = 0; i < numVertices; i++) {
    if (fixedVertices.has(i)) {
      // 固定頂點：速度設為零 (同 C++)
      velocities[i].set(0, 0, 0)
      forces[i].set(0, 0, 0)
      continue
    }
      // 計算彈性恢復力 (elasticity in C++)
    const elasticity = fullGoalPositions[i].clone().sub(positions[i]).multiplyScalar(alpha)
    
    // 計算外力加速度 (acceleration in C++)
    const acceleration = forces[i].clone().divideScalar(masses[i])
    
    // FIXED: 正確的積分公式 - 彈性恢復項已經包含了正確的時間尺度
    // elasticity = (goalPos - currentPos) * (dt/tau), 不需要再除以dt
    const elasticVelocityChange = elasticity
    const forceVelocityChange = acceleration.clone().multiplyScalar(dt)
    const dampingTerm = velocities[i].clone().multiplyScalar(dampingCoeff)
    
    // 更新速度 (完全按照 C++ 公式)
    velocities[i].add(elasticVelocityChange).add(forceVelocityChange).sub(dampingTerm)
    
    // 更新位置
    positions[i].add(velocities[i].clone().multiplyScalar(dt))
    
    // 清零外力 (同 C++)
    forces[i].set(0, 0, 0)
  }
  
  // 3. 穩定性檢查
  for (let i = 0; i < numVertices; i++) {
    if (!isFinite(positions[i].x) || !isFinite(positions[i].y) || !isFinite(positions[i].z) ||
        !isFinite(velocities[i].x) || !isFinite(velocities[i].y) || !isFinite(velocities[i].z)) {
      console.warn(`Invalid state detected at vertex ${i}, resetting`)
      positions[i].copy(physicsState.restPositions[i])
      velocities[i].set(0, 0, 0)
    }
  }
}

// Helper function for rotation-only goal positions (referenced in integratePhysics)
function computeRotationGoalPositions(
  p: Vector3[], 
  q: Vector3[], 
  masses: number[], 
  centroid: Vector3
): Vector3[] {
  // Input validation
  if (p.length === 0 || q.length === 0 || p.length !== q.length) {
    console.warn("Invalid input arrays for rotation computation");
    return q.map(qi => qi.clone().add(centroid));
  }

  const A_pq = calculateA_pq(p, q, masses);
  
  // Check for degenerate matrix
  const frobenius = Math.sqrt(A_pq.elements.reduce((sum, val) => sum + val * val, 0));
  if (frobenius < 1e-8) {
    console.warn("Degenerate A_pq matrix in rotation mode, using identity");
    return q.map(qi => qi.clone().add(centroid));
  }
  
  // Use stable rotation extraction
  let R: Matrix3;
  try {
    if (isCubeGeometry(q)) {
      R = calculateCubeRotationMatrix(A_pq);
    } else {
      R = extractRotationStableWithLimits(A_pq);
    }
  } catch (error) {
    console.warn("Failed to extract rotation, using identity:", error);
    R = new Matrix3(); // Identity matrix
  }
  
  // Validate rotation matrix
  const det = R.determinant();
  if (Math.abs(det - 1.0) > 0.1) {
    console.warn(`Invalid rotation matrix determinant: ${det}, normalizing`);
    // Force orthonormalization
    const elements = R.elements;
    let u1 = new Vector3(elements[0], elements[3], elements[6]).normalize();
    let u2 = new Vector3(elements[1], elements[4], elements[7]);
    u2.sub(u1.clone().multiplyScalar(u2.dot(u1))).normalize();
    let u3 = new Vector3().crossVectors(u1, u2).normalize();
    
    R.set(
      u1.x, u2.x, u3.x,
      u1.y, u2.y, u3.y,
      u1.z, u2.z, u3.z
    );
  }
  
  return q.map(qi => qi.clone().applyMatrix3(R).add(centroid));
}

// Throttle warning messages to prevent console flooding
let lastLinearDeformationWarning = 0;

// Helper function for linear goal positions (referenced in integratePhysics)
function computeLinearGoalPositions(
  p: Vector3[], 
  q: Vector3[], 
  masses: number[], 
  centroid: Vector3,
  params: ShapeMatchingParams
): Vector3[] {
  // Input validation
  if (p.length === 0 || q.length === 0 || p.length !== q.length) {
    console.warn("Invalid input arrays for linear computation");
    return q.map(qi => qi.clone().add(centroid));
  }

  // Clamp input magnitudes to prevent extreme deformations
  const maxMagnitude = 5.0; // Reduced from 10.0 for better stability
  const pMagnitude = Math.sqrt(p.reduce((sum, v) => sum + v.lengthSq(), 0));
  const qMagnitude = Math.sqrt(q.reduce((sum, v) => sum + v.lengthSq(), 0));
  
  if (pMagnitude > maxMagnitude || qMagnitude > maxMagnitude) {
    // Only warn once every 1000ms to prevent console flooding
    const now = Date.now();
    if (now - lastLinearDeformationWarning > 1000) {
      console.warn(`Large deformation in linear mode (p:${pMagnitude.toFixed(2)}, q:${qMagnitude.toFixed(2)}), clamping to ${maxMagnitude}`);
      lastLinearDeformationWarning = now;
      
      // If deformation is extremely large, suggest switching modes
      if (pMagnitude > 20.0 || qMagnitude > 20.0) {
        console.warn("Extremely large deformation detected. Consider switching to rotation mode for better stability.");
      }
    }
    
    const pScale = Math.min(1.0, maxMagnitude / Math.max(pMagnitude, 1e-10));
    const qScale = Math.min(1.0, maxMagnitude / Math.max(qMagnitude, 1e-10));
    
    p.forEach(v => v.multiplyScalar(pScale));
    q.forEach(v => v.multiplyScalar(qScale));
  }

  const A_pq = calculateA_pq(p, q, masses);
  
  // Extract rotation first
  let R: Matrix3;
  try {
    R = extractRotationStableWithLimits(A_pq);
  } catch (error) {
    console.warn("Failed to extract rotation in linear mode, falling back:", error);
    return computeRotationGoalPositions(p, q, masses, centroid);
  }
  
  // Compute Aqq matrix with enhanced stability
  const Aqq = new Matrix3();
  for (let i = 0; i < q.length; i++) {
    const qi = q[i];
    const mass = masses[i];
    
    // Validate inputs
    if (!isFinite(qi.x) || !isFinite(qi.y) || !isFinite(qi.z) || !isFinite(mass)) {
      console.warn(`Invalid data at vertex ${i}, skipping`);
      continue;
    }
    
    const outerProduct = new Matrix3().set(
      qi.x * qi.x, qi.x * qi.y, qi.x * qi.z,
      qi.y * qi.x, qi.y * qi.y, qi.y * qi.z,
      qi.z * qi.x, qi.z * qi.y, qi.z * qi.z
    ).multiplyScalar(mass);
    
    Aqq.elements.forEach((_, idx) => {
      Aqq.elements[idx] += outerProduct.elements[idx];
    });
  }
  
  // Add stronger regularization for numerical stability
  const regularization = 1e-3;
  Aqq.elements[0] += regularization; // Add to diagonal
  Aqq.elements[4] += regularization;
  Aqq.elements[8] += regularization;
  
  // Check matrix condition
  const det = Aqq.determinant();
  if (Math.abs(det) < 1e-8) {
    console.warn("Singular Aqq matrix in linear mode, using rotation only");
    return computeRotationGoalPositions(p, q, masses, centroid);
  }
  
  // Compute linear transformation matrix A
  let A: Matrix3;
  try {
    A = new Matrix3().multiplyMatrices(A_pq, Aqq.clone().invert());
  } catch (error) {
    console.warn("Failed to compute linear transformation, using rotation:", error);
    return computeRotationGoalPositions(p, q, masses, centroid);
  }
  
  // Volume preservation with clamping
  const volume = A.determinant();
  if (Math.abs(volume) > 1e-10) {
    const volumeScale = 1.0 / Math.cbrt(Math.abs(volume));
    // Clamp volume scale to prevent extreme scaling
    const clampedVolumeScale = Math.max(0.1, Math.min(10.0, volumeScale));
    A.multiplyScalar(clampedVolumeScale);
  }
  
  // Validate transformation matrix elements
  const maxElement = 5.0;
  for (let i = 0; i < 9; i++) {
    if (!isFinite(A.elements[i]) || Math.abs(A.elements[i]) > maxElement) {
      console.warn("Invalid linear transformation matrix, using rotation only");
      return computeRotationGoalPositions(p, q, masses, centroid);
    }
  }
  
  // Conservative beta clamping for stability
  const beta = Math.min(params.beta, 0.5); // Limit linear contribution
  
  // Blend between rotation and linear transformation: T = beta * A + (1 - beta) * R
  const T = new Matrix3();
  for (let i = 0; i < 9; i++) {
    T.elements[i] = beta * A.elements[i] + (1 - beta) * R.elements[i];
  }
  
  // Apply transformation with bounds checking
  const goalPositions: Vector3[] = [];
  const maxDisplacement = 5.0;
  
  for (let i = 0; i < q.length; i++) {
    try {
      const qi = q[i];
      const transformed = qi.clone().applyMatrix3(T);
      let goalPos = transformed.add(centroid);
      
      // Limit displacement from centroid
      const displacement = goalPos.clone().sub(centroid);
      if (displacement.length() > maxDisplacement) {
        displacement.normalize().multiplyScalar(maxDisplacement);
        goalPos = centroid.clone().add(displacement);
      }
      
      // Final validation
      if (isFinite(goalPos.x) && isFinite(goalPos.y) && isFinite(goalPos.z)) {
        goalPositions.push(goalPos);
      } else {
        // Fallback to rotation-only for this vertex
        goalPositions.push(qi.clone().applyMatrix3(R).add(centroid));
      }
    } catch (error) {
      console.warn(`Error transforming vertex ${i}, using rotation fallback:`, error);
      goalPositions.push(q[i].clone().applyMatrix3(R).add(centroid));
    }
  }
  
  return goalPositions;
}

// Helper function for quadratic goal positions (referenced in integratePhysics)
function computeQuadraticGoalPositions(
  p: Vector3[], 
  q: Vector3[], 
  masses: number[], 
  centroid: Vector3,
  params: ShapeMatchingParams
): Vector3[] {
  try {
    // Calculate quadratic terms for target configuration
    const qQuadratic = calculateQuadraticTerms(q);
    
    // Calculate ApqTilde (3x9 matrix) 
    const ApqTilde = calculateApqTilde(p, qQuadratic, masses);
    
    // Calculate AqqInv for quadratic terms using eigenvalue decomposition (C++ style)
    const AqqInvQuadratic = calculateAqqInvQuadraticWithEigen(qQuadratic, masses, params.perturbation);
    
    // Validate AqqInvQuadratic
    const validInverse = AqqInvQuadratic.every(row => 
      row.every(val => isFinite(val) && !isNaN(val))
    );
    
    if (!validInverse) {
      console.warn("Invalid quadratic inverse matrix, falling back to linear deformation");
      return computeLinearGoalPositions(p, q, masses, centroid, params);
    }
    
    // Compute transformation matrix: 3x9 matrix result
    const TQuadratic = multiplyMatrix3x9_9x9(ApqTilde, AqqInvQuadratic);
      // Apply quadratic transformation to each vertex
    const goalPositions: Vector3[] = [];
    for (let i = 0; i < q.length; i++) {
      const qTilde = qQuadratic[i];
      
      const transformedPos = new Vector3(
        TQuadratic[0][0] * qTilde[0] + TQuadratic[0][1] * qTilde[1] + TQuadratic[0][2] * qTilde[2] +
        TQuadratic[0][3] * qTilde[3] + TQuadratic[0][4] * qTilde[4] + TQuadratic[0][5] * qTilde[5] +
        TQuadratic[0][6] * qTilde[6] + TQuadratic[0][7] * qTilde[7] + TQuadratic[0][8] * qTilde[8],
        
        TQuadratic[1][0] * qTilde[0] + TQuadratic[1][1] * qTilde[1] + TQuadratic[1][2] * qTilde[2] +
        TQuadratic[1][3] * qTilde[3] + TQuadratic[1][4] * qTilde[4] + TQuadratic[1][5] * qTilde[5] +
        TQuadratic[1][6] * qTilde[6] + TQuadratic[1][7] * qTilde[7] + TQuadratic[1][8] * qTilde[8],
        
        TQuadratic[2][0] * qTilde[0] + TQuadratic[2][1] * qTilde[1] + TQuadratic[2][2] * qTilde[2] +
        TQuadratic[2][3] * qTilde[3] + TQuadratic[2][4] * qTilde[4] + TQuadratic[2][5] * qTilde[5] +
        TQuadratic[2][6] * qTilde[6] + TQuadratic[2][7] * qTilde[7] + TQuadratic[2][8] * qTilde[8]
      );
      
      goalPositions.push(transformedPos.add(centroid));
    }
    
    return goalPositions;
  } catch (error) {
    console.warn("Quadratic deformation failed, falling back to linear:", error);
    return computeLinearGoalPositions(p, q, masses, centroid, params);
  }
}

/**
 * Calculate AqqInv for quadratic terms using eigenvalue decomposition (matching C++ implementation)
 */
function calculateAqqInvQuadraticWithEigen(qQuadratic: number[][], masses: number[], perturbation: number = 1e-6): number[][] {
  // Initialize 9x9 matrix
  const Aqq = Array(9).fill(0).map(() => Array(9).fill(0));
  
  // Build Aqq matrix
  for (let i = 0; i < qQuadratic.length; i++) {
    const qi = qQuadratic[i];
    const mass = masses[i];
    
    for (let j = 0; j < 9; j++) {
      for (let k = 0; k < 9; k++) {
        Aqq[j][k] += mass * qi[j] * qi[k];
      }
    }
  }
    // Use simplified eigenvalue approach for 9x9 matrix
  // Add regularization to eigenvalues if they are too small (matching C++ approach)
  
  // For stability, use simple diagonal regularization and matrix inversion
  for (let i = 0; i < 9; i++) {
    Aqq[i][i] += perturbation;
  }
  
  // Use existing matrix inversion
  return invertMatrix9x9(Aqq);
}

/**
 * Enhanced shape matching with physics integration
 * Combines shape matching with physics-based simulation
 */
export function enhancedShapeMatchingWithPhysics(
  object: Object3D,
  physicsState: PhysicsState,
  params: ShapeMatchingParams,
  dt: number
): void {
  try {
    const vertices = getAllWorldVertices(object);
    // Remove unused masses variable (it was declared but never used)
    const fixedVertices = params.fixedVertices || new Set<number>();

    if (vertices.length !== physicsState.positions.length) {
      console.error("Vertex count mismatch between object and physics state");
      return;
    }

    if (vertices.length === 0) {
      console.warn("No vertices found in object");
      return;
    }

    // Update physics state positions with current vertex positions
    for (let i = 0; i < vertices.length; i++) {
      physicsState.positions[i].copy(vertices[i]);
    }    // Integrate physics with shape matching forces
    integratePhysics(physicsState, params, dt);

    // Apply computed positions back to the object
    applyDeformation(object, physicsState.positions, params.dampingFactor, fixedVertices);

  } catch (error) {
    console.error("Error in enhancedShapeMatchingWithPhysics:", error);
  }
}

// Removed unused calculateGoalPositions function to fix compilation warnings

// Export all required functions
