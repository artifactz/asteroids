import * as THREE from 'three';
import { NebulaGenerator, NebulaMaterials } from '../Nebula.js'

const textureLoader = new THREE.TextureLoader()
const brightStarTexture = textureLoader.load('media/bright_star.png');
brightStarTexture.colorSpace = THREE.SRGBColorSpace;


export class Universe {
    constructor(scene, camera, renderer) {
        this.nebulaGenerator = new NebulaGenerator(renderer);
        this.layers = [
            new UniverseLayer(-150, scene, camera, (size) => { return createPointStarMesh(size, 40, 0, 50); }),
            new UniverseLayer(-200, scene, camera, (size) => { return createPointStarMesh(size, 80, 0, 50, 0xffffff, 0.75); }),
            new UniverseLayer(-250, scene, camera, (size) => { return createPointStarMesh(size, 160, 0, 50, 0xccffff, 0.75); }),

            new UniverseLayer(-300, scene, camera, (size) => { return createPointStarMesh(size, 320, 0, 50, 0x99ccff, 0.5); }),
            new UniverseLayer(-300, scene, camera, (size) => { return createPointStarMesh(size, 25, 0, 50, 0x8888ff, 0.8); }),

            new UniverseLayer(-350, scene, camera, (size) => { return createPointStarMesh(size, 640, 0, 50, 0xaaffcc, 0.333); }),
            new UniverseLayer(-350, scene, camera, (size) => { return createPointStarMesh(size, 15, 0, 50, 0x88ff88, 0.7); }),

            new UniverseLayer(-450, scene, camera, (size) => { return createPointStarMesh(size, 1280, 0, 100, 0xffcccc, 0.2); }),
            new UniverseLayer(-450, scene, camera, (size) => { return createPointStarMesh(size, 35, 0, 100, 0xff8888, 0.5); }),

            new UniverseLayer(-500, scene, camera, (size) => { return createPointStarMesh(size, 500, 0, 300, 0xfff0f0, 0.55); }),

            new UniverseLayer(-50, scene, camera, (size) => { return Math.random() < 0.5 ? createBrightStarTextureMesh(size) : null; }, RotatingUniverseTile),

            new UniverseLayer(-60, scene, camera, (size, tileX, tileY) => { return this.createNebulaMesh(size, tileX, tileY, 600, 0.5, 1.5, 8, 0.6, 0.5); }),
            new UniverseLayer(-130, scene, camera, (size, tileX, tileY) => { return this.createNebulaMesh(size, tileX, tileY, 800, 0.5, 0.5, 8, 0.6, 0.5); }),
            // new UniverseLayer(-550, scene, camera, (size, tileX, tileY) => { return this.createNebulaMesh(size, tileX, tileY, 900, 0.01, 0.2, 6, 1.0, 0.7, NebulaMaterials.GrayBackground); }),
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
        console.log("Created texture");
        const textureMaterial = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
        const mesh = new THREE.Mesh(geometry, textureMaterial);
        return mesh;
    }
}

export class UniverseLayer {
    /**
     * 
     * @param {number} z
     * @param {THREE.Camera} camera 
     */
    constructor(z, scene, camera, meshGenerator, tileType = UniverseTile) {
        this.z = z;
        this.scene = scene;
        this.meshGenerator = meshGenerator;
        this.tileType = tileType;
        const depth = -z + camera.position.z;
        this.tileSize = 2 * Math.tan(0.5 * camera.fov / 180 * Math.PI) * depth;
        this.tiles = new Map();
    }

    getVisibleTiles(camera) {
        const bottomLeft = projectOnZ(new THREE.Vector3(-1, -1, 0), camera, this.z);
        const topRight = projectOnZ(new THREE.Vector3(1, 1, 0), camera, this.z);
        return [
            Math.round(bottomLeft.x / this.tileSize),
            Math.round(topRight.x / this.tileSize),
            Math.round(bottomLeft.y / this.tileSize),
            Math.round(topRight.y / this.tileSize)
        ];
    }

    update(camera) {
        const [left, right, bottom, top] = this.getVisibleTiles(camera);
        for (let col = left - 1; col <= right + 1; col++) {
            this.disableTile((bottom - 1), col);
            this.disableTile((top + 1, col));
        }
        for (let row = bottom; row <= top; row++) {
            this.disableTile(row, (left - 1));
            this.disableTile(row, (right + 1));
        }

        for (let col = left; col < right + 1; col++) {
            for (let row = bottom; row < top + 1; row++) {
                this.enableTile(row, col);
                const tile = this.tiles.get(row + "," + col);
                if (tile.update) { tile.update(camera); }
            }
        }
    }

    disableTile(row, col) {
        const id = row + "," + col;
        const tile = this.tiles.get(id);
        if (!tile || !tile.visible) { return; }
        if (tile.mesh) { this.scene.remove(tile.mesh); }
        tile.visible = false;
        // console.log("Disabled tile " + id + " at z=" + this.z);
    }

    enableTile(row, col) {
        const id = row + "," + col;
        if (!this.tiles.has(id)) {
            // if (row != 0 || col != 0) { return; } // DEBUG
            // console.log("Generating tile " + id + " at z=" + this.z);
            const mesh = this.meshGenerator(this.tileSize, col, row);
            if (mesh) { mesh.position.add(new THREE.Vector3(col * this.tileSize, row * this.tileSize, this.z)); }
            // const tile = { mesh, visible: true };
            const tile = new this.tileType(mesh);
            this.tiles.set(id, tile);
            if (tile.mesh) { this.scene.add(tile.mesh); }
        } else if (!this.tiles.get(id).visible) {
            const tile = this.tiles.get(id);
            tile.visible = true;
            if (tile.mesh) { this.scene.add(tile.mesh); }
        }
    }
}

class UniverseTile {
    constructor(mesh) {
        this.mesh = mesh;
        this.visible = true;
    }
}

class RotatingUniverseTile extends UniverseTile {
    update(camera) {
        if (this.mesh) {
            this.mesh.rotation.z = Math.atan2(this.mesh.position.y - camera.position.y, this.mesh.position.x - camera.position.x);
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
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    group.add(new THREE.PointLight(0xffffff, 100, 200, 1.25));
    group.position.set(
        -0.5 * starSize + Math.random() * (size - starSize),
        -0.5 * starSize + Math.random() * (size - starSize),
        0
    );
    return group;
}

function projectOnZ(vector, camera, z) {
    const ray = vector.unproject(camera).sub(camera.position);
    const t = (z - camera.position.z) / ray.z;
    return new THREE.Vector3(camera.position.x + t * ray.x, camera.position.y + t * ray.y, z);
}
