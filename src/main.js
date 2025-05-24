import * as THREE from 'three';
import { World, checkLaserHit } from './GameObjects.js';

const clock = new THREE.Clock();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const world = new World();

// === Input ===
const keys = {};
window.addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

// === Game Loop ===
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();  // ~0.007

    if (keys['a']) world.player.rotation.z += delta * world.player.userData.rotationalSpeed;
    if (keys['d']) world.player.rotation.z -= delta * world.player.userData.rotationalSpeed;
    if (keys['w']) {
        world.player.position.set(
            world.player.position.x + delta * Math.cos(world.player.rotation.z) * world.player.userData.speed,
            world.player.position.y + delta * Math.sin(world.player.rotation.z) * world.player.userData.speed,
            0
        );
    }
    if (keys['s']) {
        world.player.position.set(
            world.player.position.x - delta * Math.cos(world.player.rotation.z) * world.player.userData.speed,
            world.player.position.y - delta * Math.sin(world.player.rotation.z) * world.player.userData.speed,
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
        laser.userData.ttl -= delta;
        if (laser.userData.ttl <= 0) {
            world.scene.remove(laser);
            world.scene.remove(laser.userData.light);
            laser.isRemoved = true;
        } else {
            laser.position.x += delta * laser.userData.velocity.x;
            laser.position.y += delta * laser.userData.velocity.y;
            laser.userData.light.position.copy(laser.position);
        }
    });

    // Move asteroids
    world.asteroids.forEach(a => {
        a.position.x += delta * a.userData.velocity.x;
        a.position.y += delta * a.userData.velocity.y;
        a.rotation.x += delta * a.userData.rotationalVelocity.x;
        a.rotation.y += delta * a.userData.rotationalVelocity.y;
    });

    // Collision check
    world.lasers.forEach(laser => {
        if (!laser.isRemoved) {
            const hit = checkLaserHit(laser, world.asteroids);
            if (hit) {
                const impact = new THREE.Vector3(laser.userData.velocity.x, laser.userData.velocity.y, 0);
                world.particles.handleDefaultImpact(hit.intersection.point, hit.intersection.normal, impact);
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

    world.particles.update(delta);

    renderer.render(world.scene, world.camera);
}

animate();
