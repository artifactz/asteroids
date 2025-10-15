import * as THREE from 'three';
import { SSAARenderPass } from 'three/examples/jsm/postprocessing/SSAARenderPass.js';
import { SmokeLighting, Blend } from './PostProcessing.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';


/**
 * Main renderer class that manages different rendering pipelines (MSAA or SSAA).
 */
export class Renderer {
    constructor(antiAliasing = "MSAA") {
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

        this.setPipeline(antiAliasing);
    }

    setPipeline(mode) {
        if (mode == "Disabled") {
            this.pipeline = new NoAARenderPipeline(this.renderer);
        } else if (mode == "MSAA") {
            this.pipeline = new MSAARenderPipeline(this.renderer);
        } else if (mode == "SSAA") {
            this.pipeline = new SSAARenderPipeline(this.renderer);
        } else if (mode == "FXAA") {
            this.pipeline = new FXAARenderPipeline(this.renderer);
        } else {
            throw new Error(`Unknown render pipeline mode: ${mode}`);
        }
    }

    render(world) {
        this.pipeline.render(world, this.renderer, this.blend, this.smokeLighting);
    }

    setSize(w, h) {
        this.renderer.setSize(w, h);
        this.smokeLighting.setSize(w, h);
        this.pipeline.setSize(w, h);
    }

    get depthTexture() {
        return this.pipeline.depthTexture;
    }
}

/**
 * Pipeline without anti-aliasing.
 */
class NoAARenderPipeline {
    constructor(renderer) {
        this.renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType,
            depthBuffer: true,
        });
        this.renderTarget.depthTexture = new THREE.DepthTexture();
        this.renderTarget.depthTexture.format = THREE.DepthFormat;
        this.renderTarget.depthTexture.type = THREE.UnsignedShortType;
    }

    render(world, renderer, blend, smokeLighting) {
        renderer.setRenderTarget(this.renderTarget);
        renderer.clear();
        renderer.render(world.scene, world.camera);

        renderer.setRenderTarget(null);
        blend.render(renderer, this.renderTarget.texture);
        smokeLighting.render(renderer, world.particles.scene, world.scene, world.camera);
    }

    setSize(w, h) {
        this.renderTarget.setSize(w, h);
    }

    get depthTexture() {
        return this.renderTarget.depthTexture;
    }
}

/**
 * Pipeline using a multi-sample render target (MSAA).
 */
class MSAARenderPipeline {
    constructor(renderer) {
        const numSamples = Math.min(8, renderer.capabilities.maxSamples);
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

    render(world, renderer, blend, smokeLighting) {
        renderer.setRenderTarget(this.msaaRenderTarget);
        renderer.clear();
        renderer.render(world.scene, world.camera);

        renderer.setRenderTarget(null);
        blend.render(renderer, this.msaaRenderTarget.texture);
        // TODO do blending in smoke lighting shader to save one rendering step
        smokeLighting.render(renderer, world.particles.scene, world.scene, world.camera);
    }

    setSize(w, h) {
        this.msaaRenderTarget.setSize(w, h);
    }

    get depthTexture() {
        return this.msaaRenderTarget.depthTexture;
    }
}

/**
 * Pipeline using a super-sampling render pass (SSAA).
 */
class SSAARenderPipeline {
    constructor(renderer) {
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

    render(world, renderer, blend, smokeLighting) {
        if (!this.ssaa) {
            this.ssaa = new SSAARenderPass(world.scene, world.camera);
            this.ssaa._sampleRenderTarget = this.sampleRenderTarget;
        }

        // Render main scene layer using super-sampling AA (readBuffer argument is only used for buffer sizes)
        // NOTE: Rendering SSAA directly to the screen (null) looks like it uses incorrect color space
        this.ssaa.render(renderer, this.resultRenderTarget, this.resultRenderTarget);

        // Render result to screen
        renderer.setRenderTarget(null);
        blend.render(renderer, this.resultRenderTarget.texture);

        // Render smoke on top
        smokeLighting.render(renderer, world.particles.scene, world.scene, world.camera);
    }

    setSize(w, h) {
        this.resultRenderTarget.setSize(w, h);
        this.sampleRenderTarget.setSize(w, h);
    }

    get depthTexture() {
        return this.sampleRenderTarget.depthTexture;
    }
}

/**
 * Pipeline using FXAA shader pass.
 */
class FXAARenderPipeline {
    constructor(renderer) {
        this.renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType,
            depthBuffer: true,
        });
        this.renderTarget.depthTexture = new THREE.DepthTexture();
        this.renderTarget.depthTexture.format = THREE.DepthFormat;
        this.renderTarget.depthTexture.type = THREE.UnsignedShortType;

        this.fxaaRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            format: THREE.RGBAFormat,
            type: THREE.HalfFloatType,
            depthBuffer: false,
        });

        this.fxaaPass = new ShaderPass(FXAAShader);
        this.fxaaPass.material.uniforms['resolution'].value.x = 0.5 / window.innerWidth;
        this.fxaaPass.material.uniforms['resolution'].value.y = 0.5 / window.innerHeight;
    }

    render(world, renderer, blend, smokeLighting) {
        renderer.setRenderTarget(this.renderTarget);
        renderer.clear();
        renderer.render(world.scene, world.camera);

        this.fxaaPass.render(renderer, this.fxaaRenderTarget, this.renderTarget);

        renderer.setRenderTarget(null);
        blend.render(renderer, this.fxaaRenderTarget.texture);

        smokeLighting.render(renderer, world.particles.scene, world.scene, world.camera);
    }

    setSize(w, h) {
        this.renderTarget.setSize(w, h);
        this.fxaaRenderTarget.setSize(w, h);
        this.fxaaPass.material.uniforms['resolution'].value.x = 0.5 / w;
        this.fxaaPass.material.uniforms['resolution'].value.y = 0.5 / h;
    }

    get depthTexture() {
        return this.renderTarget.depthTexture;
    }
}
