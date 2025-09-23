import * as THREE from 'three';

/**
 * Splits edges of a geometry at any vertices that are close enough to the edge.
 * This avoids holes in the geometry when merging close-by vertices.
 * Instead of splitting, removes any collapsed triangles (u, v, w) where u touches (v, w).
 */
export function splitEdgesAtVertices(geometry, tolerance = 0.0001) {
    if (!geometry.index) { throw new Error('Input geometry must be indexed'); }

    const toleranceSq = tolerance * tolerance;

    const positions = Array.from(geometry.attributes.position.array);
    const index = Array.from(geometry.index.array);
    const posCount = geometry.attributes.position.count;
    const indices = Array.from({length: posCount}, (_, i) => i);

    const edgeAdjacentVertices = buildEdgeVertexAdjacency(index);

    const allEdges = new Map();
    for (let i = 0; i < index.length; i += 3) {
        const [u, v, w] = [index[i], index[i + 1], index[i + 2]];
        allEdges.set(canonicalEdgeKey(u, v), [u, v]);
        allEdges.set(canonicalEdgeKey(v, w), [v, w]);
        allEdges.set(canonicalEdgeKey(w, u), [w, u]);
    }

    // Touching vertices per edge
    const touchingVertices = new Map();
    const collapsedTriangles = new Set();

    for (const [u, v] of allEdges.values()) {
        for (const w of indices) {
            if (w == u || w == v) { continue; }

            // Fast bounding box check first
            if (!isInBounds(w, u, v, positions, tolerance)) { continue; }

            // Check if w is too close to vertices u or v
            if (distanceSquared(u, w, positions) <= toleranceSq || distanceSquared(v, w, positions) <= toleranceSq) {
                continue;
            }

            // Check if w is close enough to edge (u, v)
            const distSq = pointToSegmentDistanceSquared(w, u, v, positions);
            if (distSq > toleranceSq) { continue; }

            // When (u, v, w) is a triangle itself, it is collapsed
            if (edgeAdjacentVertices.get(canonicalEdgeKey(u, v)).indexOf(w) != -1) {
                const vertices = [u, v, w];
                vertices.sort();
                collapsedTriangles.add(`${vertices[0]}_${vertices[1]}_${vertices[2]}`);
                continue;
            }

            // Add w to vertices touching edge (u, v)
            const key = canonicalEdgeKey(u, v);
            if (!touchingVertices.has(key)) { touchingVertices.set(key, []); }
            touchingVertices.get(key).push(w);
        }
    }

    const newPositions = [];
    const newIndices = [];
    const indexMap = new Map(); // originalVertexIndex -> newVertexIndex

    // Helper to add or reuse vertex index
    function ensureVertex(origIdx) {
        if (indexMap.has(origIdx)) { return indexMap.get(origIdx); }
        const v = new THREE.Vector3().fromArray(positions, origIdx * 3);
        const newIdx = newPositions.length / 3;
        newPositions.push(v.x, v.y, v.z);
        indexMap.set(origIdx, newIdx);
        return newIdx;
    }

    for (let i = 0; i < index.length; i += 3) {
        let isSplit = false;
        const vertices = [index[i], index[i + 1], index[i + 2]];
        const [x, y, z] = vertices;

        // Collect edges, corresponding apexes, whether apex was changed, and touching vertices
        const edges = [
            [x, y, z, false, touchingVertices.get(canonicalEdgeKey(x, y))],
            [y, z, x, false, touchingVertices.get(canonicalEdgeKey(y, z))],
            [z, x, y, false, touchingVertices.get(canonicalEdgeKey(z, x))]
        ];

        vertices.sort();
        if (collapsedTriangles.has(`${vertices[0]}_${vertices[1]}_${vertices[2]}`)) {
            continue;
        }

        for (const [edgeNumber, [u, v, a, apexChanged, tVertices]] of edges.entries()) {
            if (!tVertices) { continue; }

            isSplit = true;

            const apex = ensureVertex(a);

            // Sort touching vertices by distance to u
            tVertices.sort((a, b) => distanceSquared(u, a, positions) - distanceSquared(u, b, positions));

            let prevVertex = ensureVertex(u);
            for (const [tvIdx, w] of tVertices.entries()) {
                const vertex = ensureVertex(w);

                // Update apex of last edge
                if (tvIdx == 0 && edgeNumber == 0) {
                    edges[2][2] = w;
                    edges[2][3] = true;
                }

                // Don't add first split triangle when we still have the original apex and previous edge is also split
                if (apexChanged || tvIdx > 0 || !edges[mod(edgeNumber - 1, 3)][4]) {
                    newIndices.push(prevVertex, vertex, apex);
                }
                prevVertex = vertex;
            }

            // Update apex of next edge
            if (edgeNumber < 2 && !edges[edgeNumber + 1][3]) {
                edges[edgeNumber + 1][2] = tVertices[tVertices.length - 1];
                edges[edgeNumber + 1][3] = true;
            }

            // Don't add last triangle when we still have the original apex and next edge is also going to be split
            if (apexChanged || !edges[mod(edgeNumber + 1, 3)][4]) {
                newIndices.push(prevVertex, ensureVertex(v), apex);
            }
        }

        if (!isSplit) {
            const u = ensureVertex(x);
            const v = ensureVertex(y);
            const w = ensureVertex(z);
            newIndices.push(u, v, w);
        }
    }

    const outGeo = new THREE.BufferGeometry();
    outGeo.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    outGeo.setIndex(newIndices);
    outGeo.computeVertexNormals();
    return outGeo;
}

/**
 * @returns Map from canonical edge key to array of adjacent vertex indices
 */
function buildEdgeVertexAdjacency(index) {
    const eAdj = new Map();
    for (let i = 0; i < index.length; i += 3) {
        const u = index[i], v = index[i + 1], w = index[i + 2];
        const uvK = canonicalEdgeKey(u, v);
        const vwK = canonicalEdgeKey(v, w);
        const wuK = canonicalEdgeKey(w, u);
        if (!eAdj.has(uvK)) { eAdj.set(uvK, []); }
        if (!eAdj.has(vwK)) { eAdj.set(vwK, []); }
        if (!eAdj.has(wuK)) { eAdj.set(wuK, []); }
        eAdj.get(uvK).push(w);
        eAdj.get(vwK).push(u);
        eAdj.get(wuK).push(v);
    }
    return eAdj;
}

function distanceSquared(u, v, positions) {
    const dx = positions[3 * u] - positions[3 * v];
    const dy = positions[3 * u + 1] - positions[3 * v + 1];
    const dz = positions[3 * u + 2] - positions[3 * v + 2];
    return dx * dx + dy * dy + dz * dz;
}

/**
 * @param {*} u Point index
 * @param {*} v Line segment begin index
 * @param {*} w Line segment end index
 * @param {*} positions Vertex array
 * @param {*} tolerance Margin by which the bounding box is extended in all directions
 * @return {boolean} Whether point u is within the bounding box of line segment (v, w) extended by tolerance
 */
function isInBounds(u, v, w, positions, tolerance) {
    const ax = positions[3 * u], ay = positions[3 * u + 1], az = positions[3 * u + 2];
    const bx = positions[3 * v], by = positions[3 * v + 1], bz = positions[3 * v + 2];
    const cx = positions[3 * w], cy = positions[3 * w + 1], cz = positions[3 * w + 2];
    const minX = Math.min(bx, cx) - tolerance, maxX = Math.max(bx, cx) + tolerance;
    const minY = Math.min(by, cy) - tolerance, maxY = Math.max(by, cy) + tolerance;
    const minZ = Math.min(bz, cz) - tolerance, maxZ = Math.max(bz, cz) + tolerance;
    return ax >= minX && ax <= maxX && ay >= minY && ay <= maxY && az >= minZ && az <= maxZ;
}

/**
 * @param {*} u Point index
 * @param {*} v Line segment begin index
 * @param {*} w Line segment end index
 * @param {*} positions Vertex array
 * @return {number} Squared distance from point u to line segment (v, w)
 */
function pointToSegmentDistanceSquared(u, v, w, positions) {
    const a = new THREE.Vector3().fromArray(positions, 3 * u);
    const b = new THREE.Vector3().fromArray(positions, 3 * v);
    const c = new THREE.Vector3().fromArray(positions, 3 * w);
    const vw = new THREE.Vector3().subVectors(c, b);
    const vu = new THREE.Vector3().subVectors(a, b);
    const t = THREE.MathUtils.clamp(vu.dot(vw) / vw.lengthSq(), 0, 1);
    const closest = new THREE.Vector3().copy(vw).multiplyScalar(t).add(b);
    return a.distanceToSquared(closest);
}

function canonicalEdgeKey(u, v) {
    return u < v ? `${u}_${v}` : `${v}_${u}`;
}

/** Modulo that handles negative numbers as expected (e.g. mod(-1, 3) == 2) */
function mod(x, y) {
    return ((x % y) + y) % y;
}
