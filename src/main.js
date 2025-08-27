import * as THREE from 'three';
import { getMousePositionAtZ } from './Targeting';
import { World } from './GameObjects';
import { SmokeLighting, Blend } from './PostProcessing';
import { initHud } from './Hud';
import { GameController } from './GameController';

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
    world.camera.aspect = window.innerWidth / window.innerHeight;
    world.camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderTarget.setSize(window.innerWidth, window.innerHeight);
    smokeLighting.setSize(window.innerWidth, window.innerHeight);
});

// === Game Loop ===
function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    if (mouse.x && mouse.y) {
        mouse.positionWorld = getMousePositionAtZ(renderer.domElement.getBoundingClientRect(), world.camera, mouse.x, mouse.y, 0);
    }

    controller.update(keys, mouse, dt);

    // Render
    renderer.setRenderTarget(renderTarget);
    renderer.setClearColor(world.clearColor);
    renderer.clear();
    renderer.render(world.scene, world.camera);

    renderer.setRenderTarget(null);
    blend.render(renderer, renderTarget.texture);

    smokeLighting.render(renderer, world.scene, world.camera, dt);

}

animate();
