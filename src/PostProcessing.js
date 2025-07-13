import * as THREE from 'three';

/**
 * Estimates 2d lighting of a scene layer by adding the light color to nearby pixels.
 */
export class SmokeLighting {
    constructor() {
        this.ping = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            transparent: true,
            depthBuffer: true,
            stencilBuffer: false,
        });
        this.pong = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
            transparent: true,
            depthBuffer: true,
            stencilBuffer: false,
        });

        this.smokeLightingMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tSmoke: { value: this.ping.texture },
                resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                lights: { value: [] },
                lightColors: { value: [] },
                lightIntensities: { value: [] },
                numLights: { value: 0 },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xyz, 1.0);
                }
            `,
            // TODO make falloff depend on PointLight.decay
            fragmentShader: `
                uniform sampler2D tSmoke;
                uniform vec2 resolution;
                uniform vec2 lights[10]; // max 10 lights
                uniform vec3 lightColors[10];
                uniform float lightIntensities[10];
                uniform int numLights;

                varying vec2 vUv;

                void main() {
                    vec4 smoke = texture2D(tSmoke, vUv);
                    if (smoke.a == 0.0) { discard; }
                    vec3 litColor = smoke.rgb;

                    for (int i = 0; i < 10; i++) {
                        if (i >= numLights) break;

                        vec2 lightUV = lights[i];
                        float dist = distance(vUv, lightUV);
                        float falloff = exp(-18.0 * dist);
                        litColor += lightColors[i] * lightIntensities[i] * falloff;
                    }

                    gl_FragColor = vec4(litColor, smoke.a);
                }
            `,
            transparent: true,
            blending: THREE.NormalBlending,
        });

        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.smokeLightingMaterial);
        this.scene = new THREE.Scene();
        this.scene.add(quad);

        this.blend = new Blend(THREE.NormalBlending);
    }

    /**
     * Renders scene objects from the specified layer, estimates 2d lighting, and renders them to the screen buffer.
     */
    render(renderer, scene, camera, dt, layer = 1) {
        renderer.setRenderTarget(this.ping);
        renderer.setClearColor(new THREE.Color(0x000000), 0);  // transparent black
        renderer.clear();
        camera.layers.disable(0);
        camera.layers.enable(layer);
        renderer.render(scene, camera);
        camera.layers.disable(layer);
        camera.layers.enable(0);

        renderer.setRenderTarget(null);
        this.updateLights(scene, camera);
        renderer.render(this.scene, orthoCam);
    }

    /**
     * Sets shader uniforms from PointLights in scene.
     */
    updateLights(scene, camera) {
        const screenPositions = [];
        const lightColors = [];
        const lightIntensities = [];
        for (const element of scene.children) {
            if (element instanceof THREE.PointLight) {
                const light = element;
                // Convert light position to screen coordinates
                const vector = new THREE.Vector3();
                vector.setFromMatrixPosition(light.matrixWorld);
                vector.project(camera);

                // Normalize to [0, 1] range
                vector.x = (vector.x + 1) / 2;
                vector.y = (vector.y + 1) / 2;

                screenPositions.push(new THREE.Vector2(vector.x, vector.y));
                lightColors.push(light.color.clone());
                lightIntensities.push(light.intensity);
                console.log(light.intensity);
            }
        }

        this.smokeLightingMaterial.uniforms.numLights.value = screenPositions.length;

        for (; screenPositions.length < 10; ) {
            screenPositions.push(new THREE.Vector2());
            lightColors.push(new THREE.Color(0, 0, 0));
            lightIntensities.push(0);
        }

        this.smokeLightingMaterial.uniforms.lights.value = screenPositions;
        this.smokeLightingMaterial.uniforms.lightColors.value = lightColors;
        this.smokeLightingMaterial.uniforms.lightIntensities.value = lightIntensities;
    }
}


/**
 * Ghost glow effect -- currently not used.
 */
export class BlurLayer {
    constructor(fadePerSecond = 0.7) {
        this.fadePerSecond = fadePerSecond;

        this.ping = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            type: THREE.HalfFloatType,
            format: THREE.RGBAFormat,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
        });
        this.pong = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
            type: THREE.HalfFloatType,
            format: THREE.RGBAFormat,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
        });

        this.fade = new Fade();
        this.blur = new Blur();
        this.blend = new Blend();
    }

    render(renderer, scene, camera, dt, blurredLayer = 1) {
        // Render this frame's glowing objects
        renderer.setRenderTarget(this.pong);
        renderer.clear(false, true, true);
        camera.layers.disable(0);
        camera.layers.enable(blurredLayer);
        renderer.render(scene, camera);
        camera.layers.disable(blurredLayer);
        camera.layers.enable(0);

        // Adjust their intensity
        this.fade.render(renderer, 1.0 - 0.8 * dt);  // TODO parameter

        // Decay existing glow
        renderer.setRenderTarget(this.ping);
        const opacity = 1 - Math.pow(1 - this.fadePerSecond, dt);
        this.fade.render(renderer, opacity);  // TODO value might become too small for float8 to work properly

        // Add new adjusted glow
        this.blend.render(renderer, this.pong.texture);

        // Blur
        this.blur.render(renderer, this.ping, this.pong);

        // Composite
        renderer.setRenderTarget(null);
        this.blend.render(renderer, this.ping.texture);
    }
}

class Fade {
    constructor(color = 0x000000) {
        this.mat = new THREE.MeshBasicMaterial({
            color: color,
            blending: THREE.NormalBlending,
            transparent: true,
            opacity: 0.1,
            depthWrite: false,
            depthTest: false,
        });
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
        this.scene = new THREE.Scene();
        this.scene.add(quad);
    }

    render(renderer, opacity) {
        this.mat.opacity = opacity;
        renderer.render(this.scene, orthoCam);
    }
}

class Blur {
    constructor() {
        const blurShader = {
            uniforms: {
                tDiffuse: { value: null },
                direction: { value: new THREE.Vector2(1.0, 0.0) },
                resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform vec2 direction;
                uniform vec2 resolution;
                uniform float decay;
                varying vec2 vUv;
                void main() {
                vec4 color = vec4(0.0);
                float total = 0.0;
                float sigma = 5.0;
                float weight[5];
                weight[0] = 0.227027;
                weight[1] = 0.1945946;
                weight[2] = 0.1216216;
                weight[3] = 0.054054;
                weight[4] = 0.016216;

                for (int i = -4; i <= 4; ++i) {
                    float w = weight[abs(i)];
                    vec2 offset = direction * float(i) / resolution;
                    color += texture2D(tDiffuse, vUv + offset) * w;
                    total += w;
                }

                //gl_FragColor = vec4(decay * color.rgb / total, 1.0);
                gl_FragColor = vec4(color.rgb / total, 1.0);
                }
            `,
        };
        this.mat = new THREE.ShaderMaterial(blurShader);
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
        this.scene = new THREE.Scene();
        this.scene.add(quad);
    }

    render(renderer, inputAndOutputTarget, temporaryTarget) {
        // Blur horizontally nextGlow -> currentGlow
        this.mat.uniforms.tDiffuse.value = inputAndOutputTarget.texture;
        this.mat.uniforms.direction.value.set(1.0, 0.0);
        this.mat.uniforms.decay = 1.0;  // XXX
        renderer.setRenderTarget(temporaryTarget);
        renderer.clear();
        renderer.render(this.scene, orthoCam);

        // Blur vertically currentGlow -> nextGlow
        this.mat.uniforms.tDiffuse.value = temporaryTarget.texture;
        this.mat.uniforms.direction.value.set(0.0, 1.0);
        this.mat.uniforms.decay = 1.0;
        renderer.setRenderTarget(inputAndOutputTarget);
        renderer.clear();
        renderer.render(this.scene, orthoCam);
    }
}


/**
 * Fullscreen blending (or blitting).
 */
export class Blend {
    constructor(blending = THREE.AdditiveBlending) {
        this.mat = new THREE.MeshBasicMaterial({
            map: null,
            blending: blending,
            transparent: true,
            depthTest: false,
        });
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
        this.scene = new THREE.Scene();
        this.scene.add(quad);
    }

    setBlending(blending) {
        this.mat.blending = blending;
    }

    render(renderer, texture) {
        this.mat.map = texture;
        renderer.render(this.scene, orthoCam);
    }
}

const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
