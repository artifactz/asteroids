import * as THREE from 'three';
import { TrailParameters } from '../Parameters.js';

/**
 * Generates the geometry of the player's thruster trail and updates it each frame.
 */
export class Trail {
    constructor(scene, player, particles) {
        this.scene = scene;
        this.player = player;
        this.particles = particles;

        this.baseAlpha = TrailParameters.baseAlpha;
        this.thrustAlpha = TrailParameters.thrustAlpha;

        this.geometry = new THREE.BufferGeometry();
        this.material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                thrust: { value: 0 },
                baseAlpha: { value: this.baseAlpha },
                thrustAlpha: { value: this.thrustAlpha },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                uniform float thrust;
                uniform float baseAlpha;
                uniform float thrustAlpha;

                void main() {
                    vec3 white = vec3(1.0, 1.0, 0.9);
                    vec3 blue = vec3(0.212, 0.706, 1.0);
                    float spinal = 1.0 - 2.0 * abs(0.5 - vUv.y);
                    float spinalSq = spinal * spinal;
                    float whiteness = thrust * vUv.x;
                    vec3 inColor = mix(blue, white, whiteness);
                    vec3 color = mix(blue, inColor, spinalSq);

                    float a = clamp(
                        (baseAlpha + thrustAlpha * whiteness) / (baseAlpha + thrustAlpha) * spinalSq * vUv.x * vUv.x * vUv.x,
                        0.0, 1.0
                    );

                    gl_FragColor = vec4(color.r, color.g, color.b, a);
                }
            `
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.scene.add(this.mesh);

        this.light = new THREE.PointLight(0x88d2ff, 1, 10, 1.5);
        this.scene.add(this.light);

        this.smoothRotSpeed = 0;
        this.smoothThrust = 0;
        this.noisySmoothThrust = 0;
        this.smoothBurst = 0;
        this.isPlayerAlive = true;
        this.deathSegments = null;
    }

    /**
     * Performs an update step.
     */
    update(time, dt) {
        this.updateState(time, dt);
        this.updateGeometry(dt);
        this.updateMaterial();
        this.updateLight(dt);
        this.spawnParticles(dt);
    }

    /**
     * Updates values such as thrust, burst, and rotation speed.
     */
    updateState(time, dt) {
        const oldThrust = this.smoothThrust;
        const newThrust = this.player.userData.thrustOverride || (this.player.userData.accel / this.player.userData.maxAccel);
        if (newThrust > oldThrust) {
            let thrustDiff = Math.min(newThrust - oldThrust, TrailParameters.thrustActivationAttack * dt);
            this.smoothThrust = Math.min(1, oldThrust + thrustDiff);
        } else if (newThrust < oldThrust) {
            const tDecay = Math.pow(TrailParameters.thrustActivationDecay, dt);
            this.smoothThrust = oldThrust * tDecay;
        }

        const bDecay = Math.pow(TrailParameters.burstActivationDecay, dt);
        this.smoothBurst = Math.max(this.smoothBurst * bDecay, newThrust - oldThrust);

        const w1 = 0.02, w2 = 0.03;
        const w3 = 0.5 * Math.min(this.smoothBurst, 0.3);
        const w4 = 0.5 * Math.min(this.smoothBurst * 0.5, 0.3);
        const w5 = 0.667 * Math.min(this.smoothBurst * 1.5, 0.25);
        const noise = w1 * Math.sin(23 * time) - w1 +
                      w2 * Math.sin(101 * time) - w2 +
                      w3 * Math.sin(11 * time) - w3 +
                      w4 * Math.sin(39 * time) - w4 +
                      w5 * Math.sin(57 * time) - w5;
        this.noisySmoothThrust = Math.max(0, Math.min(1, this.smoothThrust + noise));
        // console.log(this.smoothBurst);

        // Fade out on death
        if (!this.player.userData.isAlive) {
            this.baseAlpha = Math.max(0, this.baseAlpha + TrailParameters.deathAlphaDelta * dt);
            this.thrustAlpha = Math.max(0, this.thrustAlpha + TrailParameters.deathAlphaDelta * dt);
        }

        const t = Math.pow(0.01, dt);
        this.smoothRotSpeed = t * this.smoothRotSpeed + (1 - t) * this.player.userData.rotationalVelocity.z;
    }

    /**
     * Generates the trail geometry and sets it pose in the world.
     */
    updateGeometry(dt) {
        const positions = [];
        const uvs = [];

        let segments = 8 + Math.floor(6 * this.player.userData.speed + 10 * this.noisySmoothThrust);;

        // Fade out on death
        if (!this.player.userData.isAlive) {
            this.deathSegments = (this.deathSegments)
                ? this.deathSegments * Math.pow(TrailParameters.deathSegmentsDecay, dt)
                : segments;
            segments = Math.round(this.deathSegments);
        }

        let basePoint = new THREE.Vector3(-0.3, 0, 0.05);
        let baseAngle = Math.PI;
        let orthoAngle = 0.5 * Math.PI;
        let a, b, c, d; // corners

        for (let i = 0; i < segments; i++) {
            const step = new THREE.Vector3(Math.cos(baseAngle), Math.sin(baseAngle), 0);
            const nextPoint = basePoint.clone().addScaledVector(step, TrailParameters.stepSize);
            const sideStep = new THREE.Vector3(Math.cos(orthoAngle), Math.sin(orthoAngle), 0);
            const s = i / segments, t = (i + 1) / segments;
            const width1 = (1 - s) * TrailParameters.baseWidth;
            const width2 = (1 - t) * TrailParameters.baseWidth;

            a = d || new THREE.Vector3(basePoint.x - sideStep.x * width1, basePoint.y - sideStep.y * width1, basePoint.z);
            b = c || new THREE.Vector3(basePoint.x + sideStep.x * width1, basePoint.y + sideStep.y * width1, basePoint.z);
            c = new THREE.Vector3(nextPoint.x + sideStep.x * width2, nextPoint.y + sideStep.y * width2, nextPoint.z);
            d = new THREE.Vector3(nextPoint.x - sideStep.x * width2, nextPoint.y - sideStep.y * width2, nextPoint.z);

            positions.push(
                a.x, a.y, a.z,    b.x, b.y, b.z,    d.x, d.y, d.z,
                b.x, b.y, b.z,    c.x, c.y, c.z,    d.x, d.y, d.z,
            );
            uvs.push(
                1 - s, 0,    1 - s, 1,    1 - t, 0,
                1 - s, 1,    1 - t, 1,    1 - t, 0
            );

            basePoint = nextPoint;
            const angleDelta = Math.exp(-(4 + 0.1 * this.player.userData.speed)) * this.smoothRotSpeed;
            baseAngle -= angleDelta;
            orthoAngle -= angleDelta;
        }
        this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        this.geometry.computeVertexNormals();
        this.geometry.computeBoundingBox();
        this.geometry.computeBoundingSphere();

        this.mesh.position.copy(this.player.position);
        this.mesh.rotation.copy(this.player.rotation);
    }

    updateMaterial() {
        this.material.uniforms.thrust.value = this.noisySmoothThrust;
        this.material.uniforms.baseAlpha.value = this.baseAlpha;
        this.material.uniforms.thrustAlpha.value = this.thrustAlpha;
    }

    updateLight(dt) {
        this.light.position.set(
            this.player.position.x - 0.9 * Math.cos(this.player.rotation.z),
            this.player.position.y - 0.9 * Math.sin(this.player.rotation.z),
            0.1
        );
        if (this.player.userData.isAlive) {
            this.light.intensity = 3 * this.smoothThrust;
        } else {
            this.light.intensity = Math.max(0, this.light.intensity + TrailParameters.deathLightIntensityDelta * dt)
            if (this.isPlayerAlive) {
                this.light.intensity = TrailParameters.deathLightIntensity;
            }
        }
        this.isPlayerAlive = this.player.userData.isAlive;
    }

    spawnParticles(dt) {
        if (!this.player.userData.isAlive) { return; }

        const forward = new THREE.Vector3(Math.cos(this.player.rotation.z), Math.sin(this.player.rotation.z), 0).normalize();
        const side = new THREE.Vector3(-forward.y, forward.x, 0).normalize();
        const vel = this.getParticleVelocity();

        const num = Math.floor((2 * 450 * this.smoothBurst + 2 * 60 * this.noisySmoothThrust) * dt + Math.random());
        const positions = [], velocities = [];
        for (let i = 0; i < num; i++) {
            const lateral = side.clone().multiplyScalar(0.2 * (Math.random() - 0.5));
            const longitudal = forward.clone().multiplyScalar(0.4 * (Math.random() - 0.5));
            positions.push(
                this.player.position.x + lateral.x + longitudal.x,
                this.player.position.y + lateral.y + longitudal.y,
                this.player.position.z
            );
            velocities.push(
                vel.x + (1.1 + 2.0 * this.smoothBurst) * lateral.x,
                vel.y + (1.1 + 2.0 * this.smoothBurst) * lateral.y,
                Math.random()
            );
        }

        if (num) {
            const blue = new THREE.Color(0x36b4ff);
            const lightBlue = new THREE.Color(0x88d2ff);
            this.particles.addColorParticleChunk(
                positions, velocities,
                0.5, 1, 0, 0.5, blue.lerp(lightBlue, Math.random()), THREE.AdditiveBlending, 0.03
            );
            // console.log(`${num} particles spawned (thrust: ${this.noisySmoothThrust.toFixed(2)}, burst: ${this.smoothBurst.toFixed(2)})`);
        }
    }

    getParticleVelocity() {
        const speed = 7;
        const velocity = new THREE.Vector3(
            -speed * Math.cos(this.player.rotation.z),
            -speed * Math.sin(this.player.rotation.z),
            0
        ).add(this.player.userData.velocity);
        return velocity;
    }
}
