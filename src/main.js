import * as THREE from 'three';
import Ammo from 'ammo.js';
import { getMousePositionAtZ, rotateTowards, moveCamera } from './Targeting.js';
import { World, WorldState, checkLaserHit } from './GameObjects.js';
import { SmokeLighting, Blend } from './PostProcessing.js';
import { initHud, updateThrustBar, showGameOver, updateMaterial } from './Hud.js';

const clock = new THREE.Clock();

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('three-canvas') }); // { antialias: true }
renderer.autoClear = false;
renderer.setSize(window.innerWidth, window.innerHeight);

initHud();

// Off-screen render target used to access main scene depth buffer
const renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    samples: 8,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: true,
});
renderTarget.depthTexture = new THREE.DepthTexture();
renderTarget.depthTexture.format = THREE.DepthFormat;
renderTarget.depthTexture.type = THREE.UnsignedShortType;

const world = new World(renderTarget.depthTexture);

const blend = new Blend(THREE.NormalBlending);
const smokeLighting = new SmokeLighting();

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

    if (world.state == WorldState.Playing && keys['w']) {
        world.player.userData.accel = world.player.userData.maxAccel;
    } else if (world.state == WorldState.Playing && keys['s']) {
        world.player.userData.accel = -world.player.userData.maxAccel;
    } else {
        world.player.userData.accel = 0;
    }

    world.updatePlayer(dt);

    // Shoot
    if (world.state == WorldState.Playing && mouse[0] && world.player.userData.laserHeat <= 0) {
        const noiseRad = (2 * Math.random() - 1) * world.player.userData.laserSpreadRad;
        world.createLaser(world.player.position, world.player.rotation.z + noiseRad);
        world.player.userData.laserHeat = world.player.userData.laserCooldownPeriod;
    }
    world.player.userData.laserHeat -= dt;

    // Move lasers
    world.updateLasers(dt);

    // Advance physics
    world.physics.stepSimulation(dt, 10);

    // Move asteroids
    world.updateAsteroids(dt);

    // Collide lasers with asteroids
    world.lasers.forEach(laser => {
        if (!laser.isRemoved) {
            const hit = checkLaserHit(laser, world.asteroids);
            if (hit) {
                world.handleLaserHit(laser, hit, dt);
            }
        }
    });

    world.removeLasers();

    world.particles.update(dt);

    // Update UI
    updateThrustBar(Math.abs(world.player.userData.speed) / world.player.userData.maxSpeed);
    updateMaterial(world.player.userData.material);

    renderer.setRenderTarget(renderTarget);
    renderer.setClearColor(world.clearColor);
    renderer.clear();
    renderer.render(world.scene, world.camera);

    renderer.setRenderTarget(null);
    blend.render(renderer, renderTarget.texture);

    smokeLighting.render(renderer, world.scene, world.camera, dt);

    if (world.state == WorldState.EndScreen && world.prevState == WorldState.Playing) {
        showGameOver();
    }
    world.prevState = world.state;
}

animate();
