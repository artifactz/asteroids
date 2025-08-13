import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SUBTRACTION, Brush, Evaluator } from 'three-bvh-csg';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import Ammo from 'ammo.js';
import { createAsteroid, createAsteroidGeometry } from './world/Asteroid.js';
import { Universe, UniverseLayer } from './world/Universe.js';
import { ParticleSystem } from './Particles.js';
import { GeometryManipulator, simplifyGeometry, iteratePoints, printDuplicateTriangles, printCollapsedTriangles } from './GeometryUtils.js';
import AsteroidSplitWorker from './workers/AsteroidSplitWorker.js?worker';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;


/**
 * World class that manages the game scene, camera, and physics.
 */
export class World {
    /**
     * @param {THREE.DepthTexture} depthTexture  Main scene depth buffer for the particle renderer.
     */
    constructor(depthTexture, asteroidExplosionVolume = 0.15, asteroidRemovalDistance = 60) {
        this.asteroidExplosionVolume = asteroidExplosionVolume;
        this.asteroidRemovalDistance = asteroidRemovalDistance;
        this.scene = new THREE.Scene();
        this.clearColor = new THREE.Color(0x000000);

        this.camera = this.createCamera();
        this.addDefaultLights();
        this.universe = new Universe(this.scene, this.camera);
        this.player = this.createPlayer();
        this.scene.add(this.player);

        this.asteroids = [];
        this.lasers = [];
        this.particles = new ParticleSystem(this.scene, this.camera, depthTexture);

        this.splitWorker = new AsteroidSplitWorker();
        /** Handles worker results. */
        this.splitWorker.onmessage = (message) => {
            let sign = 1;
            const parentAsteroid = this.asteroids.find((a) => a.uuid == message.data.parentUuid);
            message.data.splits.forEach((result) => {
                // Mesh
                result.geometry = new THREE.BufferGeometry();
                result.geometry.setAttribute("position", new THREE.Float32BufferAttribute(result.vertexArray, 3));
                result.geometry.setAttribute("normal", new THREE.Float32BufferAttribute(result.normalArray, 3));
                result.geometry.setIndex(new THREE.Uint16BufferAttribute(result.indexArray, 1));
                const mesh = createAsteroid(result.geometry);

                // Rotation since split begin
                const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
                    parentAsteroid.userData.rotationalVelocity.x * parentAsteroid.userData.splitAge,
                    parentAsteroid.userData.rotationalVelocity.y * parentAsteroid.userData.splitAge,
                    parentAsteroid.userData.rotationalVelocity.z * parentAsteroid.userData.splitAge,
                ));
                // Rotated offset of new center to parent center
                const transform = rotation.clone().multiply(new THREE.Matrix4().makeTranslation(result.offset.x, result.offset.y, result.offset.z));
                transform.decompose(mesh.position, mesh.quaternion, mesh.scale);
                mesh.position.add(parentAsteroid.position);

                // Velocity
                const parentWeight = 0.95;
                const repellingWeight = 0.1;
                const laserWeight = 0.04;
                const repellingVector = new THREE.Vector3(
                    Math.cos(message.data.laserRotation - sign * 0.5 * Math.PI),
                    Math.sin(message.data.laserRotation - sign * 0.5 * Math.PI),
                    0
                );
                mesh.userData.velocity = parentAsteroid.userData.velocity.clone()
                    .multiplyScalar(parentWeight)
                    .addScaledVector(repellingVector, repellingWeight)
                    .addScaledVector(message.data.laserDirection, laserWeight);
                mesh.userData.velocity.z = 0.2 * -Math.sign(mesh.position.z);  // toward z=0

                // Rotational velocity
                const randomWeight = 0.1;
                const randomRotation = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
                const outwardWeight = 0.3;
                const outwardRotatation = new THREE.Vector3(-rotation.elements[2], -rotation.elements[6], -rotation.elements[10]);
                mesh.userData.rotationalVelocity = new THREE.Vector3(
                    message.data.parentRotationalVelocityWorld.x,
                    message.data.parentRotationalVelocityWorld.y,
                    message.data.parentRotationalVelocityWorld.z
                )
                    .multiplyScalar(parentWeight)
                    .addScaledVector(randomRotation, randomWeight)
                    .addScaledVector(outwardRotatation, outwardWeight * sign);

                // Move away from other asteroid part ever so slightly to avoid overlap
                mesh.position.addScaledVector(repellingVector, 0.002);

                mesh.userData.recentHit = parentAsteroid.userData.recentHit;

                sign *= -1;

                this.scene.add(mesh);
                this.asteroids.push(mesh);
                console.time('addRigidBodyPhysics');
                this.addRigidBodyPhysics(mesh, mesh.userData.volume);
                console.timeEnd('addRigidBodyPhysics');

            });

            // Currently not used due to ammo.js
            const a = this.asteroids[this.asteroids.length - 2];
            const b = this.asteroids[this.asteroids.length - 1];
            a.userData.asteroidCollisionHeat.set(b, a.userData.asteroidCollisionCooldownPeriod);
            b.userData.asteroidCollisionHeat.set(a, b.userData.asteroidCollisionCooldownPeriod);

            this.scene.remove(parentAsteroid);
            this.asteroids = this.asteroids.filter(a => a !== parentAsteroid);

        };
    }

    createCamera() {
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 5, 1000);
        camera.position.set(0, 0, 10);
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, 0);
        camera.userData.slackPerSecond = 0.001;
        return camera;
    }

    addDefaultLights() {
        const dLight = new THREE.DirectionalLight(0xffffff, 1);
        dLight.position.set(5, 5, 10);
        const aLight = new THREE.AmbientLight(0x707070);
        this.scene.add(dLight);
        this.scene.add(aLight);
    }

    createPlayer() {
        const player = new THREE.Group();
        const loader = new GLTFLoader();
        loader.load("media/spacecraft.glb", (gltf) => {
            gltf.scene.position.z = -0.1;
            gltf.scene.rotation.x = 0.5 * Math.PI;
            gltf.scene.rotation.y = 0.5 * Math.PI;
            gltf.scene.scale.set(0.0667, 0.0667, 0.0667);
            player.add(gltf.scene);

            if (this.shouldInitializePlayerPhysics) {
                this.addRigidBodyPhysics(this.player, this.player.userData.mass);
            } else {
                this.shouldInitializePlayerPhysics = true;
            }
        });
        player.userData = {
            maxSpeed: 8.0,
            speed: 0.0,
            maxAccel: 6.0,
            accel: 0.0,
            maxRotationalSpeed: 3.8,
            laserCooldownPeriod: 0.2,
            laserHeat: 0.0,
            laserSpreadRad: 0.01 * Math.PI,
            laserSpeed: 16,
            rotationalVelocity: new THREE.Vector3(0, 0, 0),
            mass: 0.18,
            isAlive: true,
            material: 0.0,
        }

        Object.defineProperty(player.userData, "velocity", {
            get: function () { return new THREE.Vector3(
                player.userData.speed * Math.cos(player.rotation.z),
                player.userData.speed * Math.sin(player.rotation.z),
                0
            ); }
        })

        return player;
    }

    updatePlayer(dt) {
        if (this.player.userData.physicsBody) {
            // Check if a collision happened
            const pVel = this.player.userData.physicsBody.getLinearVelocity();
            const oVel = this.player.userData.originalVelocity;
            if (oVel && (oVel.x() != pVel.x() || oVel.y() != pVel.y() || oVel.z() != pVel.z())) {
                this.handlePlayerCollision();
            }
        }

        // Handle movement at mesh level
        this.player.userData.speed += this.player.userData.accel * dt;
        this.player.userData.speed = Math.max(-this.player.userData.maxSpeed, Math.min(this.player.userData.speed, this.player.userData.maxSpeed));
        this.player.position.set(
            this.player.position.x + dt * Math.cos(this.player.rotation.z) * this.player.userData.speed,
            this.player.position.y + dt * Math.sin(this.player.rotation.z) * this.player.userData.speed,
            0
        );

        // Update physics state from mesh values for proper collision detection
        if (this.player.userData.physicsBody) {
            const transform = new Ammo.btTransform();
            transform.setIdentity();
            transform.setOrigin(new Ammo.btVector3(this.player.position.x, this.player.position.y, this.player.position.z));
            const quaternion = new THREE.Quaternion().setFromEuler(this.player.rotation);
            transform.setRotation(new Ammo.btQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w));
            this.player.userData.physicsBody.setMotionState(new Ammo.btDefaultMotionState(transform));
            this.player.userData.originalVelocity = new Ammo.btVector3(this.player.userData.velocity.x, this.player.userData.velocity.y, this.player.userData.velocity.z);
            this.player.userData.physicsBody.setLinearVelocity(this.player.userData.originalVelocity);
            this.player.userData.physicsBody.setAngularVelocity(new Ammo.btVector3(this.player.userData.rotationalVelocity.x, this.player.userData.rotationalVelocity.y, this.player.userData.rotationalVelocity.z));
            Ammo.destroy(transform); // avoid ammo js memory leak
        }

        this.player.userData.laserHeat = Math.max(0, this.player.userData.laserHeat - dt);
    }

    setPhysics(physicsWorld) {
        this.physics = physicsWorld;

        if (this.shouldInitializePlayerPhysics) {
            this.addRigidBodyPhysics(this.player, this.player.userData.mass);
        } else {
            this.shouldInitializePlayerPhysics = true;
        }
    }

    addRigidBodyPhysics(mesh, mass = 1, restitution = 1.9, friction = 0.0, rollingFriction = 0.0, dampingA = 0.0, dampingB = 0.0) {
        const shape = new Ammo.btConvexHullShape();
        shape.setMargin(0);
        for (const vector of iteratePoints(mesh)) {
            const vertex = new Ammo.btVector3(vector.x, vector.y, vector.z);
            shape.addPoint(vertex, true);
        }

        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(mesh.position.x, mesh.position.y, mesh.position.z));
        const quaternion = new THREE.Quaternion().setFromEuler(mesh.rotation);
        transform.setRotation(new Ammo.btQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w));
        const motionState = new Ammo.btDefaultMotionState(transform);

        const localInertia = new Ammo.btVector3(0, 0, 0);
        shape.calculateLocalInertia(mass, localInertia);

        const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
        const body = new Ammo.btRigidBody(rbInfo);

        body.setLinearVelocity(new Ammo.btVector3(mesh.userData.velocity.x, mesh.userData.velocity.y, mesh.userData.velocity.z));
        body.setAngularVelocity(new Ammo.btVector3(mesh.userData.rotationalVelocity.x, mesh.userData.rotationalVelocity.y, mesh.userData.rotationalVelocity.z));

        body.setActivationState(4);  // DISABLE_DEACTIVATION

        body.setRestitution(restitution);
        body.setFriction(friction);
        body.setRollingFriction(rollingFriction);
        body.setDamping(dampingA, dampingB);

        this.physics.addRigidBody(body);
        mesh.userData.physicsBody = body;
    }

    removeRigidBodyPhysics(mesh) {
        const vel = mesh.userData.physicsBody.getLinearVelocity();
        mesh.userData.velocity.set(vel.x(), vel.y(), vel.z());
        const rotVel = mesh.userData.physicsBody.getAngularVelocity();
        mesh.userData.rotationalVelocity.set(rotVel.x(), rotVel.y(), rotVel.z());
        this.physics.removeRigidBody(mesh.userData.physicsBody);
        mesh.userData.physicsBody = null;
    }

    createLaser(position, angle, speed, length = 0.5, radius = 0.02, ttl = 3, damage = 10) {
        const geo = new THREE.CylinderGeometry(radius, radius, length);
        geo.rotateZ(Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const laser = new THREE.Mesh(geo, mat);
        laser.rotation.z = angle;
        laser.position.set(position.x, position.y, 0);
        laser.userData.velocity = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0).multiplyScalar(speed);
        laser.userData.length = length;
        laser.userData.radius = radius;
        laser.userData.ttl = ttl;
        laser.userData.damage = damage;

        const light = new THREE.PointLight(0xff6666, 1, 20, 1.25);
        light.position.copy(laser.position);
        laser.userData.light = light;

        this.lasers.push(laser);
        this.scene.add(light);
        this.scene.add(laser);

        return laser;
    }

    spawnAsteroid(distance = 32, speed = 1.0) {
        const asteroid = createAsteroid(createAsteroidGeometry());

        // Calculate asteroid position and velocity such that it collides with the player, assuming constant movement.

        // position_asteroid + t * velocity_asteroid == position_player + t * velocity_player

        // in 2D
        // (1) a + t * c == p + t * x
        // (2) b + t * d == q + t * y

        // known: p, q, x, y
        // (a - p)^2 + (b - q)^2 == r^2 == distance^2
        // c^2 + d^2 == s^2 == speed^2

        // Construct right triangle with a = asteroid_movement, b = player_movement, c = distance.
        // Point C is the collision point. This means the asteroid always hits from the side.
        // (t * c)^2 + (t * d)^2 + (t * x)^2 + (t * y)^2 == r^2

        // Rearrange
        // t^2 * (c^2 + x^2 + y^2 + d^2) == r^2

        // Insert asteroid speed
        // t^2 * (x^2 + y^2 + s^2) == r^2

        // Rearrange
        // t^2 == r^2 / (x^2 + y^2 + s^2)
        // => t == sqrt(r^2 / (x^2 + y^2 + s^2))

        // So we can calculate the collision time
        const v = this.player.userData.velocity;
        const t = Math.sqrt(distance * distance / (v.x * v.x + v.y * v.y + speed * speed));

        // And thus the collision point
        const vector = this.player.position.clone().addScaledVector(this.player.userData.velocity, t);

        // The asteroid position is on a circle with r=distance around the player
        // And on a circle with r=speed*t around the collision point
        const [[x1, y1], [x2, y2]] = intersectTwoCircles(
            this.player.position.x, this.player.position.y, distance,
            vector.x, vector.y, speed * t
        );
        // Both intersections are equally far from the player, choose one randomly
        const [x, y] = Math.random() < 0.5 ? [x1, y1] : [x2, y2];

        asteroid.position.set(x, y, 0);

        // Steer towards collision point
        vector.sub(asteroid.position).normalize().multiplyScalar(speed);
        asteroid.userData.velocity.copy(vector);

        this.addRigidBodyPhysics(asteroid, asteroid.userData.volume)
        this.asteroids.push(asteroid);
        this.scene.add(asteroid);

        console.log("Spawned asteroid distanceToPlayer=" + asteroid.position.clone().sub(this.player.position).length());
    }

    /**
     * Disables collisions and enqueues a splitWorker task.
     */
    splitAsteroid(asteroid, laser, dt) {
        // Switch to simple physics
        this.removeRigidBodyPhysics(asteroid);

        asteroid.userData.splitAge = dt;

        const rotVelWorld = new THREE.Vector3(asteroid.userData.rotationalVelocity.x, asteroid.userData.rotationalVelocity.y, asteroid.userData.rotationalVelocity.z);
        // const rotMat = new THREE.Matrix4().makeRotationFromEuler(asteroid.rotation);
        // asteroid.localToWorld(rotVelWorld);
        rotVelWorld.applyEuler(asteroid.rotation);

        this.splitWorker.postMessage({
            asteroid: {
                uuid: asteroid.uuid,
                position: {x: asteroid.position.x, y: asteroid.position.y, z: asteroid.position.z},
                rotation: {x: asteroid.rotation.x, y: asteroid.rotation.y, z: asteroid.rotation.z},
                rotationalVelocityWorld: {x: rotVelWorld.x, y: rotVelWorld.y, z: rotVelWorld.z},
                diameter: asteroid.userData.diameter,
                vertexArray: asteroid.geometry.attributes.position.array,
                normalArray: asteroid.geometry.attributes.normal.array,
                indexArray: asteroid.geometry.index.array,
            },
            laser: {
                position: {x: laser.position.x, y: laser.position.y, z: laser.position.z},
                velocity: {x: laser.userData.velocity.x, y: laser.userData.velocity.y, z: laser.userData.velocity.z},
            }
        });
    }

    updateLasers(dt) {
        this.lasers.forEach(laser => {
            laser.userData.ttl -= dt;
            if (laser.userData.ttl <= 0) {
                this.scene.remove(laser);
                this.scene.remove(laser.userData.light);
                laser.isRemoved = true;
            } else {
                laser.position.addScaledVector(laser.userData.velocity, dt);
                laser.userData.light.position.copy(laser.position);
            }
        });
    }

    removeLasers() {
        this.lasers = this.lasers.filter(l => !l.isRemoved);
    }

    updateAsteroids(dt) {
        this.asteroids.forEach(a => {
            if (a.userData.volume < this.asteroidExplosionVolume) {
                // Explode asteroid and grant materials when it becomes too small
                this.particles.handleDefaultBreakdown(a);
                this.scene.remove(a);
                this.physics.removeRigidBody(a.userData.physicsBody);
                a.isRemoved = true;
                this.player.userData.material += a.userData.materialValue * a.userData.volume;
            } else if (a.position.clone().sub(this.player.position).length() > this.asteroidRemovalDistance) {
                // Remove asteroid when it drifts too far
                this.scene.remove(a);
                this.physics.removeRigidBody(a.userData.physicsBody);
                a.isRemoved = true;
            } else {
                // Move
                if (!this.updateRigidBodyPhysics(a)) {
                    a.position.addScaledVector(a.userData.velocity, dt);
                    if ((a.position.z > 0 && a.userData.velocity.z > 0) || a.position.z < 0 && a.userData.velocity.z < 0) {
                        a.position.z = 0;
                        a.userData.velocity.z = 0;
                    }
                    applyRotation(a, dt);
                }

                // Currently not used due to ammo.js
                for (const key of a.userData.asteroidCollisionHeat.keys()) {
                    const heat = a.userData.asteroidCollisionHeat.get(key) - dt;
                    if (heat <= 0) {
                        a.userData.asteroidCollisionHeat.delete(key);
                    } else {
                        a.userData.asteroidCollisionHeat.set(key, heat);
                    }
                }

                if (a.userData.splitAge !== null) { a.userData.splitAge += dt };
            }
        });
        this.asteroids = this.asteroids.filter(a => !a.isRemoved);
    }

    updateUniverse() {
        this.universe.update(this.camera);
    }

    /**
     * Updates mesh position and orientation from its physics state. Updates physics state when passing z=0 to stay.
     * @param {*} mesh
     * @returns {boolean} True if mesh was updated, false if not.
     */
    updateRigidBodyPhysics(mesh) {
        if (!mesh.userData.physicsBody) { return false; }
        const ms = mesh.userData.physicsBody.getMotionState();
        if (!ms) { return false; }

        const transformAux1 = new Ammo.btTransform();
        ms.getWorldTransform(transformAux1);
        const p = transformAux1.getOrigin();
        const q = transformAux1.getRotation();

        // Stay at z = 0
        const vel = mesh.userData.physicsBody.getLinearVelocity();
        if ((vel.z() < 0 && p.z() <= 0) || (vel.z() > 0 && p.z() >= 0)) {
            p.setZ(0);
            vel.setZ(0);
            transformAux1.setOrigin(p);
            mesh.userData.physicsBody.setMotionState(new Ammo.btDefaultMotionState(transformAux1));
            mesh.userData.physicsBody.setLinearVelocity(vel);
        }

        mesh.position.set(p.x(), p.y(), p.z());
        mesh.quaternion.set(q.x(), q.y(), q.z(), q.w());

        return true;
    }

    handleLaserHit(laser, hit, dt) {
        hit.asteroid.userData.health -= laser.userData.damage;
        hit.intersection.impact = laser.userData.velocity.clone();
        hit.asteroid.userData.recentHit = hit.intersection;
        nibbleAsteroid(hit.asteroid, hit.intersection);

        this.particles.handleDefaultImpact(hit.intersection, hit.asteroid);
        this.scene.remove(laser);
        this.scene.remove(laser.userData.light);
        laser.isRemoved = true;

        if (hit.asteroid.userData.health <= 0 && hit.asteroid.userData.splitAge === null) {
            console.time('splitParticles');
            this.particles.handleDefaultSplit(hit.intersection, hit.asteroid);
            console.timeEnd('splitParticles');
            console.time('splitAsteroid');
            this.splitAsteroid(hit.asteroid, laser, dt);
            console.timeEnd('splitAsteroid');
        }
    }

    handlePlayerCollision() {
        this.particles.handlePlayerBreakdown(this.player);
        this.removeRigidBodyPhysics(this.player);
        this.player.userData.isAlive = false;
        this.player.userData.speed = 0.0;
        this.player.clear();
    }
}

export function checkLaserHit(laser, asteroids) {
    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;

    const dir = laser.userData.velocity.clone().normalize();
    const origin = new THREE.Vector3().copy(laser.position).addScaledVector(dir, -0.5 * laser.userData.length);

    raycaster.set(origin, dir);
    raycaster.far = laser.userData.length;

    for (const asteroid of asteroids) {
        const intersects = raycaster.intersectObject(asteroid, true);
        if (intersects.length > 0) {
            return { asteroid, intersection: intersects[0] };
        }
    }

    return null;
}

/**
 * Currently not used due to ammo.js
 */
export function checkAsteroidCollision(meshA, meshB) {
    // Broad phase: bounding spheres
    const sphereA = new THREE.Sphere();
    const sphereB = new THREE.Sphere();
    meshA.geometry.computeBoundingSphere();
    meshB.geometry.computeBoundingSphere();
    sphereA.copy(meshA.geometry.boundingSphere).applyMatrix4(meshA.matrixWorld);
    sphereB.copy(meshB.geometry.boundingSphere).applyMatrix4(meshB.matrixWorld);

    if (!sphereA.intersectsSphere(sphereB)) return false;

    // Narrow phase: BVH intersection test
    if (!meshA.geometry.boundsTree) { meshA.geometry.computeBoundsTree(); }
    if (!meshB.geometry.boundsTree) { meshB.geometry.computeBoundsTree(); }

    const transform = new THREE.Matrix4().copy(meshA.matrixWorld).invert().multiply(meshB.matrixWorld);
    const collided = meshA.geometry.boundsTree.intersectsGeometry(meshB.geometry, transform);

    console.log(`collided: ${collided}`);

    return collided;
}

/**
 * Currently not used due to ammo.js
 */
export function handleAsteroidCollision(meshA, meshB) {
    const point = getApproximateCollisionPoint(meshA, meshB);

    const normal = meshA.position.clone().sub(meshB.position).normalize();

    // Relative velocity at contact point
    const relVel = meshA.userData.velocity.clone().sub(meshB.userData.velocity);

    // Project relative velocity onto normal
    const sepVel = relVel.dot(normal);
    if (sepVel > 0) return; // Already moving apart

    const restitution = 1.0; // Perfectly elastic
    const impulseMag = -(1 + restitution) * sepVel / 2;

    const impulse = normal.clone().multiplyScalar(impulseMag);

    meshA.userData.velocity.add(impulse);
    meshB.userData.velocity.sub(impulse);

    // === Angular velocity update ===

    // r = contact point relative to center of mass
    const rA = point.clone().sub(meshA.position);
    const rB = point.clone().sub(meshB.position);

    // TODO revise

    const torqueA = new THREE.Vector3().copy(rA).cross(impulse);
    const torqueB = new THREE.Vector3().copy(rB).cross(impulse).negate();

    // Scale torque arbitrarily for effect (not physically accurate)
    const spinScale = 0.05;
    meshA.userData.rotationalVelocity.add(torqueA.multiplyScalar(spinScale));
    meshB.userData.rotationalVelocity.add(torqueB.multiplyScalar(spinScale));

    meshA.userData.asteroidCollisionHeat.set(meshB, meshA.userData.asteroidCollisionCooldownPeriod);
    meshB.userData.asteroidCollisionHeat.set(meshA, meshB.userData.asteroidCollisionCooldownPeriod);
}

function getApproximateCollisionPoint(meshA, meshB) {
    const target1 = {};
    const target2 = {};

    const aInvRot = new THREE.Euler(-meshA.rotation.x, -meshA.rotation.y, -meshA.rotation.z, "ZYX");
    const aInvMatWorld = new THREE.Matrix4().makeTranslation(meshA.position.clone().multiplyScalar(-1));
    aInvMatWorld.multiply(new THREE.Matrix4().makeRotationFromEuler(aInvRot));
    const transform = new THREE.Matrix4().copy(aInvMatWorld).multiply(meshB.matrixWorld);

    // Get closest point from meshA to meshB
    meshA.geometry.boundsTree.closestPointToGeometry(
        meshB.geometry,
        transform,
        target1,
        target2
    );
    const collisionPoint = meshA.localToWorld(target1.point.clone()).add(meshB.localToWorld(target2.point.clone())).multiplyScalar(0.5);
    return collisionPoint;
}


const defaultNibbleRadius = 0.15;
const defaultNibbleDepth = 0.05;
const defaultNibbleGeometry = new THREE.IcosahedronGeometry(defaultNibbleRadius, 0);

export function nibbleAsteroid(asteroid, intersection, rx = null, ry = null, rz = null) {
    const brush1 = new Brush(asteroid.geometry);
    const brush2 = new Brush(defaultNibbleGeometry);
    const negativeNormalizedImpact = intersection.impact.clone().normalize().multiplyScalar(-1);
    brush2.position.copy(asteroid.worldToLocal(
        intersection.point.clone().add(negativeNormalizedImpact.multiplyScalar(defaultNibbleRadius - defaultNibbleDepth))
    ));
    rx = rx || Math.random() * 2 * Math.PI;
    ry = ry || Math.random() * 2 * Math.PI;
    rz = rz || Math.random() * 2 * Math.PI;

    brush2.rotation.set(rx, ry, rz);
    brush2.updateMatrixWorld();

    const evaluator = new Evaluator();
    evaluator.attributes = ["position"];
    const result = evaluator.evaluate(brush1, brush2, SUBTRACTION);
    let geo = result.geometry;

    // printDuplicateTriangles(geo);

    simplifyGeometry(geo, 0.0001);

    // printDuplicateTriangles(geo);

    geo = new GeometryManipulator(geo).splitTrianglesOnTouchingVertices();

    // printDuplicateTriangles(geo);  // <-- TODO this happens

    simplifyGeometry(geo, 0.04);

    // printDuplicateTriangles(geo);

    geo.computeVertexNormals();
    asteroid.geometry = geo;
}

function applyRotation(mesh, dt) {
    const angle = mesh.userData.rotationalVelocity.length() * dt;
    const axis = mesh.userData.rotationalVelocity.clone().normalize();
    const deltaQuat = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    mesh.quaternion.multiplyQuaternions(deltaQuat, mesh.quaternion);
}

/**
 * Calculates the two intersection points of two circles. Based on:
 * https://gist.github.com/jupdike/bfe5eb23d1c395d8a0a1a4ddd94882ac
 * http://math.stackexchange.com/a/1367732
 * @returns Two coordinate pairs if there is at least one intersection, same coordinates twice if the circles touch,
 *          empty list if there is no intersection.
 */
function intersectTwoCircles(x1, y1, r1, x2, y2, r2) {
    const dx = x1 - x2;
    const dy = y1 - y2;

    const rSq = dx * dx + dy * dy;
    var r = Math.sqrt(rSq);
    if (!(Math.abs(r1 - r2) <= r && r <= r1 + r2)) {
        // No intersection
        return [];
    }

    // Intersection(s) exist
    const a = (r1 * r1 - r2 * r2);
    const b = a / (2 * rSq);
    const c = Math.sqrt(2 * (r1 * r1 + r2 * r2) / rSq - (a * a) / (rSq * rSq) - 1);

    var fx = (x1 + x2) / 2 + b * (x2 - x1);
    var gx = c * (y2 - y1) / 2;
    var ix1 = fx + gx;
    var ix2 = fx - gx;

    var fy = (y1 + y2) / 2 + b * (y2 - y1);
    var gy = c * (x1 - x2) / 2;
    var iy1 = fy + gy;
    var iy2 = fy - gy;

    return [[ix1, iy1], [ix2, iy2]];
}
