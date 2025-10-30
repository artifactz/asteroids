import * as THREE from 'three';
import { NebulaGenerator, NebulaMaterials } from '../Nebula.js'
import { PointLightPool } from '../LightPool.js';
import { UniverseParameters } from '../Parameters.js';
import { Tiles2D } from '../Types.js';

const textureLoader = new THREE.TextureLoader()
const brightStarTexture = textureLoader.load('media/bright_star.png');
brightStarTexture.colorSpace = THREE.SRGBColorSpace;


export class Universe {
    constructor(camera, lights, renderer) {
        this.nebulaGenerator = new NebulaGenerator(renderer);
        this.scene = new THREE.Scene();
        this.layers = [
            new UniverseLayer(-150, this.scene, camera, (size) => { return createPointStarMesh(size, 40, 0, 50); }),
            new UniverseLayer(-200, this.scene, camera, (size) => { return createPointStarMesh(size, 80, 0, 50, 0xffffff, 0.75); }),
            new UniverseLayer(-250, this.scene, camera, (size) => { return createPointStarMesh(size, 160, 0, 50, 0xccffff, 0.75); }),

            new UniverseLayer(-300, this.scene, camera, (size) => { return createPointStarMesh(size, 320, 0, 50, 0x99ccff, 0.5); }),
            new UniverseLayer(-300, this.scene, camera, (size) => { return createPointStarMesh(size, 25, 0, 50, 0x8888ff, 0.8); }),

            new UniverseLayer(-350, this.scene, camera, (size) => { return createPointStarMesh(size, 640, 0, 50, 0xaaffcc, 0.333); }),
            new UniverseLayer(-350, this.scene, camera, (size) => { return createPointStarMesh(size, 15, 0, 50, 0x88ff88, 0.7); }),

            new UniverseLayer(-450, this.scene, camera, (size) => { return createPointStarMesh(size, 1280, 0, 100, 0xffcccc, 0.2); }),
            new UniverseLayer(-450, this.scene, camera, (size) => { return createPointStarMesh(size, 35, 0, 100, 0xff8888, 0.5); }),

            new UniverseLayer(-500, this.scene, camera, (size) => { return createPointStarMesh(size, 500, 0, 300, 0xfff0f0, 0.55); }),

            new UniverseLayer(
                -50, this.scene, camera,
                (size) => {
                    return Math.random() < UniverseParameters.brightStarProbabilityPerTile
                        ? createBrightStarTextureMesh(size)
                        : null;
                },
                () => { return new LightRotatingUniverseTile(lights) }
            ),

            new UniverseLayer(-60, this.scene, camera, (size, tileX, tileY) => { return this.createNebulaMesh(size, tileX, tileY, 600, 0.5, 1.5, 8, 0.6, 0.5); }),
            new UniverseLayer(-130, this.scene, camera, (size, tileX, tileY) => { return this.createNebulaMesh(size, tileX, tileY, 800, 0.5, 0.5, 8, 0.6, 0.5); }),
            // new UniverseLayer(-550, this.scene, camera, (size, tileX, tileY) => { return this.createNebulaMesh(size, tileX, tileY, 900, 0.01, 0.2, 6, 1.0, 0.7, NebulaMaterials.GrayBackground); }),
        ];
    }

    update(camera) {
        for (const layer of this.layers) {
            layer.update(camera);
        }
    }

    createNebulaMesh(size, tileX, tileY, resolution = 600, brightness = 1.0, rootCellSize = 1.0, iterations = 8, details = 0.5, density = 0.5, material = NebulaMaterials.PurpleClouds) {
        const geometry = new THREE.PlaneGeometry(size, size);
        const texture = this.nebulaGenerator.getTile(tileX, tileY, resolution, brightness, rootCellSize, iterations, details, density, material);
        texture.colorSpace = THREE.SRGBColorSpace;
        const textureMaterial = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
        const mesh = new THREE.Mesh(geometry, textureMaterial);
        return mesh;
    }
}

/**
 * A layer of the universe consisting of tiles at a fixed z coordinate.
 */
export class UniverseLayer {
    /**
     * @param {number} z Z coordinate of the layer.
     * @param {THREE.Scene} scene Scene to add tiles to.
     * @param {THREE.Camera} camera Camera used to determine visible area.
     * @param {function(number, number, number):THREE.Mesh} meshFactory Function that generates a mesh for a tile of given size and coordinates.
     * @param {function():UniverseTile} tileFactory Function that generates a tile object to hold state for each tile.
     */
    constructor(z, scene, camera, meshFactory, tileFactory = () => { return new UniverseTile(); }) {
        this.z = z;
        this.scene = scene;
        this.meshFactory = meshFactory;
        this.tileFactory = tileFactory;
        const depth = -z + camera.position.z;
        this.tileSize = 2 * Math.tan(0.5 * camera.fov / 180 * Math.PI) * depth;
        this.tiles = new Tiles2D();
        this.lastVisibleTiles = null;
    }

    /**
     * @param {THREE.Camera} camera 
     * @param {number} extra Size of margin beyond visible area to add to result.
     *                       Results in tiles being generated earlier to avoid pop ins when moving fast.
     * @returns {[x0, x1, y0, y1]} Tile coordinates of visible area.
     */
    getVisibleRect(camera, extra = 0) {
        const negativeCorner = projectOnZ(new THREE.Vector3(-1, -1, 0), camera, this.z);
        const positiveCorner = projectOnZ(new THREE.Vector3(1, 1, 0), camera, this.z);
        return [
            Math.round(negativeCorner.x / this.tileSize - extra),
            Math.round(positiveCorner.x / this.tileSize + extra),
            Math.round(negativeCorner.y / this.tileSize - extra),
            Math.round(positiveCorner.y / this.tileSize + extra)
        ];
    }

    /**
     * Updates visible tiles based on camera position.
     */
    update(camera) {
        const [x0, x1, y0, y1] = this.getVisibleRect(camera, UniverseParameters.preloadSize);

        if (this.lastVisibleTiles) {
            // Disable tiles that are no longer visible
            const [lastX0, lastX1, lastY0, lastY1] = this.lastVisibleTiles;
            for (const [x, y] of Tiles2D.iterRect(lastX0, lastX1, lastY0, lastY1)) {
                if (x < x0 || x > x1 || y < y0 || y > y1) {
                    this.disableTile(x, y);
                }
            }
        }

        // Enable tiles that are now visible
        for (const [x, y] of Tiles2D.iterRect(x0, x1, y0, y1)) {
            this.enableTile(x, y);
            const tile = this.tiles.get(x, y);
            if (tile.update) { tile.update(camera); }
        }

        this.lastVisibleTiles = [x0, x1, y0, y1];
    }

    disableTile(x, y) {
        const tile = this.tiles.get(x, y);
        if (!tile || !tile.visible) { return; }
        if (tile.mesh) { this.scene.remove(tile.mesh); }
        if (tile.disable) { tile.disable(); }
        tile.visible = false;
        // console.log("Disabled tile " + x + ", " + y + " at z=" + this.z);
    }

    enableTile(x, y) {
        if (!this.tiles.has(x, y)) {
            const tile = this.tileFactory();
            this.tiles.set(x, y, tile);
            const mesh = this.meshFactory(this.tileSize, x, y);
            if (mesh) {
                mesh.position.add(new THREE.Vector3(x * this.tileSize, y * this.tileSize, this.z));
                tile.mesh = mesh;
                this.scene.add(tile.mesh);
            }
            if (tile.enable) { tile.enable(); }
        } else if (!this.tiles.get(x, y).visible) {
            const tile = this.tiles.get(x, y);
            if (tile.mesh) { this.scene.add(tile.mesh); }
            if (tile.enable) { tile.enable(); }
            tile.visible = true;
        }
    }
}

class UniverseTile {
    constructor() {
        this.mesh = null;
        this.visible = true;
    }
}

class LightRotatingUniverseTile extends UniverseTile {
    /**
     * @param {PointLightPool} lights
     */
    constructor(lights) {
        super();
        this.lights = lights;
    }

    update(camera) {
        const f = this.update;
        if (!f.vec) {
            f.vec = new THREE.Vector3();
        }

        if (this.mesh) {
            // Texture rotation
            this.mesh.rotation.z = Math.atan2(this.mesh.position.y - camera.position.y, this.mesh.position.x - camera.position.x);
            // Light intensity
            const distSq = f.vec.copy(this.mesh.position).sub(camera.position).lengthSq();  // in [3600..~25000]
            this.light.intensity = 1e6 / (0.3 * distSq);
        }
    }

    enable() {
        if (this.mesh) {
            this.light = this.lights.add({ attachMesh: this.mesh, color: 0xffffff, intensity: 100, distance: 200, decay: 1.25, tag: "bright star" });
        }
    }

    disable() {
        if (this.mesh) {
            this.lights.remove(this.light);
        }
    }
}

function createPointStarMesh(size, starCount = 2500, minZ = -350, maxZ = -90, color = 0xffffff, opacity = 1) {
    const positions = [];

    for (let i = 0; i < starCount; i++) {
        const z = minZ + Math.random() * (maxZ - minZ);
        const x = size * (Math.random() - 0.5);
        const y = size * (Math.random() - 0.5);
        positions.push(x, y, z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        color,
        opacity,
        size: 0.5,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    const stars = new THREE.Points(geometry, material);

    return stars;
}

function createBrightStarTextureMesh(size) {
    const starSize = 55;
    const geometry = new THREE.PlaneGeometry(starSize, starSize);
    const material = new THREE.MeshBasicMaterial({ map: brightStarTexture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
        -0.5 * starSize + Math.random() * (size - starSize),
        -0.5 * starSize + Math.random() * (size - starSize),
        0
    );
    return mesh;
}

function projectOnZ(vector, camera, z) {
    const ray = vector.unproject(camera).sub(camera.position);
    const t = (z - camera.position.z) / ray.z;
    return new THREE.Vector3(camera.position.x + t * ray.x, camera.position.y + t * ray.y, z);
}
