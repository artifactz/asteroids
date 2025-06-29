import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { SUBTRACTION, INTERSECTION, Brush, Evaluator } from 'three-bvh-csg';
import { GeometryManipulator, simplifyGeometry } from '../GeometryUtils.js';


onmessage = async (message) => {
    const {asteroid, laser} = message.data;
    const result = {
        parentUuid: asteroid.uuid,
        parentPosition: {x: asteroid.position.x, y: asteroid.position.y, z: asteroid.position.z},
        parentRotation: {x: asteroid.rotation.x, y: asteroid.rotation.y, z: asteroid.rotation.z},
        parentRotationalVelocityWorld: asteroid.rotationalVelocityWorld,
        splits: []
    };

    const laserDirection = new THREE.Vector3(laser.velocity.x, laser.velocity.y, laser.velocity.z).normalize();
    const boxSize = 2.0 * asteroid.diameter;

    console.time('buildNoisyCutter');
    const cutterGeo = buildNoisyCutter(boxSize);
    console.timeEnd('buildNoisyCutter');
    cutterGeo.translate(0.5 * boxSize, 0.0, 0.0);
    const laserRotation = Math.atan2(laserDirection.y, laserDirection.x);
    cutterGeo.rotateZ(laserRotation + 0.5 * Math.PI);

    asteroid.geometry = new THREE.BufferGeometry();
    asteroid.geometry.setAttribute("position", new THREE.Float32BufferAttribute(asteroid.vertexArray, 3));
    asteroid.geometry.setAttribute("normal", new THREE.Float32BufferAttribute(asteroid.normalArray, 3));
    asteroid.geometry.setIndex(new THREE.Uint16BufferAttribute(asteroid.indexArray, 1));
    // simplifyGeometry(asteroid.geometry, 0.04);
    // asteroid.geometry.computeVertexNormals();

    const brush1 = new Brush(asteroid.geometry);
    brush1.position.set(asteroid.position.x, asteroid.position.y, asteroid.position.z);
    brush1.rotation.set(asteroid.rotation.x, asteroid.rotation.y, asteroid.rotation.z);
    brush1.updateMatrixWorld();

    const brush2 = new Brush(cutterGeo);
    brush2.position.copy(laser.position);
    brush2.position.addScaledVector(laserDirection, 0.5 * asteroid.diameter);
    brush2.updateMatrixWorld();

    const evaluator = new Evaluator();
    evaluator.attributes = ["position", "normal"];
    console.time('evaluate1');
    const A = evaluator.evaluate( brush1, brush2, SUBTRACTION );
    console.timeEnd('evaluate1');
    console.time('evaluate2');
    const B = evaluator.evaluate( brush1, brush2, INTERSECTION );
    console.timeEnd('evaluate2');

    [A, B].forEach(brush => {
        // printDuplicateTriangles(brush.geometry);

        console.time('cleanGeo');
        const cleanGeo = new GeometryManipulator(BufferGeometryUtils.mergeVertices(brush.geometry, 0.0001)).splitTrianglesOnTouchingVertices();
        console.timeEnd('cleanGeo');
        // TODO replace with simplifyGeometry
        const geo = BufferGeometryUtils.mergeVertices(cleanGeo, 0.01);

        // printCollapsedTriangles(geo);

        geo.translate(-asteroid.position.x, -asteroid.position.y, -asteroid.position.z);
        geo.computeBoundingBox();
        const offset = geo.boundingBox.getCenter(new THREE.Vector3());
        geo.translate(-offset.x, -offset.y, -offset.z);

        geo.setIndex(new GeometryManipulator(geo).removeCollapsedTriangles());
        geo.computeVertexNormals();

        result.splits.push({
            offset: {x: offset.x, y: offset.y, z: offset.z},
            vertexArray: geo.attributes.position.array,
            normalArray: geo.attributes.normal.array,
            indexArray: geo.index.array,
        });

    });

    result.laserDirection = {x: laserDirection.x, y: laserDirection.y, z: laserDirection.z};
    result.laserRotation = laserRotation;

    // await new Promise(r => setTimeout(r, 1000));
    postMessage(result);
};

function buildNoisyCutter(boxSize, resolution = 15, amplitude = 0.1) {
    const front = new THREE.PlaneGeometry(boxSize, boxSize);
    front.translate(0, 0, 0.5 * boxSize);
    const right = new THREE.BufferGeometry().copy(front);
    right.rotateY(0.5 * Math.PI);
    const back = new THREE.BufferGeometry().copy(front);
    back.rotateY(Math.PI);
    const top = new THREE.BufferGeometry().copy(front);
    top.rotateX(-0.5 * Math.PI);
    const bottom = new THREE.BufferGeometry().copy(front);
    bottom.rotateX(0.5 * Math.PI);

    const crack = createCrackPlane(boxSize, boxSize, resolution, amplitude);

    // Position the plane where the left face would be
    crack.rotateY(-Math.PI / 2);
    crack.translate(-0.5 * boxSize, 0, 0);

    // Merge box and noisy crack
    const merged = BufferGeometryUtils.mergeGeometries([front, right, back, top, bottom, crack]);
    return merged
}

function createCrackPlane(width = 1.0, height = 1.0, segments = 20, amplitude = 0.1) {
    const plane = new THREE.PlaneGeometry(width, height, segments, segments);
    const pos = plane.attributes.position;

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);

        // Keep edges straight
        if (Math.abs(x + 0.5 * width) < 1e-4 || Math.abs(x - 0.5 * width) < 1e-4 || Math.abs(y + 0.5 * height) < 1e-4 || Math.abs(y - 0.5 * height) < 1e-4) {
            continue;
        }

        const noise = amplitude * (Math.random() - 0.5);

        pos.setZ(i, noise); // displace along Z-axis
    }

    plane.computeVertexNormals();
    return plane;
}
