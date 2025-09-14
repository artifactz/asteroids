import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { createAsteroid, createAsteroidGeometry, createDummyAsteroid } from './world/Asteroid.js';
import { Universe } from './world/Universe.js';
import { ParticleSystem } from './Particles.js';
import { createDebris } from './world/Debris.js';
import AsteroidSplitWorker from './workers/AsteroidSplitWorker.js?worker';
import { Physics } from './Physics.js';
import { Sounds } from './Sounds.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;


/**
 * World class that manages the game scene, camera, and physics.
 */
export class World {
    /**
     * @param {THREE.WebGLRenderer} renderer Renderer reference for the nebula generator.
     * @param {THREE.DepthTexture} depthTexture Main scene depth buffer for the particle renderer.
     */
    constructor(renderer, depthTexture) {
        this.asteroidExplosionVolume = 0.15;
        this.asteroidRemovalDistance = 60;
        this.debrisTakeDistance = 3.5;
        this.debrisTakeDuration = 1.0;
        this.debrisTakeFinishDistance = 0.4;

        this.time = 0;
        this.physics = new Physics();
        this.scene = new THREE.Scene();
        this.clearColor = new THREE.Color(0x000000);
        this.camera = this.createCamera();
        this.addDefaultLights(this.scene);
        this.universe = new Universe(this.scene, this.camera, renderer);
        this.player = this.createPlayer();
        this.scene.add(this.player);

        this.asteroids = [];
        this.lasers = [];
        this.debris = [];
        this.particles = new ParticleSystem(this.scene, this.camera, depthTexture);
        this.sounds = new Sounds();

        this.splitWorker = new AsteroidSplitWorker();
        /** Handles worker results. */
        this.splitWorker.onmessage = (message) => { this.handleSplitWorkerResponse(message); };
    }

    updateTime(dt) {
        this.time += dt;
        this.sounds.updateTime(this.time);
    }

    createCamera() {
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 1000);
        camera.position.set(0, 0, 10);
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, 0);
        camera.userData = {
            slackPerSecond: 0.001,
            shake: 0,
            maxShake: 0.1,
            shakeDecay: 0.05,
        }
        return camera;
    }

    addDefaultLights(scene) {
        const dLight = new THREE.DirectionalLight(0xffffff, 1);
        dLight.position.set(5, 5, 10);
        const aLight = new THREE.AmbientLight(0x707070);
        scene.add(dLight);
        scene.add(aLight);
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

    /**
     * Spawns an asteroid such that it collides with the player orthogonally assuming constant movement.
     * @param {*} distance Distance to player
     * @param {*} speed Asteroid speed
     */
    spawnAsteroid(position, velocity) {
        const asteroid = createAsteroid(createAsteroidGeometry());
        asteroid.position.copy(position);
        asteroid.userData.velocity.copy(velocity);
        this.addAsteroid(asteroid);

        console.log("Spawned asteroid distanceToPlayer=" + asteroid.position.clone().sub(this.player.position).length());
    }

    /**
     * Adds asteroid to game world.
     * @param {THREE.Mesh} asteroid 
     * @param {number} physicsEaseInSeconds Time spent in "ease-in" physics group, in which collisions with each other are disabled.
     */
    addAsteroid(asteroid, physicsEaseInSeconds = 0) {
        const COLLISION_DAMAGE = 11; // Multiplier

        // Add collision handling
        asteroid.userData.handleCollision = (otherMesh, contactPoint, deltaVel, otherDeltaVel, deltaRotVel, otherDeltaRotVel) => {
            if (otherMesh.userData.type != "asteroid") { return; }

            const magnitude = deltaVel.length() + deltaRotVel.length();
            if (magnitude < 0.1) { return; }

            const damage = COLLISION_DAMAGE * otherMesh.userData.volume * magnitude;
            asteroid.userData.health -= damage;
            // console.log("Inflicting collision damage: " + damage + " health left: " + asteroid.userData.health);

            // Play sound once
            if (asteroid.userData.volume > otherMesh.userData.volume) {
                const totalMagnitude = magnitude + otherDeltaVel.length() + otherDeltaRotVel.length() + asteroid.userData.volume + otherMesh.userData.volume;
                const distance = contactPoint.clone().sub(new THREE.Vector3(this.camera.position.x, this.camera.position.y, 0)).length();
                const volume = Math.max(0, Math.min(1, 0.1 * totalMagnitude)) * Math.exp(-0.5 * Math.max(0, distance - 10));
                const pan = Math.max(-1, Math.min(1, (contactPoint.x - this.camera.position.x) / 15));
                if (volume > 0.01) { this.sounds.play("asteroidCollision", { volume, pan }); }
            }

            this.particles.handleAsteroidCollision(asteroid, damage);
            if (asteroid.userData.health <= 0 && !asteroid.userData.isSplitting) {
                const impact = { point: asteroid.position.clone().addScaledVector(otherMesh.position.clone().sub(asteroid.position).normalize(), 0.5 * asteroid.userData.diameter) };
                impact.velocity = asteroid.position.clone().sub(impact.point).normalize();
                impact.hitBy = "asteroid";
                asteroid.userData.recentImpact = impact;
                this.splitAsteroid(asteroid, impact);
            }
        };

        this.physics.add(asteroid, { mass: asteroid.userData.volume }, true, physicsEaseInSeconds);
        this.asteroids.push(asteroid);
        this.scene.add(asteroid);
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
        this.asteroids = this.asteroids.filter(a => !a.userData.isRemoved);
    }

    /**
     * Explodes an asteroid and spawns debris ("material").
     */
    explodeAsteroid(asteroid) {
        this.particles.handleAsteroidExplosion(asteroid);
        const numDebris = Math.floor(85 * asteroid.userData.volume);
        const materialValue = asteroid.userData.materialValue * asteroid.userData.volume / numDebris;
        for (let i = 0; i < numDebris; i++) {
            const debris = createDebris(asteroid, materialValue, this.time);
            this.physics.add(debris, undefined, false);
            this.debris.push(debris);
            this.scene.add(debris);
        }
        this.removeAsteroid(asteroid);
    }

    removeAsteroid(asteroid) {
        if (asteroid.userData.isRemoved) { return; }
        this.scene.remove(asteroid);
        this.physics.remove(asteroid);
        asteroid.userData.isRemoved = true;
    }

    /** Handles material pickup. */
    updateDebris(dt) {
        const takeDistSq = this.debrisTakeDistance * this.debrisTakeDistance;
        const takeFinishDistSq = this.debrisTakeFinishDistance * this.debrisTakeFinishDistance;
        for (const debris of this.debris) {
            if (debris.userData.takeProgress === null) {
                // Idle
                const offset = new THREE.Vector2(debris.position.x, debris.position.y).sub(new THREE.Vector2(this.player.position.x, this.player.position.y));
                if (this.player.userData.isAlive && offset.lengthSq() < takeDistSq) {
                    // Initiate being sucked in
                    this.physics.remove(debris);
                    debris.userData.takeProgress = 0;
                    debris.userData.takeOriginalPosition = debris.position.clone();
                    this.sounds.play("suck", { pitch: 1 + 0.2 * (Math.random() - 0.5) }, 0.07);
                } else if (this.time > debris.userData.timestamp + debris.userData.ttl - debris.userData.fadeoutTime) {
                    if (!debris.userData.isMaterialUnique) {
                        // Initialize material for fade out
                        debris.material = debris.material.clone();
                        debris.material.transparent = true;
                        debris.userData.isMaterialUnique = true;
                    }
                    if (this.time > debris.userData.timestamp + debris.userData.ttl) {
                        // Discard
                        this.scene.remove(debris);
                        debris.userData.isRemoved = true;
                    } else {
                        // Fade out
                        debris.material.opacity -= dt / debris.userData.fadeoutTime;
                        debris.material.needs
                    }
                }
            } else if (debris.userData.takeProgress >= 1 || debris.position.clone().sub(this.player.position).lengthSq() < takeFinishDistSq) {
                // Collect
                this.player.userData.material += debris.userData.materialValue;
                this.scene.remove(debris);
                debris.userData.isRemoved = true;
                this.sounds.play("take", { pitch: 1.0 + 0.1 * (Math.random() - 0.5) }, 0.07);
            } else {
                // Suck in
                debris.userData.takeProgress += dt / this.debrisTakeDuration;
                const alpha = debris.userData.takeProgress * debris.userData.takeProgress;
                const position = debris.userData.takeOriginalPosition.clone().multiplyScalar(1 - alpha).addScaledVector(this.player.position, alpha);
                debris.position.copy(position);
            }
        }
        this.debris = this.debris.filter(d => !d.userData.isRemoved);
    }

    updateUniverse() {
        this.universe.update(this.camera);
    }

    createLaser(position, angle, speed, length = 0.5, radius = 0.02, ttl = 3, damage = 10) {
        this.sounds.play("laser", { volume: 1, pitch: 1 + 0.1 * (Math.random() - 0.5)});

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

    updateLasers(dt) {
        this.lasers.forEach(laser => {
            laser.userData.ttl -= dt;
            if (laser.userData.ttl <= 0) {
                this.removeLaser(laser);
            } else {
                laser.position.addScaledVector(laser.userData.velocity, dt);
                laser.userData.light.position.copy(laser.position);

                const hit = checkLaserHit(laser, this.asteroids, dt);
                if (hit) {
                    this.handleLaserHit(laser, hit.asteroid, hit.intersection);
                }
            }
        });

        this.lasers = this.lasers.filter(l => !l.userData.isRemoved);
    }

    removeLaser(laser) {
        if (laser.userData.isRemoved) { return; }
        this.scene.remove(laser);
        this.scene.remove(laser.userData.light);
        laser.userData.isRemoved = true;
    }

    handleLaserHit(laser, asteroid, intersection) {
        this.sounds.play("laserAsteroidImpact");

        asteroid.userData.health -= laser.userData.damage;
        const impact = {
            point: intersection.point,
            velocity: laser.userData.velocity.clone(),
            normal: intersection.face.normal,
            farPoint: intersection.farPoint,
            hitBy: "laser"
        };
        asteroid.userData.recentImpact = impact;
        asteroid.userData.nibble(impact);

        this.particles.handleLaserAsteroidImpact(impact, asteroid);
        this.removeLaser(laser);

        if (asteroid.userData.health <= 0 && !asteroid.userData.isSplitting) {
            this.splitAsteroid(asteroid, impact);
        }
    }

    handlePlayerCollision() {
        this.particles.handlePlayerExplosion(this.player);
        this.sounds.play("playerCollision");
        this.physics.disableAmmo(this.player);
        this.player.userData.isAlive = false;
        this.player.userData.speed = 0;
        this.player.userData.accel = 0;
        this.player.clear(); // remove mesh
    }

    handleSplitWorkerResponse(message) {
        const parentAsteroid = this.asteroids.find((a) => a.uuid == message.data.parentUuid);
        const splitAsteroids = [];
        let exploded = false;
        let sign = 1;

        message.data.splits.forEach((result) => {
            // Mesh
            result.geometry = new THREE.BufferGeometry();
            result.geometry.setAttribute("position", new THREE.Float32BufferAttribute(result.vertexArray, 3));
            result.geometry.setAttribute("normal", new THREE.Float32BufferAttribute(result.normalArray, 3));
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
                exploded = true;
            } else {
                this.addAsteroid(mesh, 0.5);
            }
            splitAsteroids.push(mesh);
        });

        this.removeAsteroid(parentAsteroid);
        this.particles.handleAsteroidSplit(parentAsteroid.userData.recentImpact, parentAsteroid, splitAsteroids[0]);

        if (parentAsteroid.userData.recentImpact.hitBy == "laser") {
            if (parentAsteroid.userData.volume > 0.175) {
                this.camera.userData.shake += 0.02 * Math.sqrt(parentAsteroid.userData.volume);
            }
            if (exploded) {
                this.sounds.play("asteroidExplosion");
            } else {
                this.sounds.play("asteroidSplit");
            }
        }
    }

    /** Provides dummy scenes with increasing number of lights to pre-compile shaders. */
    *loadingScenes(numLights = 30) {
        const scene = new THREE.Scene();
        this.addDefaultLights(scene);

        const asteroidBox = createDummyAsteroid();
        scene.add(asteroidBox);

        this.particles.scene = scene;
        this.particles.addColorParticleChunk([-1.5, 0, 0], [0, 0, 0], 1, 1, 0, 0, 0x999999);
        this.particles.addTextureParticleChunk([-2.5, 0, 0], [0, 0, 0], 1, 1, 0, 0, this.particles.smokeTexture, THREE.NormalBlending, 0.25, 1);
        this.particles.particleChunks = [];
        this.particles.scene = this.scene;

        yield scene;

        for (let i = 0; i < numLights; i++) {
            const color = new THREE.Color(Math.random(), Math.random(), Math.random());
            const light = new THREE.PointLight(color, 1, 10);
            light.position.set(
                2.0 * Math.cos(i / numLights * 2 * Math.PI),
                2.0 * Math.sin(i / numLights * 2 * Math.PI),
                1.5
            );
            scene.add(light);
            yield scene;
        }
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
