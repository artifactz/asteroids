import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { computeMeshVolume } from 'three-bvh-csg';
import { getRotatedPointVelocity, pointToLineDistanceSquared } from '../geometry/GeometryUtils.js';
import { DebrisParameters, AsteroidParameters } from '../Parameters.js';


export const debrisMaterial = new THREE.MeshStandardMaterial({
    color: 0xb0f0b0,
    roughness: DebrisParameters.materialRoughness,
    emissive: 0x44ff00,
    emissiveIntensity: DebrisParameters.materialEmissiveIntensity,
    metalness: DebrisParameters.materialMetalness,
    opacity: DebrisParameters.materialBaseOpacity,
    transparent: true,
    flatShading: true
});
const takeDistSq = DebrisParameters.takeDistance * DebrisParameters.takeDistance;
const takeFinishDistSq = DebrisParameters.takeFinishDistance * DebrisParameters.takeFinishDistance;


/**
 * Manages pieces of debris (aka. material) for the player to pick up.
 * 
 * The typical lifecycle of a material piece is:
 * * Created as a unique mesh with pre-generated geometry chosen randomly, flying out of an exploding asteroid.
 * * Appearance transformed from "asteroid" to "debris" by blending material parameters.
 * * Moved to InstancedMesh for efficient rendering once material transformation is complete.
 * * When the player gets close, physics is removed and it is sucked into the player.
 */
export class DebrisManager {
    constructor(scene, physics) {
        this.scene = scene;
        this.physics = physics;
        const geometries = createDebrisGeometries();
        this.instancedMeshes = [...geometries.map(g => {
            const instaMesh = new THREE.InstancedMesh(g, debrisMaterial, 1000);
            instaMesh.count = 0;
            return instaMesh;
        })];
        this.instancedData = [...geometries.map(_ => [])];
        this.uniqueDebris = [];

        this.instancedMeshes.forEach(instancedMesh => { this.scene.add(instancedMesh); });
    }

    /**
     * Creates a piece of debris (aka. material) for the player to pick up.
     * @param {THREE.Mesh} asteroid Exploding asteroid
     * @param {number} materialValue Material value of this piece
     * @param {number} timestamp Current world time
     * @param {boolean} byLaser Whether the asteroid was destroyed by laser (true) or crashed with another asteroid (false)
     */
    createDebris(asteroid, materialValue, timestamp, byLaser) {
        const geometryIndex = Math.floor(Math.random() * this.instancedMeshes.length);

        const mesh = new THREE.Mesh(this.instancedMeshes[geometryIndex].geometry, debrisMaterial.clone());
        const debrisData = createDebrisData(asteroid, materialValue, timestamp, byLaser);
        debrisData.userData.geometryIndex = geometryIndex;
        this.addUniqueDebris(mesh, debrisData)
    }

    addUniqueDebris(mesh, { position, quaternion, userData }, physics = true) {
        mesh.position.copy(position);
        mesh.quaternion.copy(quaternion);
        mesh.userData = userData;
        mesh.userData.isPhysicsControlled = physics;
        mesh.userData.isUnique = true;

        if (physics) { this.physics.add(mesh, undefined, false); }

        this.uniqueDebris.push(mesh);
        this.scene.add(mesh);
    }

    /**
     * Updates all debris pieces.
     * @returns { newTakes: number, takenMaterial: number } Number of new takes initiated and total material value taken this frame
     */
    update(time, dt, playerPosition) {
        const uniques = this.updateUnique(time, dt, playerPosition);
        const instances = this.updateInstanced(time, dt, playerPosition);
        return { newTakes: uniques.newTakes + instances.newTakes, takenMaterial: uniques.takenMaterial + instances.takenMaterial };
    }

    updateUnique(time, dt, playerPosition) {
        let newTakes = 0;
        let takenMaterial = 0;

        for (const debris of this.uniqueDebris) {
            transformDebrisFromAsteroid(debris, dt);
            if (this.beginTakeDebris(debris, playerPosition)) { newTakes++; };
            takenMaterial += this.takeDebris(debris, playerPosition, dt);
            this.checkStale(debris);

            if (time > debris.userData.timestamp + debris.userData.ttl - debris.userData.fadeoutTime) {
                if (time < debris.userData.timestamp + debris.userData.ttl) {
                    // Fade out
                    const alpha = (debris.userData.timestamp + debris.userData.ttl - time) / debris.userData.fadeoutTime;
                    debris.material.opacity = DebrisParameters.materialBaseOpacity * alpha;
                } else {
                    // Discard
                    debris.userData.isRemoved = true;
                }
            }

            if (debris.material === debrisMaterial) {
                // Move to instanced
                const instancedMesh = this.instancedMeshes[debris.userData.geometryIndex];
                const i = instancedMesh.count++;
                instancedMesh.setMatrixAt(i, debris.matrixWorld);
                instancedMesh.instanceMatrix.needsUpdate = true;
                instancedMesh.computeBoundingBox(); // won't render otherwise
                instancedMesh.computeBoundingSphere();
                debris.userData.isUnique = false;
                this.instancedData[debris.userData.geometryIndex].push({
                    position: debris.position, quaternion: debris.quaternion, userData: debris.userData
                });
                this.scene.remove(debris);
            }

            if (debris.userData.isRemoved) {
                this.scene.remove(debris);
            }
        }

        this.uniqueDebris = this.uniqueDebris.filter(d => !d.userData.isRemoved && d.userData.isUnique);

        return { newTakes, takenMaterial };
    }

    updateInstanced(time, dt, playerPosition) {
        let newTakes = 0;
        let takenMaterial = 0;
        const matrix = new THREE.Matrix4();

        for (const instancedData of this.instancedData) {
            for (let i = 0; i < instancedData.length; i++) {
                const debris = instancedData[i];
                const geometryIndex = debris.userData.geometryIndex;
                const instancedMesh = this.instancedMeshes[geometryIndex];

                if (this.beginTakeDebris(debris, playerPosition)) {
                    newTakes++;
                    // Set pose from instance matrix, in case it was changed while stale
                    instancedMesh.getMatrixAt(i, matrix);
                    matrix.decompose(debris.position, debris.quaternion, new THREE.Vector3());
                    debris.userData.takeOriginalPosition = debris.position.clone();
                };
                takenMaterial += this.takeDebris(debris, playerPosition, dt);
                this.checkStale(debris);

                if (time > debris.userData.timestamp + debris.userData.ttl - debris.userData.fadeoutTime) {
                    // Move to unique for fadeout
                    const material = debrisMaterial.clone();
                    const mesh = new THREE.Mesh(instancedMesh.geometry, material);
                    this.addUniqueDebris(mesh, debris, false);
                    debris.userData.isRemoved = true;
                }

                if (debris.userData.isRemoved) {
                    this.removeInstance(geometryIndex, i);
                    i--;

                } else if (!debris.userData.isStale) {
                    // Update pose
                    matrix.makeTranslation(debris.position).multiply(new THREE.Matrix4().makeRotationFromQuaternion(debris.quaternion));
                    instancedMesh.setMatrixAt(i, matrix);
                    instancedMesh.instanceMatrix.needsUpdate = true;
                }
            }
        }

        return { newTakes, takenMaterial };
    }

    removeInstance(geometryIndex, instanceIndex) {
        const instancedMesh = this.instancedMeshes[geometryIndex];
        const instancedData = this.instancedData[geometryIndex];

        if (instanceIndex < instancedData.length - 1) {
            instancedData[instanceIndex] = instancedData[instancedData.length - 1];
            instancedData[instanceIndex].userData.instanceIndex
            const lastMatrix = new THREE.Matrix4();
            instancedMesh.getMatrixAt(instancedMesh.count - 1, lastMatrix);
            instancedMesh.setMatrixAt(instanceIndex, lastMatrix);
            instancedMesh.instanceMatrix.needsUpdate = true;
        }

        instancedData.pop();
        instancedMesh.count--;
    }

    beginTakeDebris(debris, playerPosition) {
        if (debris.userData.takeProgress !== null || !playerPosition) { return false; }

        const offset = new THREE.Vector2(debris.position.x, debris.position.y).sub(new THREE.Vector2(playerPosition.x, playerPosition.y));
        if (offset.lengthSq() > takeDistSq) { return false; }

        // Initiate being sucked in
        this.removeDebrisPhysics(debris);
        debris.userData.takeProgress = 0;
        debris.userData.takeOriginalPosition = debris.position.clone();
        debris.userData.isStale = false;

        return true;
    }

    takeDebris(debris, playerPosition, dt) {
        if (debris.userData.takeProgress === null || !playerPosition) { return 0; }

        if (debris.userData.takeProgress >= 1 || debris.position.clone().sub(playerPosition).lengthSq() < takeFinishDistSq) {
            // Collect
            debris.userData.isRemoved = true;
            return debris.userData.materialValue;
        }

        // Suck in
        debris.userData.takeProgress += dt / DebrisParameters.takeDuration;
        const alpha = debris.userData.takeProgress * debris.userData.takeProgress;
        const position = debris.userData.takeOriginalPosition.clone().multiplyScalar(1 - alpha).addScaledVector(playerPosition, alpha);
        debris.position.copy(position);
        return 0;
    }

    /**
     * Stops physics when movement becomes slow to avoid drifting towards z = 0 forever,
     * because the created depth looks good (also might benefit performance).
     * @param {THREE.Mesh | Object} debris
     */
    checkStale(debris) {
        if (
            !debris.userData.isStale &&
            debris.userData.takeProgress === null &&
            debris.position.z > DebrisParameters.staleMinZ && debris.position.z < DebrisParameters.staleMaxZ &&
            debris.userData.velocity.lengthSq() < DebrisParameters.staleMaxSpeedSquared &&
            debris.userData.rotationalVelocity.lengthSq() < DebrisParameters.staleMaxSpeedSquared
        ) {
            this.removeDebrisPhysics(debris);
            debris.userData.isStale = true;
        }
    }

    removeDebrisPhysics(debris) {
        if (debris.userData.isPhysicsControlled) {
            this.physics.remove(debris);
            debris.userData.isPhysicsControlled = false;
        }
    }
}

export function createDebrisData(asteroid, materialValue, timestamp, byLaser) {
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

    const rotation = new THREE.Euler(Math.random() * 2 * Math.PI, Math.random() * 2 * Math.PI, Math.random() * 2 * Math.PI);
    const quaternion = new THREE.Quaternion().setFromEuler(rotation);
    const rotationSpeed = DebrisParameters.rotationalVelocity * impact.velocity.length();
    const rotationalVelocity = new THREE.Vector3(
        rotationSpeed * (Math.random() - 0.5) * (Math.random() - 0.5),
        rotationSpeed * (Math.random() - 0.5) * (Math.random() - 0.5),
        rotationSpeed * (Math.random() - 0.5) * (Math.random() - 0.5)
    );

    return {
        position, quaternion,
        userData: {
            timestamp,
            ttl: DebrisParameters.ttl,
            fadeoutTime: DebrisParameters.fadeoutTime,
            materialValue,
            velocity,
            rotationalVelocity,
            velocityDecay: DebrisParameters.velocityDecay,
            steer0P: 0.001,
            steer0D: 0.5,
            transformProgress: 0,
            initialColor: (byLaser) ? DebrisParameters.initialColorByLaser : DebrisParameters.initialColorByCrash,
            takeProgress: null,
            takeOriginalPosition: null,
            isStale: false,
            type: "debris",
        }
    };
}

/**
 * Generates debris geometries to be used for instanced rendering.
 * @param {*} initialSamples Number of initial geometries to generate
 * @param {*} removeRoundest Number of roundest geometries to discard
 * @returns {THREE.BufferGeometry[]} The smallest, medium, and largest remaining geometries
 */
function createDebrisGeometries(initialSamples = 30, removeRoundest = 20) {
    const geometries = [...Array(initialSamples).entries().map(() => createDebrisGeometry())];
    const volume = new Map(geometries.map(g => [g, computeMeshVolume(g)]));
    const roundness = new Map(geometries.map(g => {
        g.computeBoundingBox();
        const shortSide = Math.min(g.boundingBox.max.x - g.boundingBox.min.x, g.boundingBox.max.y - g.boundingBox.min.y, g.boundingBox.max.z - g.boundingBox.min.z);
        const longSide = Math.max(g.boundingBox.max.x - g.boundingBox.min.x, g.boundingBox.max.y - g.boundingBox.min.y, g.boundingBox.max.z - g.boundingBox.min.z);
        return [g, shortSide / longSide];
    }));
    geometries.sort((a, b) => roundness.get(a) - roundness.get(b));
    geometries.splice(geometries.length - removeRoundest, removeRoundest);
    geometries.sort((a, b) => volume.get(a) - volume.get(b))

    return [geometries[0], geometries[Math.ceil(geometries.length / 2)], geometries[geometries.length - 1]];
}

function createDebrisGeometry() {
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
    return geometry;
}

/** Material lerp from "asteroid" to "debris" */
function transformDebrisFromAsteroid(debris, dt) {
    if (debris.userData.transformProgress >= 1) { return; }

    debris.material.color = debris.userData.initialColor.clone().lerp(debrisMaterial.color, debris.userData.transformProgress);
    debris.material.roughness = (1 - debris.userData.transformProgress) * AsteroidParameters.materialRoughness +
                                debris.userData.transformProgress * DebrisParameters.materialRoughness;
    debris.material.emissiveIntensity = debris.userData.transformProgress * 0.05;
    debris.material.metalness = debris.userData.transformProgress * DebrisParameters.materialMetalness;
    debris.userData.transformProgress += dt / DebrisParameters.transformDuration;
    if (debris.userData.transformProgress >= 1) {
        debris.material = debrisMaterial;
    }
}

/** For loading scenes. */
export function createDummyDebris() {
    return new THREE.Mesh(new THREE.BoxGeometry(), debrisMaterial);
}
