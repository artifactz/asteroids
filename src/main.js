import * as THREE from 'three';
import { World, checkLaserHit, nibbleAsteroid } from './GameObjects.js';
import { BlurLayer } from './PostProcessing.js';

const clock = new THREE.Clock();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.autoClear = false;
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const world = new World();
const blurLayer = new BlurLayer();

// === Input ===
const keys = {};
window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

// === Game Loop ===
function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    if (keys['a']) world.player.rotation.z += dt * world.player.userData.rotationalSpeed;
    if (keys['d']) world.player.rotation.z -= dt * world.player.userData.rotationalSpeed;
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
    if (keys[' ']) {
        if (!keys._lastSpace) {
            world.createLaser(world.player.position, world.player.rotation.z);
        }
        keys._lastSpace = true;
    } else {
        keys._lastSpace = false;
    }

    // Move lasers
    world.lasers.forEach(laser => {
        laser.userData.ttl -= dt;
        if (laser.userData.ttl <= 0) {
            world.scene.remove(laser);
            world.scene.remove(laser.userData.light);
            laser.isRemoved = true;
        } else {
            laser.position.x += dt * laser.userData.velocity.x;
            laser.position.y += dt * laser.userData.velocity.y;
            laser.userData.light.position.copy(laser.position);
        }
    });

    // Move asteroids
    world.asteroids.forEach(a => {
        a.position.x += dt * a.userData.velocity.x;
        a.position.y += dt * a.userData.velocity.y;
        a.rotation.x += dt * a.userData.rotationalVelocity.x;
        a.rotation.y += dt * a.userData.rotationalVelocity.y;
    });

    // Collision check
    world.lasers.forEach(laser => {
        if (!laser.isRemoved) {
            const hit = checkLaserHit(laser, world.asteroids);
            if (hit) {
                hit.intersection.impact = new THREE.Vector3(laser.userData.velocity.x, laser.userData.velocity.y, 0);
                nibbleAsteroid(hit.asteroid, hit.intersection);

                world.particles.handleDefaultImpact(hit.intersection, hit.asteroid);
                world.scene.remove(laser);
                world.scene.remove(laser.userData.light);
                laser.isRemoved = true;
                if (Math.random() <= 0.1) {
                    world.splitAsteroid(hit.asteroid, laser);
                }
            }
        }
    });
    world.lasers = world.lasers.filter(l => !l.isRemoved);

    world.particles.update(dt);

    renderer.setRenderTarget(null);
    renderer.setClearColor(world.clearColor);
    renderer.clear();
    renderer.render(world.scene, world.camera);

    blurLayer.render(renderer, world.scene, world.camera, dt);
}

animate();
