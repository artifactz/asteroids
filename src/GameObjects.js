import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { SUBTRACTION, INTERSECTION, Brush, Evaluator, computeMeshVolume } from 'three-bvh-csg';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import Ammo from 'ammo.js';
import { ParticleSystem } from './Particles.js';
import { GeometryManipulator, simplifyGeometry, printDuplicateTriangles, printCollapsedTriangles } from './GeometryUtils.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;


export class World {
    constructor() {
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
        this.particles = new ParticleSystem(this.scene);
    }

    createCamera() {
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
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
        const vertices = mesh.geometry.clone().toNonIndexed().attributes.position.array;

        // const ammoMesh = new Ammo.btTriangleMesh();

        // for (let i = 0; i < vertices.length; i += 9) {
        //     const v0 = new Ammo.btVector3(vertices[i], vertices[i + 1], vertices[i + 2]);
        //     const v1 = new Ammo.btVector3(vertices[i + 3], vertices[i + 4], vertices[i + 5]);
        //     const v2 = new Ammo.btVector3(vertices[i + 6], vertices[i + 7], vertices[i + 8]);
        //     ammoMesh.addTriangle(v0, v1, v2, true);
        // }

        // const shape = new Ammo.btBvhTriangleMeshShape(ammoMesh, true, true);

        const shape = new Ammo.btConvexHullShape();
        shape.setMargin(0);
        for (let i = 0; i < vertices.length; i += 3) {
            const vertex = new Ammo.btVector3(vertices[i], vertices[i + 1], vertices[i + 2]);
            shape.addPoint(vertex, true);
        }

        // shape.optimizeConvexHull();
        // shape.recalcLocalAabb();

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
        body.setRollingFriction(0.0);    // resist rotation when rolling
        body.setDamping(0.0, 0.0);

        this.physics.addRigidBody(body);
        mesh.userData.physicsBody = body;
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

        const light = new THREE.PointLight(0xff6666, 1, 20);
        light.position.copy(laser.position);
        laser.userData.light = light;

        this.lasers.push(laser);
        this.scene.add(light);
        this.scene.add(laser);

        return laser;
    }

    splitAsteroid(asteroid, laser) {
        const laserDirection = laser.userData.velocity.clone().normalize();
        const boxSize = 2.0 * asteroid.userData.diameter;

        const cutterGeo = buildNoisyCutter(boxSize);
        cutterGeo.translate(0.5 * boxSize, 0.0, 0.0);
        const laserRotation = Math.atan2(laserDirection.y, laserDirection.x);
        cutterGeo.rotateZ(laserRotation + 0.5 * Math.PI);

        const brush1 = new Brush(asteroid.geometry);
        brush1.position.copy(asteroid.position);
        brush1.rotation.copy(asteroid.rotation);
        brush1.updateMatrixWorld();

        const brush2 = new Brush(cutterGeo);
        brush2.position.copy(laser.position);
        brush2.position.addScaledVector(laserDirection, 0.5 * asteroid.userData.diameter);
        brush2.updateMatrixWorld();

        const evaluator = new Evaluator();
        evaluator.attributes = ["position", "normal"];
        const A = evaluator.evaluate( brush1, brush2, SUBTRACTION );
        const B = evaluator.evaluate( brush1, brush2, INTERSECTION );

        let sign = 1;
        [A, B].forEach(brush => {
            // printDuplicateTriangles(brush.geometry);

            const cleanGeo = new GeometryManipulator(BufferGeometryUtils.mergeVertices(brush.geometry, 0.0001)).splitTrianglesOnTouchingVertices();
            // TODO replace with simplifyGeometry
            const geo = BufferGeometryUtils.mergeVertices(cleanGeo, 0.01);

            // printCollapsedTriangles(geo);

            geo.translate(-asteroid.position.x, -asteroid.position.y, -asteroid.position.z);
            geo.computeBoundingBox();
            const t = geo.boundingBox.getCenter(new THREE.Vector3());
            geo.translate(-t.x, -t.y, -t.z);

            geo.setIndex(new GeometryManipulator(geo).removeCollapsedTriangles());
            geo.computeVertexNormals();

            const mesh = createAsteroid(geo);
            mesh.position.copy(asteroid.position).add(t);

            const parentWeight = 0.95;
            const repellingWeight = 0.1;
            const laserWeight = 0.04;
            const parentLinearVel = asteroid.userData.physicsBody.getLinearVelocity();
            const repellingVector = new THREE.Vector3(Math.cos(laserRotation - sign * 0.5 * Math.PI), Math.sin(laserRotation - sign * 0.5 * Math.PI), 0);
            mesh.userData.velocity = new THREE.Vector3(parentLinearVel.x(), parentLinearVel.y(), parentLinearVel.z())
                .multiplyScalar(parentWeight)
                .addScaledVector(repellingVector, repellingWeight)
                .addScaledVector(laserDirection, laserWeight);
            mesh.userData.velocity.z = 0.2 * -Math.sign(mesh.position.z);

            const randomWeight = 0.1;
            const randomRotation = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
            const outwardWeight = 0.2;
            const parentAngularVel = asteroid.userData.physicsBody.getAngularVelocity();
            mesh.userData.rotationalVelocity = new THREE.Vector3(parentAngularVel.x(), parentAngularVel.y(), parentAngularVel.z())
                .multiplyScalar(parentWeight)
                .addScaledVector(randomRotation, randomWeight);
            mesh.userData.rotationalVelocity.z -= outwardWeight * sign;

            // Move away from other other asteroid part ever so slightly to avoid overlap
            mesh.position.addScaledVector(repellingVector, 0.002);

            mesh.userData.recentHit = asteroid.userData.recentHit;

            sign *= -1;

            this.scene.add(mesh);
            this.asteroids.push(mesh);
            this.addRigidBodyPhysics(mesh, mesh.userData.volume);
        });
        const a = this.asteroids[this.asteroids.length - 2];
        const b = this.asteroids[this.asteroids.length - 1];
        a.userData.asteroidCollisionHeat.set(b, a.userData.asteroidCollisionCooldownPeriod);
        b.userData.asteroidCollisionHeat.set(a, b.userData.asteroidCollisionCooldownPeriod);

        this.scene.remove(asteroid);
        this.asteroids = this.asteroids.filter(a => a !== asteroid);
        this.physics.removeRigidBody(asteroid.userData.physicsBody);
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
                this.updateRigidBodyPhysics(a);

                for (const key of a.userData.asteroidCollisionHeat.keys()) {
                    const heat = a.userData.asteroidCollisionHeat.get(key) - dt;
                    if (heat <= 0) {
                        a.userData.asteroidCollisionHeat.delete(key);
                    } else {
                        a.userData.asteroidCollisionHeat.set(key, heat);
                    }
                }
            }
        });
        this.asteroids = this.asteroids.filter(a => !a.isRemoved);
    }

    updateRigidBodyPhysics(mesh) {
        const ms = mesh.userData.physicsBody.getMotionState();
        if (!ms) { return; }

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
    }

    handleLaserHit(laser, hit) {
        hit.asteroid.userData.health -= laser.userData.damage;
        hit.intersection.impact = laser.userData.velocity.clone();
        hit.asteroid.userData.recentHit = hit.intersection;
        nibbleAsteroid(hit.asteroid, hit.intersection);

        this.particles.handleDefaultImpact(hit.intersection, hit.asteroid);
        this.scene.remove(laser);
        this.scene.remove(laser.userData.light);
        laser.isRemoved = true;

        if (hit.asteroid.userData.health <= 0) {
            this.particles.handleDefaultSplit(hit.intersection, hit.asteroid);
            this.splitAsteroid(hit.asteroid, laser);
        }
    }
}


const defaultAsteroidMat = new THREE.MeshStandardMaterial({ color: 0x888888, flatShading: true });

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

export function createAsteroid(geometry, rotationSpeed = 0.333, randomHealth = 40) {
    const mesh = new THREE.Mesh(geometry, defaultAsteroidMat);
    mesh.userData.velocity = new THREE.Vector3(0, 0, 0);
    mesh.userData.rotationalVelocity = new THREE.Vector3(
        rotationSpeed * (Math.random() - 0.5),
        rotationSpeed * (Math.random() - 0.5),
        rotationSpeed * (Math.random() - 0.5)
    );
    mesh.userData.zPush = 0.02;
    mesh.userData.diameter = getDiameter(geometry);
    mesh.userData.volume = computeMeshVolume(mesh);
    mesh.userData.asteroidCollisionCooldownPeriod = 0.1;
    mesh.userData.asteroidCollisionHeat = new Map();
    mesh.userData.health = 30 * Math.sqrt(mesh.userData.volume) + randomHealth * Math.random();
    return mesh;
}

function createPlayer() {
    const geo = new THREE.BufferGeometry();
    geo.setFromPoints([
        new THREE.Vector3(0.2, 0, 0),
        new THREE.Vector3(-0.2, 0.1, 0),
        new THREE.Vector3(-0.2, -0.1, 0),
    ]);
    geo.setIndex([0, 1, 2]);
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const player = new THREE.Mesh(geo, mat);
    player.userData.speed = 4.2;
    player.userData.rotationalSpeed = 4.2;
    player.userData.laserCooldownPeriod = 0.333;
    player.userData.laserHeat = 0.0;
    player.userData.laserSpreadRad = 0.01 * Math.PI;
    return player;
}

function createUniverse() {
    const geo = new THREE.PlaneGeometry(300, 300);
    const texture = generateStarTexture({ minRadius: 1.2, maxRadius: 1.5, starCount: 100 });
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true });
    const universe = new THREE.Mesh(geo, material);
    universe.position.z = -140;
    return universe;
}

function createUniverse2() {
    const geo = new THREE.PlaneGeometry(600, 600);
    const texture = generateStarTexture({ minRadius: 0.8, maxRadius: 1.2, starCount: 800 });
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true });
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
    const material = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true });
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
    const material = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true });
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
    const material = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true });
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

function getDiameter(geometry) {
    geometry.computeBoundingSphere();
    return 2 * geometry.boundingSphere.radius;
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
