import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { World } from './World.js';
import { Tiles2D } from '../Types.js';
import { StationParameters } from '../Parameters.js';


const suspendSpawnRadiusSq = StationParameters.suspendSpawnRadius * StationParameters.suspendSpawnRadius;

export class Stations {
    constructor(gridResolution = StationParameters.gridResolution) {
        this.resolution = gridResolution;
        this.tiles = new Tiles2D();
        this.scene = new THREE.Scene();
        this.vec2 = new THREE.Vector2();
    }

    /**
     * Spawns stations as needed based on player position and updates existing stations.
     * @param {World} world
     * @param {number} dt
     */
    update(world, dt) {
        const [x, y] = this.#tileIndex(world.player.position);

        if (this.tiles.has(x, y)) {
            const station = this.tiles.get(x, y);
            station.update(world, dt);

        } else {
            const positionX = x * this.resolution + 0.5 * (Math.random() - 0.5) * this.resolution;
            const positionY = y * this.resolution + 0.5 * (Math.random() - 0.5) * this.resolution;
            this.vec2.x = positionX - world.player.position.x;
            this.vec2.y = positionY - world.player.position.y;
            if (this.vec2.lengthSq() > suspendSpawnRadiusSq) {
                // console.log(`Creating station at tile ${x}, ${y}`);
                const station = new Station(positionX, positionY);
                this.tiles.set(x, y, station);
                this.scene.add(station.scene);
            }
        }
    }

    /**
     * @param {THREE.Vector2} point
     * @returns {Station} The closest station to the given point.
     */
    closest(point) {
        const [pX, pY] = this.#tileIndex(point);
        const stations = [...Tiles2D.iterRect(pX - 1, pX + 1, pY - 1, pY + 1)]
            .map(([x, y]) => this.tiles.get(x, y))
            .filter((station) => !!station);
        if (stations.length === 0) {
            console.log('No stations found near point', point);
        }
        this.closest.vec2 = this.closest.vec2 || new THREE.Vector2();
        let closestDistanceSq = Infinity;
        let closestStation = null;
        for (const station of stations) {
            this.closest.vec2.x = station.scene.position.x - point.x;
            this.closest.vec2.y = station.scene.position.y - point.y;
            const distanceSq = this.closest.vec2.lengthSq();
            if (distanceSq < closestDistanceSq) {
                closestDistanceSq = distanceSq;
                closestStation = station;
            }
        }
        return closestStation;
    }

    empty() {
        return this.tiles.tiles.length === 0;
    }

    #tileIndex(position) {
        return [Math.round(position.x / this.resolution), Math.round(position.y / this.resolution)];
    }
}

export class Station {

    static modelScene = null;
    static loader = new GLTFLoader();
    static {
        this.loader.load("media/spacestation.glb", (gltf) => {
            gltf.scene.scale.set(0.5, 0.5, 0.5);
            this.modelScene = new THREE.Scene();
            this.modelScene.add(gltf.scene);
        });
    }

    planeMat = new THREE.MeshBasicMaterial({ color: 0xff0000, opacity: 0.1, transparent: true, depthWrite: false });

    shieldMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
            uColor: { value: new THREE.Color(0x66ccff) },
            uTime: { value: 0.0 }
        },
        vertexShader: `
            varying vec3 vNormalView;
            varying vec3 vNormal;
            void main() {
                // transform normal to view space
                vNormalView = normalize(normalMatrix * normal);
                vNormal = normal;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uTime;
            varying vec3 vNormalView;
            varying vec3 vNormal;

            void main() {
                float s = (vNormalView.z > 0.0)
                    ? max(0.0, 1.0 - vNormalView.z - 0.75) * 4.0     // less shield in the front
                    : max(0.0, 1.0 + vNormalView.z - 0.25) * 1.333;  // more shield in the back
                float baseAlpha = 0.05 * smoothstep(0.0, 1.0, s);

                float wavePulse = 0.5
                                + 0.05 * sin(120.0 * vNormalView.x + 1.5 * uTime)
                                + 0.1 * sin(35.77 * vNormalView.x + 1.9 * uTime)
                                + 0.15 * sin(11.11 * vNormalView.x + 2.11 * uTime)
                                + 0.05 * sin(64.0 * vNormalView.y + 2.3 * uTime)
                                + 0.05 * sin(64.0 * vNormalView.y + 128.0 * cos(2.0 * vNormalView.y + 1.23) + 2.3 * uTime)
                                + 0.1 * sin(28.91 * vNormalView.y + 2.72 * uTime)
                                + 0.15 * sin(13.37 * vNormalView.y + 3.1 * uTime);

                float alpha = clamp(baseAlpha * wavePulse, 0.0, 1.0);

                if (alpha < 1e-6) { discard; }
                gl_FragColor = vec4(uColor, alpha);
            }
        `
        });

    /**
     * @param {THREE.Vector2} position
     * @param {boolean} showObbs
     */
    constructor(x, y, showObbs = false) {
        this.rotation = Math.random() * 2 * Math.PI;
        this.shieldRadius = 13;

        this.scene = Station.modelScene.clone();
        this.scene.rotation.z = this.rotation;
        this.scene.position.set(x, y, 0);

        this.shieldSphere = new THREE.Mesh(
            new THREE.IcosahedronGeometry(this.shieldRadius, 7),
            this.shieldMat
        );
        this.shieldSphere.position.set(0, 1.5, 0);
        this.scene.add(this.shieldSphere);

        this.showObbs = showObbs;

        this.obbPlanes = [];
        this.#addPlane(-4.5, 0, 7, 5, 0); // right
        this.#addPlane(4.5, 0, 6.5, 6.5, 0); // left
        this.#addPlane(0, 5.85, 5.25, 10.5, 0); // bottom
        this.#addPlane(0, -4.65, 9.6, 3.75, 0); // inner top
        this.#addPlane(0, -4.8, 7, 7.5, 0); // outer top

        this.obbs = this.obbPlanes.map(plane => OrientedBoundingBox.fromPlane(plane));
    }

    #addPlane(x, y, w, h, r) {
        const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(w, h),
            this.planeMat
        );
        plane.position.set(x, y, 0);
        plane.rotation.z = r;
        plane.visible = this.showObbs;
        this.obbPlanes.push(plane);
        this.scene.add(plane);
    }

    /**
     * @param {World} world
     * @param {number} dt
     */
    update(world, dt) {
        this.shieldMat.uniforms.uTime.value += dt;

        this.update.vec2 = this.update.vec2 || new THREE.Vector2();
        this.update.vec3 = this.update.vec3 || new THREE.Vector3();

        for (const obb of this.obbs) {
            const check = obb.intersects(this.update.vec2.set(world.player.position.x, world.player.position.y));
            if (check.inside) {
                const repel = this.update.vec3.set(check.repel.x, check.repel.y, 0).multiplyScalar(Math.sqrt(check.repel.length()));
                world.player.position.addScaledVector(repel, 10 * dt);
                world.player.userData.speed *= Math.pow(0.667, dt);
            }
        }

        for (const asteroid of world.asteroids) {
            const toAsteroid = this.shieldSphere.getWorldPosition(this.update.vec3).multiplyScalar(-1).add(asteroid.position);
            const halfRadius = 0.25 * asteroid.userData.diameter;
            if (toAsteroid.length() - halfRadius < this.shieldRadius) {
                toAsteroid.normalize().multiplyScalar(StationParameters.asteroidRepelForce * dt);
                if (asteroid.userData.behavior) {
                    asteroid.userData.behavior.suspended = true;
                }
                world.physics.applyImpulse(asteroid, toAsteroid);
            }
        }
    }
}

/**
 * A 2D oriented bounding box to push away the player from the space station.
 */
export class OrientedBoundingBox {
    /**
     * @param {THREE.Vector2} center
     * @param {THREE.Vector2} halfSizes
     * @param {number} rotation
     */
    constructor(center, halfSizes, rotation) {
        this.center = center;
        this.halfSizes = halfSizes;
        this.rotation = rotation;
        this.axes = [
            new THREE.Vector2(Math.cos(rotation), Math.sin(rotation)),
            new THREE.Vector2(-Math.sin(rotation), Math.cos(rotation))
        ];
    }

    /**
     * Convenience method to create an OBB from a plane mesh.
     * @param {THREE.Mesh} mesh
     * @returns {OrientedBoundingBox}
     */
    static fromPlane(mesh) {
        const position = new THREE.Vector3();
        mesh.getWorldPosition(position);
        const quaternion = new THREE.Quaternion();
        mesh.getWorldQuaternion(quaternion);
        const halfSizes = new THREE.Vector2(mesh.geometry.parameters.width / 2, mesh.geometry.parameters.height / 2);
        return new OrientedBoundingBox(
            new THREE.Vector2(position.x, position.y),
            halfSizes,
            new THREE.Euler().setFromQuaternion(quaternion).z
        );
    }

    /**
     * Checks if a point is inside the OBB, and if so, computes a repel vector.
     * @param {THREE.Vector2} point
     * @returns {object} An object with boolean 'inside' and Vector2 'repel' pointing outward.
     */
    intersects(point) {
        const dir = new THREE.Vector2().subVectors(point, this.center);
        let overlap = Infinity;
        let repel = new THREE.Vector2();
        for (let i = 0; i < 2; i++) {
            const axis = this.axes[i];
            const proj = dir.dot(axis);
            const size = this.halfSizes.getComponent(i);
            const o = size - Math.abs(proj);
            if (o < 0) { return { inside: false, repel: null }; }
            if (o < overlap) {
                overlap = o;
                repel.copy(axis).multiplyScalar(proj < 0 ? -overlap : overlap);
            }
        }
        return { inside: true, repel };
    }
}
