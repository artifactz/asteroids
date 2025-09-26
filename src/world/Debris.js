import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { getRotatedPointVelocity, pointToLineDistanceSquared } from '../geometry/GeometryUtils.js';
import { DebrisParameters } from '../Parameters.js';

const debrisMaterial = new THREE.MeshStandardMaterial({ color: 0xb0f0b0, roughness: 0.1, emissive: 0x44ff00, emissiveIntensity: 0.05, metalness: 0.8 });

/** Creates debris (aka. material). */
export function createDebris(asteroid, materialValue, timestamp) {
    let geometry = new THREE.IcosahedronGeometry(DebrisParameters.radius, 0);
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    geometry = BufferGeometryUtils.mergeVertices(geometry, 0.001);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        v.addScaledVector(v.clone(), (Math.random() - 0.5) * DebrisParameters.noise);
        pos.setXYZ(i, v.x, v.y, v.z);
    }

    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, debrisMaterial);

    const position = asteroid.localToWorld(asteroid.userData.surfaceSampler.getRandomPoint());
    const velocity = getRotatedPointVelocity(position, asteroid);

    // Add random velocity
    if (Math.random() < DebrisParameters.randomSpeedProbability) {
        const alpha = Math.PI * Math.random(), beta = 2 * Math.PI * Math.random(), r = DebrisParameters.maxRandomSpeed * Math.random();
        velocity.x += r * Math.sin(alpha) * Math.cos(beta);
        velocity.y += r * Math.sin(alpha) * Math.sin(beta);
        velocity.z += r * Math.cos(alpha);
    }

    // Add outward velocity (impact point -> debris position)
    const impact = asteroid.userData.recentImpact;
    const outwardDirection = position.clone().sub(impact.point).normalize();
    velocity.addScaledVector(outwardDirection, (DebrisParameters.baseOutwardVelocity + DebrisParameters.randomOutwardVelocity * Math.random()));

    // Add impact velocity to debris near impact line
    const dist = pointToLineDistanceSquared(position, impact.point, impact.velocity);
    velocity.addScaledVector(impact.velocity, DebrisParameters.baseImpactVelocity * Math.exp(-DebrisParameters.impactVelocityFalloff * dist));

    mesh.position.copy(position);
    mesh.userData = {
        timestamp,
        ttl: 120,
        fadeoutTime: 10,
        materialValue,
        velocity,
        velocityDecay: 0.5,
        takeProgress: null,
        takeOriginalPosition: null,
    }

    return mesh;
}


/** For loading scenes. */
export function createDummyDebris() {
    return new THREE.Mesh(new THREE.BoxGeometry(), debrisMaterial);
}
