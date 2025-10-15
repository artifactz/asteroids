import * as THREE from 'three';
import { getMousePositionAtZ } from './Targeting.js';
import { World } from './world/World.js';
import { initHud, showGameStart, updateFps } from './Hud.js';
import { GameController } from './GameController.js';
import { Renderer } from './Renderer.js';


const clock = new THREE.Clock();

/** Calculates and displays FPS. */
const fps = {
    flushInterval: 1,
    lastFlushAge: 0,
    deltas: [],
    update(dt) {
        if (!dt) { return; }
        this.deltas.push(dt);
        this.lastFlushAge += dt;
        if (this.lastFlushAge >= this.flushInterval) {
            const avgDelta = this.deltas.reduce((a, b) => a + b, 0) / this.deltas.length;
            updateFps(1 / avgDelta);
            this.deltas = [];
            this.lastFlushAge = 0;
        }
    }
}

const aaCookie = document.cookie.split('; ').find(row => row.startsWith('antialiasing='));
const antiAliasing = aaCookie ? aaCookie.split('=')[1] : "MSAA";
const renderer = new Renderer(antiAliasing);
initHud(antiAliasing, newAA => {
    renderer.setPipeline(newAA);
    world.setRenderer(renderer);
    document.cookie = `antialiasing=${newAA}; path=/; max-age=${60 * 60 * 24 * 365}`; // 1 year
});
const world = new World(renderer.renderer, renderer.depthTexture);
const controller = new GameController(world);

// === Input ===
const keys = {};
const mouse = {};
window.addEventListener('keydown', e => { if (e.key) { keys[e.key.toLowerCase()] = true; } });
window.addEventListener('keyup', e => { if (e.key) { keys[e.key.toLowerCase()] = false; } });
window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('mousedown', e => { e.preventDefault(); mouse[e.button] = true; mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('mouseup', e => { e.preventDefault(); mouse[e.button] = false; mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('mouseclick', e => { e.preventDefault(); });
window.addEventListener('contextmenu', e => { e.preventDefault(); });
window.addEventListener('resize', () => {
    const [w, h] = [window.innerWidth, window.innerHeight];
    world.camera.aspect = w / h;
    world.camera.updateProjectionMatrix();
    renderer.setSize(w, h);
});


/** Renders an empty scene until models and textures are availabe, then renders loading scenes and starts the game loop. */
function animateLoading() {
    const scene = new THREE.Scene();
    scene.background = 0x000000;
    renderer.render(world);

    if (world.particles.smokeTexture && world.player.children.length) {
        // Currently disabled in favor of LightPool
        // for (const scene of world.loadingScenes()) {
        //     renderer.compile(scene, world.camera);
        //     render(scene, world.camera);
        // }
        renderer.renderer.compile(world.scene, world.camera);

        showGameStart();
        animate();
    } else {
        requestAnimationFrame(animateLoading);
    }
}

/** Game Loop */
function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    fps.update(dt);

    if (mouse.x && mouse.y) {
        mouse.positionWorld = getMousePositionAtZ(renderer.renderer.domElement.getBoundingClientRect(), world.camera, mouse.x, mouse.y, 0);
    }

    controller.update(keys, mouse, dt);
    renderer.render(world);
}

animateLoading();
