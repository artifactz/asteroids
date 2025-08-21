import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { SUBTRACTION, INTERSECTION, Brush, Evaluator } from 'three-bvh-csg';
import { GeometryManipulator, simplifyGeometry } from '../GeometryUtils.js';


onmessage = async (message) => {
    const { asteroid, impact } = message.data;
    const result = {
        parentUuid: asteroid.uuid,
        parentPosition: { x: asteroid.position.x, y: asteroid.position.y, z: asteroid.position.z },
        parentRotation: { x: asteroid.rotation.x, y: asteroid.rotation.y, z: asteroid.rotation.z },
        parentRotationalVelocityWorld: asteroid.rotationalVelocityWorld,
        splits: []
    };

    const impactDirection = new THREE.Vector3(impact.velocity.x, impact.velocity.y, impact.velocity.z).normalize();
    const boxSize = 2.0 * asteroid.diameter;

    console.time('buildNoisyCutter');
    const cutterGeo = buildNoisyCutter(boxSize);
    console.timeEnd('buildNoisyCutter');
    cutterGeo.translate(0.5 * boxSize, 0.0, 0.0);
    const impactRotation = Math.atan2(impactDirection.y, impactDirection.x);
    cutterGeo.rotateZ(impactRotation + 0.5 * Math.PI);

    asteroid.geometry = new THREE.BufferGeometry();
    asteroid.geometry.setAttribute("position", new THREE.Float32BufferAttribute(asteroid.vertexArray, 3));
    asteroid.geometry.setAttribute("normal", new THREE.Float32BufferAttribute(asteroid.normalArray, 3));

    const brush1 = new Brush(asteroid.geometry);
    brush1.position.set(asteroid.position.x, asteroid.position.y, asteroid.position.z);
    brush1.rotation.set(asteroid.rotation.x, asteroid.rotation.y, asteroid.rotation.z);
    brush1.updateMatrixWorld();

    const brush2 = new Brush(cutterGeo);
    brush2.position.set(impact.point.x, impact.point.y, impact.point.z);
    brush2.position.addScaledVector(impactDirection, 0.5 * asteroid.diameter);
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
        let geo = new GeometryManipulator(BufferGeometryUtils.mergeVertices(brush.geometry, 0.0001)).splitTrianglesOnTouchingVertices();
        console.timeEnd('cleanGeo');
        // TODO replacing with simplifyGeometry here crashes
        geo = BufferGeometryUtils.mergeVertices(geo, 0.01);

        // printCollapsedTriangles(geo);

        geo.translate(-asteroid.position.x, -asteroid.position.y, -asteroid.position.z);
        geo.setIndex(new GeometryManipulator(geo).removeCollapsedTriangles());
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

function createCrackPlane(width = 1.0, height = 1.0, segments = 20) {
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
