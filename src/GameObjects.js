import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SUBTRACTION, Brush, Evaluator } from 'three-bvh-csg';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import Ammo from 'ammo.js';
import { createAsteroid, createAsteroidGeometry } from './world/Asteroid.js';
import { ParticleSystem } from './Particles.js';
import { GeometryManipulator, simplifyGeometry, printDuplicateTriangles, printCollapsedTriangles } from './GeometryUtils.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;


/**
 * World class that manages the game scene, camera, and physics.
 */
export class World {
    /**
     * @param {THREE.DepthTexture} depthTexture  Main scene depth buffer for the particle renderer.
     */
    constructor(depthTexture) {
        this.scene = new THREE.Scene();
        this.clearColor = new THREE.Color(0x000000);

        this.camera = this.createCamera();
        this.addDefaultLights();
        this.addPreliminaryBackground();
        this.player = createPlayer();
        this.scene.add(this.player);

        this.asteroids = [createAsteroid(createAsteroidGeometry()), createAsteroid(createAsteroidGeometry())];
        this.asteroids[0].position.set(3, 1, 0);
        this.asteroids[1].position.set(8, 1.5, 0);
        this.asteroids[1].userData.velocity.set(-0.7, -0.1, 0);
        this.scene.add(this.asteroids[0]);
        this.scene.add(this.asteroids[1]);

        this.lasers = [];
        this.particles = new ParticleSystem(this.scene, this.camera, depthTexture);

        this.splitWorker = new Worker("/src/workers/AsteroidSplitWorker.js", { type: 'module' });
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

    addPreliminaryBackground() {
        this.scene.add(createUniverse());
        this.scene.add(createUniverse2());
        this.scene.add(createUniverse3());
        this.scene.add(createUniverse4());
        this.scene.add(createUniverse5());
        this.brightStar = createUniverse6();
        this.scene.add(this.brightStar);
    }

    setPhysics(physicsWorld) {
        this.physics = physicsWorld;
        this.asteroids.forEach((asteroid) => {
            this.addRigidBodyPhysics(asteroid, asteroid.userData.volume);
        });
    }

    addRigidBodyPhysics(mesh, mass = 1) {
        const vertices = mesh.geometry.attributes.position.array;
        const shape = new Ammo.btConvexHullShape();
        shape.setMargin(0);
        for (let i = 0; i < vertices.length; i += 3) {
            const vertex = new Ammo.btVector3(vertices[i], vertices[i + 1], vertices[i + 2]);
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

        body.setRestitution(1.8 + 0.1 * Math.random());
        body.setFriction(0.0);
        body.setRollingFriction(0.0);
        body.setDamping(0.0, 0.0);

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

    createLaser(position, angle, speed = 14.4, length = 0.5, radius = 0.02, ttl = 3, damage = 10) {
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
        const minVolume = 0.1;

        this.physics.stepSimulation(dt, 10);

        this.asteroids.forEach(a => {
            if (a.userData.volume < minVolume) {
                this.particles.handleDefaultBreakdown(a);
                this.scene.remove(a);
                this.physics.removeRigidBody(a.userData.physicsBody);
                a.isRemoved = true;
            } else {
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
}

function createPlayer() {
    const player = new THREE.Group();
    const loader = new GLTFLoader();
    loader.load("/media/spacecraft.glb", (gltf) => {
        gltf.scene.position.z = -0.1;
        gltf.scene.rotation.x = 0.5 * Math.PI;
        gltf.scene.rotation.y = 0.5 * Math.PI;
        gltf.scene.scale.set(0.0667, 0.0667, 0.0667);
        player.add(gltf.scene);
    });
    player.userData.maxSpeed = 6.0;
    player.userData.speed = 0.0;
    player.userData.maxAccel = 6.0;
    player.userData.accel = 0.0;
    player.userData.rotationalSpeed = 3.9;
    player.userData.laserCooldownPeriod = 0.333;
    player.userData.laserHeat = 0.0;
    player.userData.laserSpreadRad = 0.01 * Math.PI;
    return player;
}

function createUniverse() {
    const geo = new THREE.PlaneGeometry(300, 300);
    const texture = generateStarTexture({ minRadius: 1.2, maxRadius: 1.5, starCount: 100 });
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const universe = new THREE.Mesh(geo, material);
    universe.position.z = -140;
    return universe;
}

function createUniverse2() {
    const geo = new THREE.PlaneGeometry(600, 600);
    const texture = generateStarTexture({ minRadius: 0.8, maxRadius: 1.2, starCount: 800 });
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const universe = new THREE.Mesh(geo, material);
    universe.position.z = -210;
    return universe;
}

function createUniverse3() {
    const geo = new THREE.PlaneGeometry(900, 900);
    const texture = generateStarTexture({
        minRadius: 0.45, maxRadius: 0.8, starCount: 1200,
        minRed: 100, maxRed: 255,
        minGreen: 175, maxGreen: 175,
        minBlue: 100, maxBlue: 255,
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const universe = new THREE.Mesh(geo, material);
    universe.position.z = -300;
    return universe;
}

function createUniverse4() {
    const geo = new THREE.PlaneGeometry(1200, 1200);
    const texture = generateStarTexture({
        minRadius: 0.25, maxRadius: 0.45, starCount: 10000, minBrightness: 0.3, maxBrightness: 1.0,
        minRed: 100, maxRed: 255,
        minGreen: 160, maxGreen: 175,
        minBlue: 100, maxBlue: 255,
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const universe = new THREE.Mesh(geo, material);
    universe.position.z = -400;
    return universe;
}

function createUniverse5(starCount = 2500, minZ = -350, maxZ = -90) {
    const positions = [];

    for (let i = 0; i < starCount; i++) {
        const z = minZ + Math.random() * (maxZ - minZ);
        const x = -z * 3.5 * (Math.random() - 0.5)
        const y = -z * 3.5 * (Math.random() - 0.5)
        positions.push(x, y, z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.5,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    const stars = new THREE.Points(geometry, material);

    return stars;
}

function createUniverse6() {
    const geo = new THREE.PlaneGeometry(55, 55);
    const textureLoader = new THREE.TextureLoader()
    const texture = textureLoader.load('/media/bright_star.png');
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const universe = new THREE.Mesh(geo, material);
    universe.position.set(10, 15, -50);
    return universe;
}

function generateStarTexture({
    size = 1536,
    starCount = 500,
    minRadius = 0.5,
    maxRadius = 2.5,
    minBrightness = 0.8,
    maxBrightness = 1.0,
    minRed = 255,
    maxRed = 255,
    minGreen = 255,
    maxGreen = 255,
    minBlue = 255,
    maxBlue = 255,
    bgColor = "black",
} = {}) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;

    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size, size);

    // Draw stars
    for (let i = 0; i < starCount; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const radius = minRadius + Math.random() * (maxRadius - minRadius);

        const alpha = minBrightness + Math.random() * (maxBrightness - minBrightness);

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        const r = minRed + Math.random() * (maxRed - minRed);
        const g = minGreen + Math.random() * (maxGreen - minGreen);
        const b = minBlue + Math.random() * (maxBlue - minBlue);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.fill();
    }

    return new THREE.CanvasTexture(canvas);
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
