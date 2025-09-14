import * as THREE from 'three';
import { SSAARenderPass } from 'three/examples/jsm/postprocessing/SSAARenderPass.js';
import { getMousePositionAtZ } from './Targeting';
import { World } from './GameObjects';
import { SmokeLighting, Blend } from './PostProcessing';
import { initHud, showGameStart, updateFps } from './Hud';
import { GameController } from './GameController';


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

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('three-canvas'), antialias: false });
renderer.autoClear = false;
renderer.setSize(window.innerWidth, window.innerHeight);

initHud();

// Off-screen render target used to access main scene depth buffer
const renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: true,
});
renderTarget.depthTexture = new THREE.DepthTexture();
renderTarget.depthTexture.format = THREE.DepthFormat;
renderTarget.depthTexture.type = THREE.UnsignedShortType;

const world = new World(renderer, renderTarget.depthTexture);

const blend = new Blend(THREE.NormalBlending);
const smokeLighting = new SmokeLighting();
const ssaa = new SSAARenderPass(world.scene, world.camera);

const controller = new GameController(world);

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
    const [w, h] = [window.innerWidth, window.innerHeight];
    world.camera.aspect = w / h;
    world.camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    renderTarget.setSize(w, h);
    smokeLighting.setSize(w, h);
});

/** Renders world scene and lit smoke. */
function render(scene, camera) {
    renderer.setRenderTarget(renderTarget);
    renderer.setClearColor(world.clearColor);
    renderer.clear();
    // Render main scene layer to renderTarget using super-sampling AA (readBuffer argument is only used for buffer sizes)
    ssaa.render(renderer, renderTarget, renderTarget);

    renderer.setRenderTarget(null);
    blend.render(renderer, renderTarget.texture);

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
