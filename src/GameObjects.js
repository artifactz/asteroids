import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SUBTRACTION, Brush, Evaluator } from 'three-bvh-csg';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { addBarycentricCoordinates, createAsteroid, createAsteroidGeometry } from './world/Asteroid.js';
import { Universe } from './world/Universe.js';
import { ParticleSystem } from './Particles.js';
import { GeometryManipulator, simplifyGeometry, printDuplicateTriangles, printCollapsedTriangles } from './GeometryUtils.js';
import AsteroidSplitWorker from './workers/AsteroidSplitWorker.js?worker';
import { applyRotation, Physics } from './Physics.js';

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

        this.physics = new Physics();
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
        this.splitWorker.onmessage = (message) => { this.handleSplitWorkerResponse(message); };
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
            this.physics.setPlayer(player);
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
        });

        player.userData.handleCollision = () => {
            this.handlePlayerCollision();
        }

        return player;
    }

    updatePlayer(dt) {
        this.player.userData.laserHeat = Math.max(0, this.player.userData.laserHeat - dt);
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

        const light = new THREE.PointLight(0xff6666, 1, 10, 1.25);
        light.position.copy(laser.position);
        laser.userData.light = light;

        this.lasers.push(laser);
        this.scene.add(light);
        this.scene.add(laser);

        return laser;
    }

    /**
     * Spawns an asteroid such that it collides with the player orthogonally assuming constant movement.
     * @param {*} distance Distance to player
     * @param {*} speed Asteroid speed
     */
    spawnAsteroid(distance = 32, speed = 1.0) {
        const asteroid = this.createAsteroid(createAsteroidGeometry());

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

        this.physics.add(asteroid, { mass: asteroid.userData.volume });
        this.asteroids.push(asteroid);
        this.scene.add(asteroid);

        console.log("Spawned asteroid distanceToPlayer=" + asteroid.position.clone().sub(this.player.position).length());
    }

    createAsteroid(geometry) {
        const asteroid = createAsteroid(geometry);

        // Add collision handling
        asteroid.userData.handleCollision = (otherMesh, contactPoint, impulse, otherImpulse) => {
            if (otherMesh.userData.type != "asteroid") { return; }
            if (impulse.x == 0 && impulse.y == 0 && impulse.z == 0) { return; }
            const damage = 25 * otherMesh.userData.volume * impulse.length();
            asteroid.userData.health -= damage;
            // console.log("Inflicting collision damage: " + damage + " health left: " + asteroid.userData.health);
            if (asteroid.userData.health <= 0 && !asteroid.userData.isSplitting) {
                const impact = { point: asteroid.position.clone().addScaledVector(otherMesh.position.clone().sub(asteroid.position).normalize(), 0.5 * asteroid.userData.diameter) };
                impact.velocity = asteroid.position.clone().sub(impact.point).normalize();
                asteroid.userData.recentImpact = impact;
                this.splitAsteroid(asteroid, impact);
            }
        };

        return asteroid;
    }

    /**
     * Disables collisions and enqueues a splitWorker task.
     */
    splitAsteroid(asteroid, impact) {
        // Switch to basic physics
        this.physics.disableAmmo(asteroid);

        asteroid.userData.splitAge = 0;

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
            },
            impact
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

                const hit = checkLaserHit(laser, this.asteroids, dt);
                if (hit) {
                    this.handleLaserHit(laser, hit.asteroid, hit.intersection, dt);
                }
            }
        });

        this.lasers = this.lasers.filter(l => !l.isRemoved);
    }

    updateAsteroids(dt) {
        const asteroidRemovalDistanceSq = this.asteroidRemovalDistance * this.asteroidRemovalDistance;
        this.asteroids.forEach(a => {
            if (a.position.clone().sub(this.player.position).lengthSq() > asteroidRemovalDistanceSq) {
                // Remove asteroid when it drifts too far
                this.removeAsteroid(a);
            } else if (a.userData.isSplitting) {
                a.userData.splitAge += dt;
            }
        });
        this.asteroids = this.asteroids.filter(a => !a.isRemoved);
    }

    /**
     * Explodes asteroid and grant the player materials.
     */
    explodeAsteroid(asteroid) {
        this.player.userData.material += asteroid.userData.materialValue * asteroid.userData.volume;
        this.particles.handleDefaultBreakdown(asteroid);
        this.removeAsteroid(asteroid);
    }

    removeAsteroid(asteroid) {
        if (asteroid.isRemoved) { return; }
        this.scene.remove(asteroid);
        this.physics.remove(asteroid);
        asteroid.isRemoved = true;
    }

    updateUniverse() {
        this.universe.update(this.camera);
    }

    handleLaserHit(laser, asteroid, intersection, dt) {
        asteroid.userData.health -= laser.userData.damage;
        const impact = { point: intersection.point, velocity: laser.userData.velocity.clone(), normal: intersection.face.normal, farPoint: intersection.farPoint };
        asteroid.userData.recentImpact = impact;
        nibbleAsteroid(asteroid, impact);

        this.particles.handleDefaultImpact(impact, asteroid);
        this.scene.remove(laser);
        this.scene.remove(laser.userData.light);
        laser.isRemoved = true;

        if (asteroid.userData.health <= 0 && !asteroid.userData.isSplitting) {
            this.splitAsteroid(asteroid, impact);
        }
    }

    handlePlayerCollision() {
        this.particles.handlePlayerBreakdown(this.player);
        this.physics.disableAmmo(this.player);
        this.player.userData.isAlive = false;
        this.player.userData.speed = 0;
        this.player.userData.accel = 0;
        this.player.clear(); // remove mesh
    }

    handleSplitWorkerResponse(message) {
        const parentAsteroid = this.asteroids.find((a) => a.uuid == message.data.parentUuid);
        const splitAsteroids = [];
        let sign = 1;

        message.data.splits.forEach((result) => {
            // Mesh
            result.geometry = new THREE.BufferGeometry();
            result.geometry.setAttribute("position", new THREE.Float32BufferAttribute(result.vertexArray, 3));
            result.geometry.setAttribute("normal", new THREE.Float32BufferAttribute(result.normalArray, 3));
            const mesh = this.createAsteroid(result.geometry);

            // Rotation since split begin
            const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
                parentAsteroid.userData.rotationalVelocity.x * parentAsteroid.userData.splitAge,
                parentAsteroid.userData.rotationalVelocity.y * parentAsteroid.userData.splitAge,
                parentAsteroid.userData.rotationalVelocity.z * parentAsteroid.userData.splitAge,
            ));
            // Rotated offset of new center to parent center
            const transform = rotation.clone().multiply(new THREE.Matrix4().makeTranslation(result.offset.x, result.offset.y, result.offset.z));
            transform.decompose(mesh.position, mesh.quaternion, mesh.scale);
            // transform.decompose(mesh.position, new THREE.Quaternion(), mesh.scale);
            // mesh.userData.rotationalVelocity = parentAsteroid.userData.rotationalVelocity;
            // applyRotation(mesh, parentAsteroid.userData.splitAge);
            mesh.position.add(parentAsteroid.position);

            // Velocity
            const parentWeight = 0.95;
            const repellingWeight = 0.25;
            const impactWeight = 0.04;
            const repellingVector = new THREE.Vector3(
                Math.cos(message.data.impactRotation - sign * 0.5 * Math.PI),
                Math.sin(message.data.impactRotation - sign * 0.5 * Math.PI),
                0
            );
            mesh.userData.velocity = parentAsteroid.userData.velocity.clone()
                .multiplyScalar(parentWeight)
                .addScaledVector(repellingVector, repellingWeight)
                .addScaledVector(message.data.impactDirection, impactWeight);

            // Rotational velocity
            const randomWeight = 0.1;
            const randomRotation = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
            const outwardWeight = 0.2;
            const outwardRotatation = new THREE.Vector3(-rotation.elements[2], -rotation.elements[6], -rotation.elements[10]);
            mesh.userData.rotationalVelocity = new THREE.Vector3(
                // TODO seeemingly results in arbitrary looking rotations (particularly for collided asteroids)
                message.data.parentRotationalVelocityWorld.x,
                message.data.parentRotationalVelocityWorld.y,
                message.data.parentRotationalVelocityWorld.z
            )
                .multiplyScalar(parentWeight)
                .addScaledVector(randomRotation, randomWeight)
                .addScaledVector(outwardRotatation, outwardWeight * sign);

            mesh.userData.recentImpact = parentAsteroid.userData.recentImpact;
            mesh.userData.health += 0.5 * parentAsteroid.userData.health;  // health is non-positive at this point

            sign *= -1;

            if (mesh.userData.volume <= this.asteroidExplosionVolume) {
                this.explodeAsteroid(mesh);
            } else {
                this.scene.add(mesh);
                this.asteroids.push(mesh);
                this.physics.add(mesh, { mass: mesh.userData.volume }, true, 0.5);
            }
            splitAsteroids.push(mesh);
        });

        this.removeAsteroid(parentAsteroid);

        this.particles.handleDefaultSplit(parentAsteroid.userData.recentImpact, parentAsteroid, splitAsteroids[0]);
    }
}

export function checkLaserHit(laser, asteroids, dt) {
    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;

    const dir = laser.userData.velocity.clone().normalize();
    const step = laser.userData.velocity.length() * dt;
    const origin = new THREE.Vector3().copy(laser.position).addScaledVector(dir, -0.5 * laser.userData.length - step);

    raycaster.set(origin, dir);
    raycaster.far = step + laser.userData.length;

    for (const asteroid of asteroids) {
        const intersects = raycaster.intersectObject(asteroid, true);
        if (intersects.length > 0) {
            // // Determine projectile exit location
            // const intersect = intersects[0];
            // raycaster.set(intersect.point.clone().addScaledVector(dir, 10), dir.multiplyScalar(-1));
            // raycaster.far = 10;
            // const backsideIntersects = raycaster.intersectObject(asteroid, true);
            // intersect.farPoint = backsideIntersects[0].point;
            // return { asteroid, intersection: intersect };
            return { asteroid, intersection: intersects[0] };
        }
    }

    return null;
}


const defaultNibbleRadius = 0.25;
const defaultNibbleDepth = 0.07;
const defaultNibbleGeometry = new THREE.IcosahedronGeometry(defaultNibbleRadius, 0);

export function nibbleAsteroid(asteroid, impact, rx = null, ry = null, rz = null) {
    const brush1 = new Brush(asteroid.geometry);
    const brush2 = new Brush(defaultNibbleGeometry);
    const negativeNormalizedImpact = impact.velocity.clone().normalize().multiplyScalar(-1);
    brush2.position.copy(asteroid.worldToLocal(
        impact.point.clone().add(negativeNormalizedImpact.multiplyScalar(defaultNibbleRadius - defaultNibbleDepth))
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

    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    addBarycentricCoordinates(geo);

    asteroid.geometry = geo;
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
