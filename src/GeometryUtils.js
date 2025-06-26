import * as THREE from 'three';

// export function getGeometryManipulator(obj) {
//     if (!obj.userData.geometryManipulator) {
//         obj.userData.geometryManipulator = new GeometryManipulator(obj.geometry);
//     }
//     return obj.userData.geometryManipulator;
// }

export class GeometryManipulator {
    constructor(geometry) {
        this.geometry = geometry;
        this.geometry.setIndex(this.removeCollapsedTriangles([...this.geometry.index.array]));
        this.constructEdges();
    }

    constructEdges() {
        this.edges = new Map();
        for (const [i1, i2, i3] of iterateTriangles(this.geometry)) {
            if (i1 == i2 || i1 == i3 || i2 == i3) {
                console.log("ENCOUNTERED TRIANGLE WITH TWO IDENTICAL POINTS!");
                continue;
            }
            this.addEdge(i1, i2, true);
            this.addEdge(i1, i3, true);
            this.addEdge(i2, i3, true);
        }
    }

    getIndicesWithinRange(point, maxDistance, startIndices = null) {
        let hasIndexWithinRange = true;
        let visited = new Set();
        if (startIndices) {
            visited = new Set(startIndices);
        } else {
            startIndices = this.getIndices();
            hasIndexWithinRange = false;
        }
        const pos = this.geometry.attributes.position;
        let queue = [...startIndices]
        const result = [];
        while (queue.length > 0) {
            const i = queue.pop();
            const vertexPoint = new THREE.Vector3().fromBufferAttribute(pos, i);
            const dist = point.clone().sub(vertexPoint).length();
            if (dist > maxDistance) {
                continue;
            }

            if (!hasIndexWithinRange) {
                hasIndexWithinRange = true;
                queue = [];
            }

            this.edges.get(i).forEach(j => {
                if (!visited.has(j)) {
                    queue.push(j);
                    visited.add(j);
                }
            });

            result.push({index: i, distance: dist});
        }
        return result;
    }

    removeCollapsedTriangles(geometryIndices) {
        if (!geometryIndices) {
            geometryIndices = [...this.geometry.index.array];
        }
        let i = 0;
        while (i < geometryIndices.length) {
            const [i1, i2, i3] = geometryIndices.slice(i, i + 3);
            if (i1 != i2 && i1 != i3 && i2 != i3) {
                i += 3;
                continue;
            }
            geometryIndices.splice(i, 3);  // in-place
        }
        return geometryIndices;
    }

    addEdge(i1, i2, bothDirections = false) {
        if (!this.edges.has(i1)) { this.edges.set(i1, []) };
        const neighbors = this.edges.get(i1);
        if (neighbors.indexOf(i2) == -1) {
            neighbors.push(i2);
        }
        if (bothDirections) {
            this.addEdge(i2, i1, false);
        }
    }

    removeEdge(i1, i2, bothDirections = false) {
        this.edges.set(i1, this.edges.get(i1).filter((i) => i != i2));
        if (bothDirections) {
            this.removeEdge(i2, i1, false);
        }
    }

    hasEdge(i1, i2) {
        return this.edges.get(i1).indexOf(i2) > -1;
    }

    getIndices() {
        return [...new Set(this.geometry.index.array)];
    }

    splitTrianglesOnTouchingVertices(tolerance = 0.0001) {
        const tolSq = tolerance * tolerance;
        const geometry = this.geometry.clone();  // TODO reconsider clone

        const pos = geometry.attributes.position;
        const vertices = [];

        for (let i = 0; i < pos.count; i++) {
            vertices.push(new THREE.Vector3().fromBufferAttribute(pos, i));
        }
        const usedIndices = new Set(geometry.index.array);
        const unusedIndices = new Set();
        for (let i = 0; i < pos.count; i++) {
            if (!usedIndices.has(i)) {
                unusedIndices.add(i);
            }
        }
        // if (unusedIndices.size > 0) {
        //     console.log(`Unused indices: [${[...unusedIndices]}]`);
        // }

        const hashTriangles = new HashTriangles(geometry.index.array);

        const allEdges = []
        for (const u of usedIndices) {
            for (const v of this.edges.get(u)) {
                if (v <= u) { continue; }
                allEdges.push([u, v]);
            }
        }

        let numSplits = 0;
        for (let i = 0; i < allEdges.length; i++) {
            const [u, v] = allEdges[i];
            for (const w of usedIndices) {
                if (w == u || w == v) { continue; }

                // Fast bounding box check first
                const [a, b, c] = [vertices[u], vertices[v], vertices[w]];
                const minX = Math.min(a.x, b.x) - tolerance, maxX = Math.max(a.x, b.x) + tolerance;
                const minY = Math.min(a.y, b.y) - tolerance, maxY = Math.max(a.y, c.y) + tolerance;
                const minZ = Math.min(a.z, b.z) - tolerance, maxZ = Math.max(a.z, b.z) + tolerance;
                if (c.x < minX || c.y < minY || c.z < minZ || c.x > maxX || c.y > maxY || c.z > maxZ) {
                    continue;
                }

                if (a.distanceToSquared(c) <= tolSq || b.distanceToSquared(c) <= tolSq) {
                    continue;
                }

                const distSq = pointToSegmentDistanceSquared(c, a, b);
                if (distSq < tolSq) {
                    const combinedNeighbors = new Set(this.edges.get(u));
                    this.edges.get(v).forEach((n) => { combinedNeighbors.add(n); })
                    const commonNeighbors = [...combinedNeighbors].filter((n) => this.hasEdge(u, n) && this.hasEdge(v, n));

                    // Remove all triangles u, v, commonNeighbors
                    let removeUvw = false;
                    for (const n of commonNeighbors) {
                        // TODO what about allEdges when removing triangle?
                        if (n == w) {
                            removeUvw = true;
                            continue;
                        }

                        if (pointToSegmentDistanceSquared(a, vertices[n], c) < tolSq || pointToSegmentDistanceSquared(b, vertices[n], c) < tolSq) {
                            removeUvw = false;
                            continue;
                        }

                        if (hashTriangles.remove(u, v, n)) {
                            hashTriangles.add(u, w, n);
                            hashTriangles.add(w, v, n);
                            if (!this.hasEdge(u, w)) { this.addEdge(u, w, true); allEdges.push([u, w]); }
                            if (!this.hasEdge(w, n)) { this.addEdge(w, n, true); allEdges.push([w, n]); }
                            if (!this.hasEdge(n, u)) { this.addEdge(n, u, true); allEdges.push([n, u]); }
                            if (!this.hasEdge(w, v)) { this.addEdge(w, v, true); allEdges.push([w, v]); }
                            if (!this.hasEdge(v, n)) { this.addEdge(v, n, true); allEdges.push([v, n]); }
                            numSplits += 1;
                        }
                        if (hashTriangles.remove(n, v, u)) {
                            hashTriangles.add(n, v, w);
                            hashTriangles.add(w, u, n);
                            if (!this.hasEdge(n, v)) { this.addEdge(n, v, true); allEdges.push([n, v]); }
                            if (!this.hasEdge(v, w)) { this.addEdge(v, w, true); allEdges.push([v, w]); }
                            if (!this.hasEdge(w, n)) { this.addEdge(w, n, true); allEdges.push([w, n]); }
                            if (!this.hasEdge(w, u)) { this.addEdge(w, u, true); allEdges.push([w, u]); }
                            if (!this.hasEdge(u, n)) { this.addEdge(u, n, true); allEdges.push([u, n]); }
                            numSplits += 1;
                        }
                    }
                    if (removeUvw) { hashTriangles.remove(u, v, w); }
                    this.removeEdge(u, v);
                }
            }
        }

        // console.log(`Split ${numSplits} triangles.`);

        const newGeometry = new THREE.BufferGeometry();
        newGeometry.setAttribute('position', pos);
        newGeometry.setIndex(hashTriangles.getIndex());
        return newGeometry;  // TODO verify that this.edges is valid and consider replacing this.geometry instead
    }
}

/**
 * Helper class for managing a set of triangles, ensuring uniqueness and providing efficient add/remove/lookup
 * operations. Triangles are stored in a Map using a canonical key based on sorted indices.
 */
class HashTriangles {
    /**
     * Constructs a HashTriangles instance from an optional index array.
     * @param {Array} indexArray - Flat array of triangle vertex indices.
     */
    constructor(indexArray = []) {
        this.triangles = new Map();
        for (let i = 0; i < indexArray.length; i += 3) {
            let [u, v, w] = [indexArray[i], indexArray[i + 1], indexArray[i + 2]];
            console.assert(u != v && u != w && v != w, "COLLAPSED TRIANGLE in HashTriangles");
            this.add(u, v, w);
        }
    }

    /**
     * Checks if the triangle (u, v, w) exists in the set.
     * @param {number} u 
     * @param {number} v 
     * @param {number} w 
     * @returns {boolean}
     */
    has(u, v, w) {
        const key = this.getKey(u, v, w);
        return this.triangles.has(key);
    }

    /**
     * Adds a triangle (u, v, w) to the set if not already present.
     * @param {number} u 
     * @param {number} v 
     * @param {number} w 
     * @returns {boolean} True if added, false if already present.
     */
    add(u, v, w) {
        const key = this.getKey(u, v, w);
        if (!this.triangles.has(key)) {
            this.triangles.set(key, [u, v, w]);
            return true;
        }
        return false;
    }

    /**
     * Removes the triangle (u, v, w) from the set if present.
     * @param {number} u 
     * @param {number} v 
     * @param {number} w 
     * @returns {boolean} True if removed, false if not found.
     */
    remove(u, v, w) {
        const key = this.getKey(u, v, w);
        if (this.triangles.has(key)) {
            this.triangles.delete(key);
            return true;
        }
        return false;
    }

    /**
     * Returns a string key representing the triangle (u, v, w) in canonical order.
     * @param {number} u 
     * @param {number} v 
     * @param {number} w 
     * @returns {string}
     */
    getKey(u, v, w) {
        return `${this.getUniqueTriangle(u, v, w)}`;
    }

    /**
     * Returns the triangle indices in a canonical (sorted) order.
     * @param {number} u 
     * @param {number} v 
     * @param {number} w 
     * @returns {Array}
     */
    getUniqueTriangle(u, v, w) {
        if (v < u && v < w) {
            [u, v, w] = [v, w, u];
        } else if (w < u && w < v) {
            [u, v, w] = [w, u, v];
        }
        return [u, v, w];
    }

    /**
     * Returns a flat array of all triangle indices in canonical order.
     * @returns {Array}
     */
    getIndex() {
        return [...this.triangles.values()].map(([u, v, w]) => this.getUniqueTriangle(u, v, w)).flat()
    }

    /**
     * Returns an array of all triangle index triplets.
     * @returns {Array}
     */
    getTriangleIndices() {
        return  [...this.triangles.values()];
    }
}

export function* iterateTriangles(geometry) {
    if (geometry.index) {
        const indices = geometry.index.array;
        for (let i = 0; i < indices.length; i += 3) {
            yield [indices[i], indices[i + 1], indices[i + 2]];
        }
    } else {
        for (let i = 0; i < geometry.attributes.position.count; i += 3) {
            yield [i, i + 1, i + 2];
        }
    }
}

function pointToSegmentDistanceSquared(p, a, b) {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ap = new THREE.Vector3().subVectors(p, a);
    const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
    const closest = new THREE.Vector3().copy(ab).multiplyScalar(t).add(a);
    return p.distanceToSquared(closest);
}

export function pointToLineDistanceSquared(point, origin, direction) {
    const originToPoint = new THREE.Vector3().subVectors(point, origin);
    const t = originToPoint.dot(direction) / direction.lengthSq();
    const closest = origin.clone().addScaledVector(direction, t);
    return point.distanceToSquared(closest);
}

export function simplifyGeometry(geometry, resolution = 0.01) {
    const grid = new Map();
    const getKey = (point) => {
        const quantizedPoint = point.clone().multiplyScalar(1 / resolution);
        quantizedPoint.x = resolution * Math.round(quantizedPoint.x);
        quantizedPoint.y = resolution * Math.round(quantizedPoint.y);
        quantizedPoint.z = resolution * Math.round(quantizedPoint.z);
        return `${quantizedPoint.x} ${quantizedPoint.y} ${quantizedPoint.z}`;
    };

    // Map every point to grid coordinates wrt. resolution
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(pos, i);
        const key = getKey(p);
        if (!grid.has(key)) { grid.set(key, []); }
        grid.get(key).push(p);
    }

    // Construct new points as averages of each grid cell and store index
    const newPos = [];
    for (const key of grid.keys()) {
        const averagePoint = new THREE.Vector3();
        for (const point of grid.get(key)) {
            averagePoint.add(point);
        }
        averagePoint.multiplyScalar(1 / grid.get(key).length);
        grid.set(key, newPos.length / 3);
        newPos.push(averagePoint.x, averagePoint.y, averagePoint.z);
    }

    // Translate old indices to new ones using grid coords, ignoring collapsed triangles
    const hashTriangles = new HashTriangles([]);
    for (const [ia, ib, ic] of iterateTriangles(geometry)) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, ia);
        const b = new THREE.Vector3().fromBufferAttribute(pos, ib);
        const c = new THREE.Vector3().fromBufferAttribute(pos, ic);
        const [newia, newib, newic] = [grid.get(getKey(a)), grid.get(getKey(b)), grid.get(getKey(c))];
        if (newia == newib || newia == newic || newib == newic) {
            continue;
        }
        hashTriangles.add(newia, newib, newic);
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPos), 3));
    geometry.setIndex(hashTriangles.getIndex());
}

export class SurfaceSampler {
    constructor(geometry) {
        this.geometry = geometry;
        const pos = geometry.attributes.position;
        this.positions = [];
        for (let i = 0; i < pos.count; i++) {
            const position = new THREE.Vector3().fromBufferAttribute(pos, i);
            this.positions.push(position);
        }
        this.triangles = [];
        for (const [i1, i2, i3] of iterateTriangles(geometry)) {
            const triangle = [this.positions[i1], this.positions[i2], this.positions[i3]];
            this.triangles.push(triangle);
        }
        this.triangleAreas = this.triangles.map((triangle) => {
            const a = triangle[0], b = triangle[1], c = triangle[2];
            const ab = new THREE.Vector3().subVectors(b, a);
            const ac = new THREE.Vector3().subVectors(c, a);
            return 0.5 * ab.cross(ac).length();
        });
        this.totalArea = this.triangleAreas.reduce((sum, area) => sum + area, 0);
    }

    getRandomPoint() {
        // Choose triangle with probability proportional to its area  TODO could sort by area (descending) first
        const randomArea = Math.random() * this.totalArea;
        let cumulativeArea = 0;
        let triangleIndex = 0;
        for (; triangleIndex < this.triangleAreas.length; triangleIndex++) {
            cumulativeArea += this.triangleAreas[triangleIndex];
            if (cumulativeArea >= randomArea) {
                break;
            }
        }

        const [a, b, c] = this.triangles[triangleIndex];
        // Generate random barycentric coordinates
        const u = Math.random();
        const v = Math.random() * (1 - u);
        const w = 1 - u - v;
        // Compute the random point on the triangle
        const randomPoint = new THREE.Vector3()
            .copy(a)
            .multiplyScalar(u)
            .addScaledVector(b, v)
            .addScaledVector(c, w);

        return randomPoint;
    }
}

export function printDuplicateTriangles(geometry) {
    const triangles = new Map();
    for (const indices of iterateTriangles(geometry)) {
        const key = `${[...indices].sort()}`
        if (triangles.has(key)) {
            console.log(`DUPLICATE TRIANGLES: ${triangles.get(key)} vs. ${indices}`);
        } else {
            triangles.set(key, indices);
        }
    }
}

export function printCollapsedTriangles(geometry) {
    const indices = geometry.index.array;
    for (let i = 0; i < indices; i += 3) {
        if (indices[i] == indices[i + 1] || indices[i] == indices[i + 2] || indices[i + 1] == indices[i + 2]) {
            console.log(`COLLAPSED TRIANGLE: ${[indices[i], indices[i + 1], indices[i + 2]]}`);
        }
    }
}
