import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { getRotatedPointVelocity } from '../GeometryUtils';

/** Creates "material". */
export function createDebris(asteroid, materialValue, timestamp) {
    let geometry = new THREE.IcosahedronGeometry(0.06, 0);
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    geometry = BufferGeometryUtils.mergeVertices(geometry, 0.001);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        v.addScaledVector(v.clone(), (Math.random() - 0.5) * 0.7);
        pos.setXYZ(i, v.x, v.y, v.z);
    }

    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.1, emissive: 0x44ff00, emissiveIntensity: 0.05, metalness: 1.0 });
    const mesh = new THREE.Mesh(geometry, material);

    const position = asteroid.localToWorld(asteroid.userData.surfaceSampler.getRandomPoint());
    mesh.position.copy(position);
    mesh.userData = {
        timestamp: timestamp,
        ttl: 120,
        fadeoutTime: 10,
        materialValue,
        velocity: getRotatedPointVelocity(position, asteroid),
        velocityDecay: 0.5,
        takeProgress: null,
        takeOriginalPosition: null,
    }

    return mesh;
}
