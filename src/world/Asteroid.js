import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { computeMeshVolume } from 'three-bvh-csg';

const defaultAsteroidMat = new THREE.MeshStandardMaterial({ color: 0x888888, flatShading: true, depthWrite: true });

export function createAsteroidGeometry(radius = 0.9) {
    let geo = new THREE.IcosahedronGeometry(radius, 2);
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    // TODO replace with simplifyGeometry / reduce tolerance
    geo = BufferGeometryUtils.mergeVertices(geo, 0.09);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        v.addScaledVector(v.clone().normalize(), (Math.random() - 0.5) * 0.4);
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
}

export function createAsteroid(geometry, rotationSpeed = 0.4, randomHealth = 40) {
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, defaultAsteroidMat);
    mesh.userData.velocity = new THREE.Vector3(0, 0, 0);
    mesh.userData.rotationalVelocity = new THREE.Vector3(
        rotationSpeed * (Math.random() - 0.5),
        rotationSpeed * (Math.random() - 0.5),
        rotationSpeed * (Math.random() - 0.5)
        // 0.5, 0.0, 0.0  // XXX
    );
    mesh.userData.zPush = 0.02;
    mesh.userData.diameter = 2 * geometry.boundingSphere.radius;
    mesh.userData.volume = computeMeshVolume(mesh);
    mesh.userData.asteroidCollisionCooldownPeriod = 0.1;
    mesh.userData.asteroidCollisionHeat = new Map();
    mesh.userData.health = 30 * Math.sqrt(mesh.userData.volume) + randomHealth * Math.random();
    mesh.userData.splitAge = null;
    return mesh;
}
