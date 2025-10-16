import * as THREE from 'three';

export const NebulaMaterials = {
    PurpleClouds: 'PurpleClouds',
    GrayBackground: 'GrayBackground',
}

export class NebulaGenerator {
    /**
     * @param {THREE.WebGLRenderer} renderer
     */
    constructor(renderer) {
        this.renderer = renderer;
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        const baseFragmentShader = `
            uniform float brightness;
            uniform float rootCellSize;
            uniform int iterations;
            uniform float density;
            uniform float details;
            uniform vec2 tileCoords;
            varying vec2 vUv;

            vec2 getPerlinVec(vec2 grid, float seed) {
                grid.x += 100.0;
                grid.y += 100.0;
                float alpha = 1.61803398874989484820459;
                float d = distance(grid, alpha * grid);
                vec2 v = vec2(fract(tan(d * seed) * grid.x) * 2.0 - 1.0, fract(tan(d * (seed + alpha)) * grid.y) * 2.0 - 1.0);
                v /= length(v);
                return v;
            }

            float perlin(vec2 xy, float cellSize, float seed) {
                int gx0 = int(floor(xy.x / cellSize));
                int gx1 = gx0 + 1;
                int gy0 = int(floor(xy.y / cellSize));
                int gy1 = gy0 + 1;

                vec2 v1 = getPerlinVec(vec2(float(gx0), float(gy0)), seed);
                vec2 v2 = getPerlinVec(vec2(float(gx1), float(gy0)), seed);
                vec2 v3 = getPerlinVec(vec2(float(gx0), float(gy1)), seed);
                vec2 v4 = getPerlinVec(vec2(float(gx1), float(gy1)), seed);

                float alphaX = (xy.x - float(gx0) * cellSize) / cellSize;
                float alphaY = (xy.y - float(gy0) * cellSize) / cellSize;

                float dot1 = dot(v1, vec2(alphaX, alphaY));
                float dot2 = dot(v2, vec2(-(1.0 - alphaX), alphaY));
                float dot3 = dot(v3, vec2(alphaX, -(1.0 - alphaY)));
                float dot4 = dot(v4, vec2(-(1.0 - alphaX), -(1.0 - alphaY)));

                // Smooth blending
                alphaX = 0.5 * sin((alphaX - 0.5) * 3.1415926) + 0.5;
                alphaY = 0.5 * sin((alphaY - 0.5) * 3.1415926) + 0.5;

                float value = (1.0 - alphaX) * (1.0 - alphaY) * dot1 +
                            alphaX * (1.0 - alphaY) * dot2 +
                            (1.0 - alphaX) * alphaY * dot3 +
                            alphaX * alphaY * dot4;
                value = clamp(value + 0.5, 0.0, 1.0);
                return value;
            }

            float combinedPerlin(vec2 xy, float cellSize, float seed) {
                float weight = 1.0;
                float weightTotal = 0.0;
                float value = 0.0;
                for (int i = 0; i < iterations; i++) {
                    value += weight * perlin(xy + tileCoords, cellSize, seed + float(i));
                    weightTotal += weight;
                    cellSize *= 0.5;
                    weight *= details;
                }
                value /= weightTotal;
                return value;
            }

            void main() {
                /* -- MAIN -- */
            }
        `;
        this.baseMaterial = new THREE.ShaderMaterial({
            uniforms: {
                brightness: { value: 1.0 },
                rootCellSize: { value: 1.0 },
                iterations: { value: 8 },
                density: { value: 0.5 },
                details: { value: 0.5 },
                tileCoords: { value: new THREE.Vector2(0, 0) },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xyz, 1.0);
                }
            `,
        });

        this.materials = {};

        this.materials[NebulaMaterials.PurpleClouds] = this.baseMaterial.clone();
        this.materials[NebulaMaterials.PurpleClouds].fragmentShader = baseFragmentShader.replace("/* -- MAIN -- */", `
            float r = combinedPerlin(vUv, rootCellSize, 4.20);
            float ra = combinedPerlin(vUv, rootCellSize * 2.0, 5.24);
            float g = combinedPerlin(vUv, rootCellSize, 2.40);
            float ga = clamp(combinedPerlin(vUv, rootCellSize * 2.0, 3.42) - 0.3333, 0.0, 1.0);
            float b = combinedPerlin(vUv, rootCellSize, 0.42);
            float ba = combinedPerlin(vUv, rootCellSize * 2.0, 0.24);
            float a = clamp(combinedPerlin(vUv, rootCellSize * 2.0, 8.42) - (1.0 - density), 0.0, 1.0);
            ra = ra * ra;
            gl_FragColor = vec4(
                brightness * a * r * ra,
                brightness * a * g * ga,
                brightness * a * b * ba,
                1.0
            );
        `);

        this.materials[NebulaMaterials.GrayBackground] = this.baseMaterial.clone();
        this.materials[NebulaMaterials.GrayBackground].fragmentShader = baseFragmentShader.replace("/* -- MAIN -- */", `
            float u = combinedPerlin(vUv, rootCellSize, 4.20);
            float v = combinedPerlin(vUv, rootCellSize, 2.40);
            float w = clamp(combinedPerlin(vUv, rootCellSize, 0.42) - (1.0 - density), 0.0, 1.0);

            gl_FragColor = vec4(
                brightness * w * u,
                brightness * w * 0.5 * (u + v),
                brightness * w * w,
                1.0
            );
        `);

        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.materials[NebulaMaterials.PurpleClouds]);
        this.scene.add(this.quad);
    }

    /**
     * Generates one 1x1 tile of combined perlin noise.
     * @param {*} x Offset
     * @param {*} y Offset
     * @param {*} resolution Resulting texture has size resolution x resolution.
     * @param {*} brightness Multiplier
     * @param {*} rootCellSize Scale of 1st layer, is halved for every consecutive layer
     * @param {*} iterations Number of noise layers
     * @param {*} details Layer weight decay
     * @param {*} density Thresholding
     * @param {*} material Shader
     * @returns 
     */
    getTile(x, y, resolution = 600, brightness = 1.0, rootCellSize = 1.0, iterations = 8, details = 0.5, density = 0.5, material = NebulaMaterials.PurpleClouds) {
        const renderTarget = new THREE.WebGLRenderTarget(resolution, resolution, { colorSpace: THREE.SRGBColorSpace, depthBuffer: false, stencilBuffer: false });
        const materialObj = this.materials[material];
        materialObj.uniforms.brightness.value = brightness;
        materialObj.uniforms.rootCellSize.value = rootCellSize;
        materialObj.uniforms.iterations.value = iterations;
        materialObj.uniforms.details.value = details;
        materialObj.uniforms.density.value = density;
        materialObj.uniforms.tileCoords.value = new THREE.Vector2(x, y);
        this.quad.material = materialObj;
        this.renderer.setRenderTarget(renderTarget);
        this.renderer.render(this.scene, this.camera);
        return renderTarget.texture;
    }
}
