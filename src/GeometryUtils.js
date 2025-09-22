import * as THREE from 'three';


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

/**
 * Iterates over Vector3 points of a mesh or group (and its sub-groups) in the local coordinate frame of the given object.
 * @param {THREE.Group | THREE.Mesh} group
 */
export function* iteratePoints(group) {
    if (group instanceof THREE.Mesh) {
        const mesh = group;
        const pos = mesh.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            yield new THREE.Vector3().fromBufferAttribute(pos, i);
        }
    } else if (group.children) {
        for (const child of group.children) {
            for (const point of iteratePoints(child)) {
                point.applyEuler(child.rotation);
                point.multiply(child.scale);
                point.add(child.position);
                yield point;
            }
        }
    } else {
        throw new Error("Unsupported group type for iteratePoints");
    }
}

export function pointToLineDistanceSquared(point, origin, direction) {
    const originToPoint = new THREE.Vector3().subVectors(point, origin);
    const t = originToPoint.dot(direction) / direction.lengthSq();
    const closest = origin.clone().addScaledVector(direction, t);
    return point.distanceToSquared(closest);
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

export function getRotatedPointVelocity(point, obj, resolution = 0.01) {
    const transformedPoint = point.clone().sub(obj.position);
    transformedPoint.applyAxisAngle(new THREE.Vector3(1, 0, 0), resolution * obj.userData.rotationalVelocity.x);
    transformedPoint.applyAxisAngle(new THREE.Vector3(0, 1, 0), resolution * obj.userData.rotationalVelocity.y);
    transformedPoint.applyAxisAngle(new THREE.Vector3(0, 0, 1), resolution * obj.userData.rotationalVelocity.z);
    transformedPoint.x += resolution * obj.userData.velocity.x + obj.position.x;
    transformedPoint.y += resolution * obj.userData.velocity.y + obj.position.y;
    transformedPoint.z += resolution * obj.userData.velocity.z + obj.position.z;
    const velocity = transformedPoint.clone().sub(point).multiplyScalar(1 / resolution);
    return velocity;
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

export function removeCollapsedTriangles(geometry, verbose = false) {
    const newIndex = [];
    let removed = 0;
    for (let i = 0; i < geometry.index.array.length; i += 3) {
        const [i1, i2, i3] = geometry.index.array.slice(i, i + 3);
        if (i1 == i2 || i1 == i3 || i2 == i3) {
            removed++;
            continue;
        }
        newIndex.push(i1, i2, i3);
    }
    geometry.setIndex(newIndex);
    if (verbose && removed) { console.log(`Removed ${removed} collapsed triangles`); }
}
