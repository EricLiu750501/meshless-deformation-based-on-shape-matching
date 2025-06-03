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

    const weightedSum = new Vector3();
    let totalMass = 0;

    for (let i = 0; i < vertices.length; i++) {
        const weightedVertex = vertices[i].clone().multiplyScalar(masses[i]);
        weightedSum.add(weightedVertex);
        totalMass += masses[i];
    }

    if (totalMass === 0) {
        // If all masses are zero, return simple centroid
        const sum = new Vector3();
        for (let i = 0; i < vertices.length; i++) {
            sum.add(vertices[i]);
        }
        return sum.divideScalar(vertices.length);
    }

    return weightedSum.divideScalar(totalMass);
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
        ).multiplyScalar(m);        A_pq.elements.forEach((_, idx) => {
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
 * Improved rotation extraction using SVD approximation
 */
function extractRotationSVD(Apq: Matrix3): Matrix3 {
    // Use iterative method to approximate SVD for better rotation extraction
    let R = Apq.clone();
    const maxIterations = 10;
    
    for (let iter = 0; iter < maxIterations; iter++) {
        const Rt = R.clone().transpose();
        const RRt = new Matrix3().multiplyMatrices(R, Rt);
        
        // Calculate (R*R^T)^(-1/2) using eigenvalue decomposition approximation
        const trace = RRt.elements[0] + RRt.elements[4] + RRt.elements[8];
        const scale = Math.pow(Math.abs(trace / 3), -0.5);
        
        const RRtInvSqrt = RRt.clone().multiplyScalar(scale);
        
        const newR = new Matrix3().multiplyMatrices(R, RRtInvSqrt);
        
        // Check convergence
        const diff = new Matrix3();
        for (let i = 0; i < 9; i++) {
            diff.elements[i] = newR.elements[i] - R.elements[i];
        }
        const diffNorm = Math.sqrt(diff.elements.reduce((sum: number, val: number) => sum + val * val, 0));
        
        R = newR;
        
        if (diffNorm < 1e-6) break;
    }
    
    return R;
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


function shapeMatching(object: Object3D, targetVertices: Vector3[], targetCentroid: Vector3, masses: number[], dampingFactor: number = 0.1) {
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

function enhancedShapeMatching(
    object: Object3D, 
    targetVertices: Vector3[], 
    _targetCentroid: Vector3, // Note: Not used directly, computed from movable vertices for better fixed vertex handling
    masses: number[], 
    params: ShapeMatchingParams
) {
    const currentVertices = getAllWorldVertices(object);
    const numPoints = currentVertices.length;

    if (targetVertices.length !== numPoints || masses.length !== numPoints) {
        console.error("Vertex count mismatch:", {
            current: numPoints,
            target: targetVertices.length,
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
    const movableMasses: number[] = [];

    for (let i = 0; i < numPoints; i++) {
        if (!fixedVertices.has(i)) {
            movableIndices.push(i);
            movableCurrentVertices.push(currentVertices[i].clone());
            movableTargetVertices.push(targetVertices[i].clone());
            movableMasses.push(masses[i]);
        }
    }

    // If no movable vertices, skip deformation
    if (movableIndices.length === 0) {
        console.warn("No movable vertices found, skipping deformation");
        return;
    }

    // Calculate centroids based only on movable vertices
    const movableCurrentCentroid = calculateCentroidWithMasses(movableCurrentVertices, movableMasses);
    const movableTargetCentroid = calculateCentroidWithMasses(movableTargetVertices, movableMasses);

    // Compute relative positions for movable vertices only
    const p = calculateRelatedPosition(movableCurrentVertices, movableCurrentCentroid);
    const q = calculateRelatedPosition(movableTargetVertices, movableTargetCentroid);

    // Safety check for degenerate configurations
    const pMagnitude = Math.sqrt(p.reduce((sum, v) => sum + v.lengthSq(), 0));
    const qMagnitude = Math.sqrt(q.reduce((sum, v) => sum + v.lengthSq(), 0));
    
    if (pMagnitude < 1e-10 || qMagnitude < 1e-10) {
        console.warn("Degenerate configuration detected, skipping deformation");
        return;
    }

    let movableNewVertices: Vector3[] = [];

    try {
        switch (params.deformationType) {
            case 'rotation':
                movableNewVertices = computeRotationDeformation(p, q, movableMasses, movableCurrentCentroid);
                break;
            case 'linear':
                movableNewVertices = computeLinearDeformation(p, q, movableMasses, movableCurrentCentroid, params.beta);
                break;
            case 'quadratic':
                movableNewVertices = computeQuadraticDeformation(p, q, movableMasses, movableCurrentCentroid, params.beta, params.perturbation);
                break;
        }

        // Validate computed vertices
        const validVertices = movableNewVertices.every(v => 
            isFinite(v.x) && isFinite(v.y) && isFinite(v.z) &&
            !isNaN(v.x) && !isNaN(v.y) && !isNaN(v.z)
        );

        if (!validVertices) {
            console.error("Invalid vertices computed, skipping deformation");
            return;
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

function computeRotationDeformation(
    p: Vector3[], 
    q: Vector3[], 
    masses: number[], 
    currentCentroid: Vector3
): Vector3[] {
    // Compute A_pq matrix
    const A_pq = calculateA_pq(p, q, masses);
    
    // Extract pure rotation using SVD approximation
    const R = extractRotationSVD(A_pq);
    
    // Apply rotation to target shape
    const newVertices: Vector3[] = [];
    for (let i = 0; i < q.length; i++) {
        const rotated = q[i].clone().applyMatrix3(R);
        const newPos = rotated.add(currentCentroid);
        newVertices.push(newPos);
    }
    
    return newVertices;
}

function computeLinearDeformation(
    p: Vector3[], 
    q: Vector3[], 
    masses: number[], 
    currentCentroid: Vector3, 
    beta: number
): Vector3[] {
    // Compute A_pq matrix
    const A_pq = calculateA_pq(p, q, masses);
    
    // Extract rotation
    const R = extractRotationSVD(A_pq);
    
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
    
    // Add small regularization to prevent singular matrix
    const regularization = 1e-6;
    Aqq.elements[0] += regularization; // Add to diagonal
    Aqq.elements[4] += regularization;
    Aqq.elements[8] += regularization;
    
    // Check if matrix is invertible
    const det = Aqq.determinant();
    if (Math.abs(det) < 1e-10) {
        console.warn("Singular Aqq matrix detected, using rotation only");
        // Fall back to rotation-only deformation
        const newVertices: Vector3[] = [];
        for (let i = 0; i < q.length; i++) {
            const rotated = q[i].clone().applyMatrix3(R);
            const newPos = rotated.add(currentCentroid);
            newVertices.push(newPos);
        }
        return newVertices;
    }
    
    // Compute linear transformation matrix A
    const A = new Matrix3().multiplyMatrices(A_pq, Aqq.clone().invert());
    
    // Volume preservation - check for valid volume
    const volume = A.determinant();
    if (Math.abs(volume) > 1e-10) {
        A.multiplyScalar(Math.pow(Math.abs(volume), -1/3));
    }
    
    // Validate transformation matrix
    const validMatrix = A.elements.every(val => isFinite(val) && !isNaN(val));
    if (!validMatrix) {
        console.warn("Invalid transformation matrix, using rotation only");
        // Fall back to rotation-only deformation
        const newVertices: Vector3[] = [];
        for (let i = 0; i < q.length; i++) {
            const rotated = q[i].clone().applyMatrix3(R);
            const newPos = rotated.add(currentCentroid);
            newVertices.push(newPos);
        }
        return newVertices;
    }
    
    // Blend between rotation and linear transformation
    const T = new Matrix3();
    for (let i = 0; i < 9; i++) {
        T.elements[i] = beta * A.elements[i] + (1 - beta) * R.elements[i];
    }
    
    // Apply transformation
    const newVertices: Vector3[] = [];
    for (let i = 0; i < q.length; i++) {
        const transformed = q[i].clone().applyMatrix3(T);
        const newPos = transformed.add(currentCentroid);
        newVertices.push(newPos);
    }
    
    return newVertices;
}

function computeQuadraticDeformation(
    p: Vector3[], 
    q: Vector3[], 
    masses: number[], 
    currentCentroid: Vector3, 
    beta: number, 
    perturbation: number
): Vector3[] {
    try {
        // Calculate quadratic terms for target configuration
        const qQuadratic = calculateQuadraticTerms(q);
        
        // Calculate ApqTilde (3x9 matrix)
        const ApqTilde = calculateApqTilde(p, qQuadratic, masses);
        
        // Calculate AqqInv for quadratic terms
        const AqqInvQuadratic = calculateAqqInvQuadratic(qQuadratic, masses, perturbation);
        
        // Validate AqqInvQuadratic
        const validInverse = AqqInvQuadratic.every(row => 
            row.every(val => isFinite(val) && !isNaN(val))
        );
        
        if (!validInverse) {
            console.warn("Invalid quadratic inverse matrix, falling back to linear deformation");
            return computeLinearDeformation(p, q, masses, currentCentroid, beta);
        }
        
        // Compute linear transformation matrix for comparison
        const A_pq = calculateA_pq(p, q, masses);
        const R = extractRotationSVD(A_pq);
        
        // Create Rtilde (3x9) - rotation extended to quadratic space
        const Rtilde = Array(3).fill(0).map(() => Array(9).fill(0));
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                Rtilde[i][j] = R.elements[i * 3 + j];
            }
        }
        
        // Compute Atilde = ApqTilde * AqqInvQuadratic
        const Atilde = multiplyMatrix3x9_9x9(ApqTilde, AqqInvQuadratic);
        
        // Validate Atilde
        const validAtilde = Atilde.every(row => 
            row.every(val => isFinite(val) && !isNaN(val))
        );
        
        if (!validAtilde) {
            console.warn("Invalid quadratic transformation matrix, falling back to linear deformation");
            return computeLinearDeformation(p, q, masses, currentCentroid, beta);
        }
        
        // Blend between quadratic and rotation transformation
        const T = Array(3).fill(0).map(() => Array(9).fill(0));
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 9; j++) {
                T[i][j] = beta * Atilde[i][j] + (1 - beta) * Rtilde[i][j];
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
            
            // Validate the computed vertex
            if (!isFinite(vertex.x) || !isFinite(vertex.y) || !isFinite(vertex.z) ||
                isNaN(vertex.x) || isNaN(vertex.y) || isNaN(vertex.z)) {
                console.warn("Invalid vertex computed in quadratic deformation, falling back to linear");
                return computeLinearDeformation(p, q, masses, currentCentroid, beta);
            }
            
            // Add current centroid
            vertex.add(currentCentroid);
            transformedVertices.push(vertex);
        }
        
        return transformedVertices;
    } catch (error) {
        console.error("Error in quadratic deformation:", error);
        console.warn("Falling back to linear deformation");
        return computeLinearDeformation(p, q, masses, currentCentroid, beta);
    }
}

function applyDeformation(object: Object3D, newVertices: Vector3[], dampingFactor: number, fixedVertices?: Set<number>) {
    object.traverse((child) => {
        if (child instanceof Mesh) {
            const geometry = child.geometry;
            if (geometry instanceof BufferGeometry) {
                const positionAttr = geometry.attributes.position;
                const vertexCount = Math.min(newVertices.length, positionAttr.count);
                
                // Create a new position array for complete refresh
                const newPositions = new Float32Array(positionAttr.count * 3);
                
                // Copy current positions first
                for (let i = 0; i < positionAttr.count; i++) {
                    newPositions[i * 3] = positionAttr.getX(i);
                    newPositions[i * 3 + 1] = positionAttr.getY(i);
                    newPositions[i * 3 + 2] = positionAttr.getZ(i);
                }
                
                // Update only movable vertices
                for (let i = 0; i < vertexCount; i++) {
                    // Skip fixed vertices
                    if (fixedVertices && fixedVertices.has(i)) {
                        continue;
                    }
                    
                    const currentPos = new Vector3(
                        positionAttr.getX(i),
                        positionAttr.getY(i),
                        positionAttr.getZ(i)
                    );
                    
                    // Convert new vertex from world to local space
                    const targetPos = newVertices[i].clone();
                    child.worldToLocal(targetPos);
                    
                    // Validate target position
                    if (!isFinite(targetPos.x) || !isFinite(targetPos.y) || !isFinite(targetPos.z) ||
                        isNaN(targetPos.x) || isNaN(targetPos.y) || isNaN(targetPos.z)) {
                        console.warn(`Invalid target position for vertex ${i}, skipping`);
                        continue;
                    }
                    
                    // Apply damping: interpolate between current and target position
                    const dampedPos = currentPos.lerp(targetPos, Math.max(0, Math.min(1, dampingFactor)));
                    
                    // Validate damped position
                    if (!isFinite(dampedPos.x) || !isFinite(dampedPos.y) || !isFinite(dampedPos.z) ||
                        isNaN(dampedPos.x) || isNaN(dampedPos.y) || isNaN(dampedPos.z)) {
                        console.warn(`Invalid damped position for vertex ${i}, skipping`);
                        continue;
                    }
                    
                    // Update in the new position array
                    newPositions[i * 3] = dampedPos.x;
                    newPositions[i * 3 + 1] = dampedPos.y;
                    newPositions[i * 3 + 2] = dampedPos.z;
                }
                
                // Complete refresh: replace the entire position array
                positionAttr.array = newPositions;
                positionAttr.needsUpdate = true;
                
                // Force geometry update
                geometry.attributes.position = positionAttr;
                geometry.computeBoundingSphere();
            }
        }
    });
}




export { getVerticesFromObject, shapeMatching, enhancedShapeMatching };
