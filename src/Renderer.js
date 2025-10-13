import * as THREE from 'three';
import { SSAARenderPass } from 'three/examples/jsm/postprocessing/SSAARenderPass.js';
import { SmokeLighting, Blend } from './PostProcessing.js';


/** Base class */
class Renderer {
    constructor() {
        this.renderer = new THREE.WebGLRenderer({
            canvas: document.getElementById('three-canvas'),
            antialias: false,
            powerPreference: "high-performance",
            logarithmicDepthBuffer: false,
            precision: "highp"
        });
        this.renderer.autoClear = false;
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        this.blend = new Blend(THREE.NormalBlending);
        this.smokeLighting = new SmokeLighting();
    }

    setSize(w, h) {
        this.renderer.setSize(w, h);
        this.smokeLighting.setSize(w, h);
    }

    get depthTexture() {}
}

/**
 * Renderer using a multi-sample render target (MSAA).
 */
export class MSAARenderer extends Renderer {
    constructor() {
        super();
        const numSamples = Math.min(8, this.renderer.capabilities.maxSamples);
        this.msaaRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType,
            samples: numSamples,
            depthBuffer: true,
        });
        this.msaaRenderTarget.depthTexture = new THREE.DepthTexture();
        this.msaaRenderTarget.depthTexture.format = THREE.DepthFormat;
        this.msaaRenderTarget.depthTexture.type = THREE.UnsignedShortType;
    }

    render(world) {
        this.renderer.setRenderTarget(this.msaaRenderTarget);
        this.renderer.clear();
        this.renderer.render(world.scene, world.camera);

        this.renderer.setRenderTarget(null);
        this.blend.render(this.renderer, this.msaaRenderTarget.texture);
        // TODO do blending in smoke lighting shader to save one rendering step
        this.smokeLighting.render(this.renderer, world.particles.scene, world.scene, world.camera);
    }

    setSize(w, h) {
        super.setSize(w, h);
        this.msaaRenderTarget.setSize(w, h);
    }

    get depthTexture() {
        return this.msaaRenderTarget.depthTexture;
    }
}

/**
 * Renderer using a super-sampling render pass (SSAA).
 */
export class SSAARenderer extends Renderer {
    constructor() {
        super();
        // Off-screen render target used to render individual SSAA samples and to access the main scene depth buffer
        this.sampleRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType,
            depthBuffer: true,
        });
        this.sampleRenderTarget.depthTexture = new THREE.DepthTexture();
        this.sampleRenderTarget.depthTexture.format = THREE.DepthFormat;
        this.sampleRenderTarget.depthTexture.type = THREE.UnsignedShortType;

        // Off-screen render target used to sum up SSAA samples
        this.resultRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType,
            depthBuffer: false,
        });

        this.ssaa = null;
    }

    render(world) {
        if (!this.ssaa) {
            this.ssaa = new SSAARenderPass(world.scene, world.camera);
            this.ssaa._sampleRenderTarget = this.sampleRenderTarget;
        }

        // Render main scene layer using super-sampling AA (readBuffer argument is only used for buffer sizes)
        // NOTE: Rendering SSAA directly to the screen (null) looks like it uses incorrect color space
        this.ssaa.render(this.renderer, this.resultRenderTarget, this.resultRenderTarget);

        // Render result to screen
        this.renderer.setRenderTarget(null);
        this.blend.render(this.renderer, this.resultRenderTarget.texture);

        // Render smoke on top
        this.smokeLighting.render(this.renderer, world.particles.scene, world.scene, world.camera);
    }

    setSize(w, h) {
        super.setSize(w, h);
        this.resultRenderTarget.setSize(w, h);
        this.sampleRenderTarget.setSize(w, h);
    }

    get depthTexture() {
        return this.sampleRenderTarget.depthTexture;
    }
}
