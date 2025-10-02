import * as THREE from 'three';
import { SSAARenderPass } from 'three/examples/jsm/postprocessing/SSAARenderPass.js';
import { getMousePositionAtZ } from './Targeting.js';
import { World } from './world/World.js';
import { SmokeLighting, Blend } from './PostProcessing.js';
import { initHud, showGameStart, updateFps } from './Hud.js';
import { GameController } from './GameController.js';


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

const renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('three-canvas'),
    antialias: false,
    powerPreference: "high-performance",
    logarithmicDepthBuffer: false,
    precision: "highp"
});
renderer.autoClear = false;
renderer.setSize(window.innerWidth, window.innerHeight);

initHud();

// Off-screen render target used to access main scene depth buffer (and by SSAA to render samples)
const ssaaSampleRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: true,
});
ssaaSampleRenderTarget.depthTexture = new THREE.DepthTexture();
ssaaSampleRenderTarget.depthTexture.format = THREE.DepthFormat;
ssaaSampleRenderTarget.depthTexture.type = THREE.UnsignedShortType;

// Off-screen render target used to sum up SSAA samples
const ssaaResultRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: false,
});

const world = new World(renderer, ssaaSampleRenderTarget.depthTexture);

const blend = new Blend(THREE.NormalBlending);
const smokeLighting = new SmokeLighting();
const ssaa = new SSAARenderPass(world.scene, world.camera);
ssaa._sampleRenderTarget = ssaaSampleRenderTarget;

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
    ssaaSampleRenderTarget.setSize(w, h);
    ssaaResultRenderTarget.setSize(w, h);
    smokeLighting.setSize(w, h);
});

/** Renders world scene and lit smoke. */
function render(scene, camera) {
    // Render main scene layer using super-sampling AA (readBuffer argument is only used for buffer sizes)
    // NOTE: Rendering SSAA directly to the screen (null) looks like it uses incorrect color space
    ssaa.render(renderer, ssaaResultRenderTarget, ssaaResultRenderTarget);

    // Render result to screen
    renderer.setRenderTarget(null);
    blend.render(renderer, ssaaResultRenderTarget.texture);

    // Render smoke on top
    smokeLighting.render(renderer, scene, camera);
}

/** Renders an empty scene until models and textures are availabe, then renders loading scenes and starts the game loop. */
function animateLoading() {
    const scene = new THREE.Scene();
    scene.background = 0x000000;
    render(scene, world.camera);

    if (world.particles.smokeTexture && world.player.children.length) {
        for (const scene of world.loadingScenes()) {
            render(scene, world.camera);
        }

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
        mouse.positionWorld = getMousePositionAtZ(renderer.domElement.getBoundingClientRect(), world.camera, mouse.x, mouse.y, 0);
    }

    controller.update(keys, mouse, dt);
    render(world.scene, world.camera);

}

animateLoading();
