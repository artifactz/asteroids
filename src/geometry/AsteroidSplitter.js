import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { SUBTRACTION, INTERSECTION, Brush, Evaluator } from 'three-bvh-csg';
import { splitEdgesAtVertices } from '../geometry/EdgeSplitter.js';
import { removeCollapsedTriangles } from '../GeometryUtils.js';


/**
 * Splits an asteroid geometry into two parts at the impact point using a noisy cutter shape.
 * @param {object} asteroid An object with uuid, position, rotation, diameter, and vertexArray
 * @param {object} impact An object with point and velocity
 * @returns {object} An object with parentUuid, parentPosition, parentRotation, splits (array of {offset, vertexArray, normalArray}), impactDirection, and impactRotation
 */
export function splitAsteroid(asteroid, impact) {
    const result = {
        parentUuid: asteroid.uuid,
        parentPosition: { x: asteroid.position.x, y: asteroid.position.y, z: asteroid.position.z },
        parentRotation: { x: asteroid.rotation.x, y: asteroid.rotation.y, z: asteroid.rotation.z },
        splits: []
    };

    const asteroidGeometry = new THREE.BufferGeometry();
    asteroidGeometry.setAttribute("position", new THREE.Float32BufferAttribute(asteroid.vertexArray, 3));

    const asteroidBrush = new Brush(asteroidGeometry);
    asteroidBrush.position.set(asteroid.position.x, asteroid.position.y, asteroid.position.z);
    asteroidBrush.rotation.set(asteroid.rotation.x, asteroid.rotation.y, asteroid.rotation.z);
    asteroidBrush.updateMatrixWorld();

    const boxSize = 2.0 * asteroid.diameter;
    const impactDirection = new THREE.Vector3(impact.velocity.x, impact.velocity.y, impact.velocity.z).normalize();
    const cutterGeo = buildNoisyCutter(boxSize);
    cutterGeo.translate(0.5 * boxSize, 0.0, 0.0);
    const impactRotation = Math.atan2(impactDirection.y, impactDirection.x);

    const cutterBrush = new Brush(cutterGeo);
    cutterBrush.position.set(impact.point.x, impact.point.y, impact.point.z);
    cutterBrush.rotation.set(0, 0, impactRotation + 0.5 * Math.PI);
    cutterBrush.updateMatrixWorld();

    const evaluator = new Evaluator();
    evaluator.attributes = ["position"];
    const A = evaluator.evaluate( asteroidBrush, cutterBrush, SUBTRACTION );
    const B = evaluator.evaluate( asteroidBrush, cutterBrush, INTERSECTION );

    [A, B].forEach(brush => {
        let geo = BufferGeometryUtils.mergeVertices(brush.geometry, 0.0001);
        removeCollapsedTriangles(geo);
        geo = splitEdgesAtVertices(geo);
        geo = BufferGeometryUtils.mergeVertices(geo, 0.04);
        removeCollapsedTriangles(geo);

        geo.translate(-asteroid.position.x, -asteroid.position.y, -asteroid.position.z);
        geo.computeBoundingBox();
        const offset = geo.boundingBox.getCenter(new THREE.Vector3());
        geo.translate(-offset.x, -offset.y, -offset.z);

        geo = geo.toNonIndexed();
        geo.computeVertexNormals();

        result.splits.push({
            offset: {x: offset.x, y: offset.y, z: offset.z},
            vertexArray: geo.attributes.position.array,
            normalArray: geo.attributes.normal.array,
        });
    });

    result.impactDirection = { x: impactDirection.x, y: impactDirection.y, z: impactDirection.z };
    result.impactRotation = impactRotation;
    return result;
}

/**
 * Generates a cube-like geometry that can be used as a CSG parameter to split asteroids.
 * The left face of the box is a noisy, crack-like surface.
 * @param {number} size Size of the cube
 * @param {number} resolution Number of segments along one axis of the crack plane
 * @returns {THREE.BufferGeometry}
 */
function buildNoisyCutter(size, resolution = 15) {
    const front = new THREE.PlaneGeometry(size, size);
    front.translate(0, 0, 0.5 * size);
    const right = new THREE.BufferGeometry().copy(front);
    right.rotateY(0.5 * Math.PI);
    const back = new THREE.BufferGeometry().copy(front);
    back.rotateY(Math.PI);
    const top = new THREE.BufferGeometry().copy(front);
    top.rotateX(-0.5 * Math.PI);
    const bottom = new THREE.BufferGeometry().copy(front);
    bottom.rotateX(0.5 * Math.PI);

    const crack = createCrackPlane(size, size, resolution);

    // Position the plane where the left face would be
    crack.rotateY(-Math.PI / 2);
    crack.translate(-0.5 * size, 0, 0);

    // Merge box and noisy crack
    const merged = BufferGeometryUtils.mergeGeometries([front, right, back, top, bottom, crack]);
    return merged
}

function createCrackPlane(width = 1.0, height = 1.0, segments = 15) {
    const plane = new THREE.PlaneGeometry(width, height, segments, segments);
    const pos = plane.attributes.position;

    const noiseX = 0.5 * width / segments;
    const noiseY = 0.5 * width / segments;
    const noiseZ = 0.5 * Math.max(width, height) / segments;

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);

        // Keep edges straight
        if (Math.abs(x + 0.5 * width) < 1e-4 || Math.abs(x - 0.5 * width) < 1e-4 || Math.abs(y + 0.5 * height) < 1e-4 || Math.abs(y - 0.5 * height) < 1e-4) {
            continue;
        }

        pos.setX(i, x + noiseX * (Math.random() - 0.5));
        pos.setY(i, y + noiseY * (Math.random() - 0.5));
        pos.setZ(i, noiseZ * (Math.random() - 0.5));
    }

    plane.computeVertexNormals();
    return plane;
}
