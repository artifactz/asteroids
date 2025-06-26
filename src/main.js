import * as THREE from 'three';
import Ammo from 'ammo.js';
import { getMousePositionAtZ, rotateTowards, moveCamera } from './Targeting.js';
import { World, checkLaserHit, checkAsteroidCollision, handleAsteroidCollision } from './GameObjects.js';
import { BlurLayer } from './PostProcessing.js';

const clock = new THREE.Clock();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.autoClear = false;
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const world = new World();
const blurLayer = new BlurLayer();

const collisionConfig = new Ammo.btDefaultCollisionConfiguration();
const physicsWorld = new Ammo.btDiscreteDynamicsWorld(
    new Ammo.btCollisionDispatcher(collisionConfig),
    new Ammo.btDbvtBroadphase(),
    new Ammo.btSequentialImpulseConstraintSolver(),
    collisionConfig
);
physicsWorld.setGravity(new Ammo.btVector3(0, 0, 0));  // No gravity in space
world.setPhysics(physicsWorld);

// === Input ===
const keys = {};
const mouse = {};
window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('mousedown', e => { e.preventDefault(); mouse[e.button] = true; });
window.addEventListener('mouseup', e => { e.preventDefault(); mouse[e.button] = false; });
window.addEventListener('mouseclick', e => { e.preventDefault(); });
window.addEventListener('contextmenu', e => { e.preventDefault(); });
window.addEventListener('resize', () => {
    world.camera.aspect = window.innerWidth / window.innerHeight;
    world.camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// === Game Loop ===
function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    if (mouse.x && mouse.y) {
        mouse.positionWorld = getMousePositionAtZ(renderer.domElement.getBoundingClientRect(), world.camera, mouse.x, mouse.y, 0);
    }
    if (mouse.positionWorld) {
        rotateTowards(world.player, mouse.positionWorld, dt);
        moveCamera(world, mouse.positionWorld, dt);
        world.brightStar.rotation.z = Math.atan2(world.brightStar.position.y - world.camera.position.y, world.brightStar.position.x - world.camera.position.x);
    }

    if (keys['w']) {
        world.player.position.set(
            world.player.position.x + dt * Math.cos(world.player.rotation.z) * world.player.userData.speed,
            world.player.position.y + dt * Math.sin(world.player.rotation.z) * world.player.userData.speed,
            0
        );
    }
    if (keys['s']) {
        world.player.position.set(
            world.player.position.x - dt * Math.cos(world.player.rotation.z) * world.player.userData.speed,
            world.player.position.y - dt * Math.sin(world.player.rotation.z) * world.player.userData.speed,
            0
        );
    }

    // Shoot
    if (mouse[0] && world.player.userData.laserHeat <= 0) {
        const noiseRad = (2 * Math.random() - 1) * world.player.userData.laserSpreadRad;
        world.createLaser(world.player.position, world.player.rotation.z + noiseRad);
        world.player.userData.laserHeat = world.player.userData.laserCooldownPeriod;
    }
    world.player.userData.laserHeat -= dt;

    // Move lasers
    world.updateLasers(dt);

    // Move asteroids
    world.updateAsteroids(dt);

    // // Collide asteroids with other asteroids
    // for (let i = 0; i < world.asteroids.length; i++) {
    //     for (let j = i + 1; j < world.asteroids.length; j++) {
    //         const a = world.asteroids[i], b = world.asteroids[j];
    //         if (a.userData.asteroidCollisionHeat.get(b) > 0 || b.userData.asteroidCollisionHeat.get(a) > 0) { console.log("skipping"); continue; }
    //         if (checkAsteroidCollision(a, b)) {
    //             handleAsteroidCollision(a, b);
    //         }
    //     }
    // }

    // Collide lasers with asteroids
    world.lasers.forEach(laser => {
        if (!laser.isRemoved) {
            const hit = checkLaserHit(laser, world.asteroids);
            if (hit) {
                world.handleLaserHit(laser, hit);
            }
        }
    });

    world.removeLasers();

    world.particles.update(dt);

    renderer.setRenderTarget(null);
    renderer.setClearColor(world.clearColor);
    renderer.clear();
    renderer.render(world.scene, world.camera);

    blurLayer.render(renderer, world.scene, world.camera, dt);
}

animate();
