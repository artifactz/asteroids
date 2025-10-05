import * as THREE from 'three';

/**
 * A pool of lights to reduce the number of shader recompilations by creating new lights in batches.
 */
export class LightPool {
    /**
     * @param {THREE.Scene} scene The scene to which lights will be added.
     * @param {number} chunkSize Number of lights to create when extending the pool.
     */
    constructor(scene, chunkSize = 26) {
        this.scene = scene;
        this.chunkSize = chunkSize;
        this.lights = [];
    }

    add({ position, attachMesh, velocity, color, intensity = 1, distance = 0, decay = 2, ttl, fadeoutTime, tag } = {}) {
        let light = this.lights.find(l => l.intensity == 0);

        if (!light) {
            console.info("Extending light pool. Shaders will recompile.");
            for (let i = 0; i < this.chunkSize; i++) {
                const newLight = new THREE.PointLight(0xffffff, 0, 10, 2);
                this.scene.add(newLight);
                this.lights.push(newLight);
            }
            light = this.lights[this.lights.length - this.chunkSize];
        }

        if (position) { light.position.copy(position); }
        light.color.set(color);
        light.intensity = intensity;
        light.distance = distance;
        light.decay = decay;
        light.userData = { velocity, ttl, fadeoutTime, attachMesh, tag };
        return light;
    }

    remove(light) {
        light.intensity = 0;
    }

    update(dt) {
        for (const light of this.lights) {
            if (light.intensity == 0) { continue; }

            if (light.userData.attachMesh) {
                light.position.copy(light.userData.attachMesh.position);
            } else if (light.userData.velocity) {
                light.position.addScaledVector(light.userData.velocity, dt);
            }

            if (light.userData.ttl) { light.userData.ttl -= dt; }
            if (light.userData.ttl || light.userData.fadeoutTime) {
                if (light.userData.ttl < light.userData.fadeoutTime) {
                    if (!light.userData.originalIntensity) { light.userData.originalIntensity = light.intensity; }
                    light.intensity = light.userData.originalIntensity * Math.max(0, light.userData.ttl / light.userData.fadeoutTime);
                }
            }

            if (light.userData.ttl !== undefined && light.userData.ttl <= 0) { this.remove(light); }
        }
    }
}
