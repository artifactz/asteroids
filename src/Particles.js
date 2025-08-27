import * as THREE from 'three';
import { SurfaceSampler, iteratePoints, pointToLineDistanceSquared } from './GeometryUtils.js';


/**
 * Particle system for rendering effects like smoke, sparks, and debris.
 */
export class ParticleSystem {
    /**
     * @param {THREE.Scene} scene 
     * @param {THREE.Camera} camera 
     * @param {THREE.DepthTexture} depthTexture  Particles are rendered separately, so we do z culling manually.
     */
    constructor(scene, camera, depthTexture) {
        this.scene = scene;
        this.cameraNear = camera.near;
        this.cameraFar = camera.far;
        this.depthTexture = depthTexture;

        this.pointMaterialVertexShader = `
            uniform float size;
            void main() {
                vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
                gl_PointSize = size * ( 500.0 / -mvPosition.z );
                gl_Position = projectionMatrix * mvPosition;
            }
        `;
        this.texturedPointMaterialFragmentShader = `
            uniform sampler2D tMap;
            uniform sampler2D tDepth;
            uniform float opacity;
            uniform float cameraNear;
            uniform float cameraFar;
            uniform vec2 resolution;

            void main() {
                vec2 uv = gl_FragCoord.xy / resolution;
                float depth = texture2D(tDepth, uv).r;
                if (gl_FragCoord.z > depth) {
                    discard;
                }

                vec4 particleColor = texture2D(tMap, gl_PointCoord);
                particleColor.a *= opacity;
                gl_FragColor = vec4(
                    particleColor.rgb + ((1.0 - particleColor.a) * gl_FragColor.rgb),
                    particleColor.a + (1.0 - particleColor.a) * gl_FragColor.a
                );
            }
        `;
        // TODO add additive blending capability (e.g. for sparks)
        this.coloredPointMaterialFragmentShader = `
            uniform vec3 color;
            uniform sampler2D tDepth;
            uniform float opacity;
            uniform float cameraNear;
            uniform float cameraFar;
            uniform vec2 resolution;

            void main() {
                vec2 uv = gl_FragCoord.xy / resolution;
                float depth = texture2D(tDepth, uv).r;
                if (gl_FragCoord.z > depth) {
                    discard;
                }

                vec4 particleColor = vec4(color, 1.0);
                particleColor.a *= opacity;
                gl_FragColor = vec4(
                    particleColor.rgb + ((1.0 - particleColor.a) * gl_FragColor.rgb),
                    particleColor.a + (1.0 - particleColor.a) * gl_FragColor.a
                );
            }
        `;

        this.particleChunks = [];
        this.lights = [];

        const textureLoader = new THREE.TextureLoader()
        textureLoader.load('media/smoke.png', (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            this.smokeTexture = createColorAlphaTexture(texture, 76, 76, 76);
        });
    }

    handleDefaultImpact(impact, asteroid, divertAngle = 0.3 * Math.PI, minLifetime = 0.333, maxLifetime = 1.0, minFadeoutRatio = 0.333, maxFadeoutRatio = 1.0) {
        // Sparks
        const reflection = reflect(impact.normal, impact.velocity);
        const noisyReflection = randomWiggleVector3(reflection, divertAngle);
        const sparkVelocities = [];
        for (let i = 0; i < 10; i++) {
            const lifetime = minLifetime + (maxLifetime - minLifetime) * Math.abs(getBiRandom());
            const fadeoutRatio = minFadeoutRatio + (maxFadeoutRatio - minFadeoutRatio) * Math.random();
            const { positions, velocities } = generateSparks(impact.point, noisyReflection, 40);
            this.addColorParticleChunk(positions, velocities, lifetime, fadeoutRatio * lifetime, 0, 0.8, 0xffcc66, THREE.AdditiveBlending);

            const velocity = getMeanVector3FromArray(velocities);
            sparkVelocities.push(velocity.x, velocity.y, velocity.z);
        }

        // Spark light
        const meanVelocity = getMeanVector3FromArray(sparkVelocities);
        this.addLight(impact.point, meanVelocity, maxLifetime, maxLifetime - minLifetime);

        // Debris
        const objPointVel = getRotatedPointVelocity(impact.point, asteroid);
        const awayFromCenter = impact.point.clone().sub(asteroid.position).normalize();
        const generalDirection = objPointVel.add(awayFromCenter.multiplyScalar(0.2));
        const { positions, velocities } = generateImpactDebris(impact.point, generalDirection, 100, 0.2);
        this.addColorParticleChunk(positions, velocities, 3.0, 2.0, 0, 0.85, 0x555555, THREE.NormalBlending, 0.025, 1);

        // Smoke
        const smoke = generateImpactDebris(impact.point, generalDirection, 10, 0.3);
        const lifetime = 7.0 + (2 * Math.random() - 1);
        this.addTextureParticleChunk(smoke.positions, smoke.velocities, lifetime, 79.0, 0.25, 0.7, this.smokeTexture, THREE.NormalBlending, 0.25, 1);
    }

    handleDefaultSplit(impact, asteroid, splitAsteroid) {
        // Prepare spawn points
        const minPointDistance = 0.025;
        const minPlaneDistance = 0.1;

        const projectedPoints = [];
        const planeOrigin = impact.point;
        const planeNormal = new THREE.Vector3(impact.velocity.y, -impact.velocity.x, 0).normalize();  // rotate impact 90° ccw
        const pos = splitAsteroid.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const p = splitAsteroid.localToWorld(new THREE.Vector3().fromBufferAttribute(pos, i));
            const v = p.clone().sub(planeOrigin);
            const dist = v.dot(planeNormal);
            if (Math.abs(dist) > minPlaneDistance) { continue; }
            const projectedPoint = p.clone().sub(planeNormal.clone().multiplyScalar(dist));
            if (!isPointWithinDistanceOfPoints(projectedPoint, projectedPoints, minPointDistance)) {
                projectedPoints.push(projectedPoint);
            }
        }

        if (projectedPoints.length == 0) {
            // TODO: splitAsteroid might have moved too far away from impact point at this time. maybe solve when adding smoke spawners.
            console.log("Skipping split particles.");
            return;
        }

        // Smoke
        const numSmokeParticles = Math.ceil(25 * asteroid.userData.diameter);
        const smokeBaseVelocity = asteroid.userData.velocity.clone().multiplyScalar(0.9);
        let { positions, velocities } = generateSplitDebris(projectedPoints, smokeBaseVelocity, impact, numSmokeParticles, 0.1, 0.14, 0.02);
        const smokeLifetime = 7.0 + (2 * Math.random() - 1);
        this.addTextureParticleChunk(positions, velocities, smokeLifetime, 70.0, 0.3, 1, this.smokeTexture, THREE.NormalBlending, 0.25, 1);

        // Slow debris
        const numDebrisParticles = Math.ceil(64 * asteroid.userData.diameter * asteroid.userData.diameter);
        ({ positions, velocities } = generateSplitDebris(projectedPoints, asteroid.userData.velocity, impact, numDebrisParticles, 0.25, 0.1, 0.05));
        const slowDebrisLifetime = 3.5 + Math.random();
        this.addColorParticleChunk(positions, velocities, slowDebrisLifetime, 3.0, 0, 0.9, 0x555555, THREE.NormalBlending, 0.025, 1);

        // Fast debris
        ({ positions, velocities } = generateSplitDebris(projectedPoints, asteroid.userData.velocity, impact, numDebrisParticles, 0.5, 0.01, 0.2));
        const fastDebrisLifetime = 1.0 + 0.5 * Math.random();
        this.addColorParticleChunk(positions, velocities, fastDebrisLifetime, 1.0, 0, 1, 0x555555, THREE.NormalBlending, 0.025, 1);
    }

    handleDefaultBreakdown(asteroid) {
        const surfaceSampler = new SurfaceSampler(asteroid.geometry);

        // Debris
        const numChunks = Math.ceil(15 * asteroid.userData.diameter); // TODO volume instead diameter?
        const chunkSize = Math.ceil(15 * asteroid.userData.diameter);
        for (let i = 0; i < numChunks; i++) {
            const debrisPositions = [];
            const debrisVelocities = [];
            for (let j = 0; j < chunkSize; j++) {
                const point = asteroid.localToWorld(surfaceSampler.getRandomPoint());
                debrisPositions.push(point.x, point.y, point.z);
                const vel = getRotatedPointVelocity(point, asteroid);

                // Close particles get dragged by laser
                const dist = pointToLineDistanceSquared(point, asteroid.userData.recentImpact.point, asteroid.userData.recentImpact.velocity);
                const laserWeight = 0.03 * Math.exp(-100 * dist);
                vel.addScaledVector(asteroid.userData.recentImpact.velocity, laserWeight);

                debrisVelocities.push(vel.x, vel.y, vel.z);
            }
            const debrisLifetime = 4.0 + (1 * Math.random() - 0.5);
            this.addColorParticleChunk(debrisPositions, debrisVelocities, debrisLifetime, 3.0, 0, 1, 0x555555, THREE.NormalBlending, 0.025, 1);
        }

        // Smoke
        const numSmokeParticles = Math.ceil(25 * asteroid.userData.diameter);
        const smokePositions = [];
        const smokeVelocities = [];
        for (let j = 0; j < numSmokeParticles; j++) {
            const point = asteroid.localToWorld(surfaceSampler.getRandomPoint());
            smokePositions.push(point.x, point.y, point.z);
            const vel = getRotatedPointVelocity(point, asteroid);
            smokeVelocities.push(vel.x, vel.y, vel.z);
        }

        const smokeLifetime = 5.0 + (2 * Math.random() - 1);
        this.addTextureParticleChunk(smokePositions, smokeVelocities, smokeLifetime, 80.0, 0.4, 0.8, this.smokeTexture, THREE.NormalBlending, 0.8, 1);
    }

    handlePlayerBreakdown(player, debrisRandomness = 0.3, smokeRandomness = 0.7) {
        const numChunks = 15;
        const chunkSize = 15;
        const points = Array.from(iteratePoints(player)).map((point) => {
            point.applyEuler(player.rotation);
            point.multiply(player.scale);
            point.add(player.position);
            return point;
        });
        shuffleArray(points);
        var pointIndex = 0;

        for (let i = 0; i < numChunks; i++) {
            const positions = [];
            const velocities = [];
            for (let j = 0; j < chunkSize; j++) {
                positions.push(points[pointIndex].x, points[pointIndex].y, points[pointIndex].z);
                velocities.push(
                    player.userData.velocity.x + debrisRandomness * 2 * (Math.random() - 0.5),
                    player.userData.velocity.y + debrisRandomness * 2 * (Math.random() - 0.5),
                    player.userData.velocity.z + debrisRandomness * 2 * (Math.random() - 0.5)
                );
                pointIndex = (pointIndex + 1) % points.length;
            }
            const debrisLifetime = 4.0 + 2.0 * (Math.random() - 0.5);
            this.addColorParticleChunk(positions, velocities, debrisLifetime, 3.0, 0.01, 1, 0x555555, THREE.NormalBlending, 0.025, 1);

            for (let j = 0; j < chunkSize; j++) {
                velocities[j * 3] += smokeRandomness * 2 * (Math.random() - 0.5);
                velocities[j * 3 + 1] += smokeRandomness * 2 * (Math.random() - 0.5);
                velocities[j * 3 + 2] += smokeRandomness * 2 * (Math.random() - 0.5);
            }
            const smokeLifetime = 5.0 + 3.0 * (Math.random() - 0.5);
            this.addTextureParticleChunk(positions, velocities, smokeLifetime, 80.0, 0.4, 1, this.smokeTexture, THREE.NormalBlending, 0.8, 1);
        }
    }

    addColorParticleChunk(positions, velocities, lifetime, fadeoutTime, growthRate, velocityDecay, color, blending = THREE.AdditiveBlending, size = 0.025, layer = 0) {
        const material = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(color) },
                tDepth: { value: this.depthTexture },
                cameraNear: { value: this.cameraNear },
                cameraFar: { value: this.cameraFar },
                resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                size: { value: size },
                opacity: { value: 1 },
            },
            vertexShader: this.pointMaterialVertexShader,
            fragmentShader: this.coloredPointMaterialFragmentShader,
            blending: blending,
            transparent: true,
            depthWrite: false,
        });

        this.addParticleChunk(positions, velocities, lifetime, fadeoutTime, growthRate, velocityDecay, material, layer);
    }

    addTextureParticleChunk(positions, velocities, lifetime, fadeoutTime, growthRate, velocityDecay, texture, blending = THREE.NormalBlending, size = 0.25, layer = 0) {
        const material = new THREE.ShaderMaterial({
            uniforms: {
                tMap: { value: texture },
                tDepth: { value: this.depthTexture },
                cameraNear: { value: this.cameraNear },
                cameraFar: { value: this.cameraFar },
                resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                size: { value: size },
                opacity: { value: 1 },
            },
            vertexShader: this.pointMaterialVertexShader,
            fragmentShader: this.texturedPointMaterialFragmentShader,
            blending: blending,
            transparent: true,
            depthWrite: false,
        });

        this.addParticleChunk(positions, velocities, lifetime, fadeoutTime, growthRate, velocityDecay, material, layer);
    }

    /**
     * 
     * @param {*} positions 
     * @param {*} velocities 
     * @param {number} lifetime Total seconds of lifetime.
     * @param {number} fadeoutTime Last seconds of lifetime during which to fade out.
     * @param {number} growthRate Size increment per second.
     * @param {*} material 
     * @param {*} layer 
     */
    addParticleChunk(positions, velocities, lifetime, fadeoutTime, growthRate, velocityDecay, material, layer = 0) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("velocity", new THREE.Float32BufferAttribute(velocities, 3));

        const particles = new THREE.Points(geometry, material);
        particles.userData = { lifetime, fadeoutTime, growthRate, velocityDecay, age: 0 };
        if (layer != 0) {
            particles.layers.disable(0);
            particles.layers.enable(layer);
        }

        this.scene.add(particles);
        this.particleChunks.push(particles);
    }

    addLight(position, velocity, lifetime, fadeoutTime) {
        const light = new THREE.PointLight(0xffcc66, 1, 20);
        light.position.copy(position);
        light.userData = { velocity, lifetime, fadeoutTime, age: 0 };
        this.scene.add(light);
        this.lights.push(light);
    }

    update(dt) {
        this.updateParticleChunks(dt);
        this.updateLights(dt);
    }

    updateParticleChunks(dt) {
        for (const particles of this.particleChunks) {
            const pos = particles.geometry.attributes.position;
            const vel = particles.geometry.attributes.velocity;

            const decay = Math.pow(particles.userData.velocityDecay, particles.userData.age);

            for (let i = 0; i < pos.count; i++) {
                // update position
                pos.setXYZ(
                    i,
                    pos.getX(i) + vel.getX(i) * decay * dt,
                    pos.getY(i) + vel.getY(i) * decay * dt,
                    pos.getZ(i) + vel.getZ(i) * decay * dt
                );
            }
            pos.needsUpdate = true;

            // if (particles.userData.velocityDecay != 1) {
            //     // decay velocity
            //     const decay = Math.pow(particles.userData.velocityDecay, dt);
            //     for (let i = 0; i < vel.count; i++) {
            //         vel.setXYZ(i, decay * vel.getX(i), decay * vel.getY(i), decay * vel.getZ(i));
            //     }
            //     vel.needsUpdate = true;
            // }

            particles.userData.age += dt;

            if (particles.material instanceof THREE.PointsMaterial) {
                particles.material.opacity = getFadeoutOpacity(particles.userData);
                particles.material.size += particles.userData.growthRate * dt;
            } else if (particles.material instanceof THREE.ShaderMaterial) {
                particles.material.uniforms.opacity.value = getFadeoutOpacity(particles.userData);
                particles.material.uniforms.size.value += particles.userData.growthRate * dt;
            }

            if (particles.userData.age >= particles.userData.lifetime) {
                this.scene.remove(particles);
            }
        }
        this.particleChunks = this.particleChunks.filter(p => p.userData.age < p.userData.lifetime);
    }

    updateLights(dt) {
        for (const light of this.lights) {
            light.position.x += dt * light.userData.velocity.x;
            light.position.y += dt * light.userData.velocity.y;
            light.position.z += dt * light.userData.velocity.z;

            light.userData.age += dt;
            light.intensity = getFadeoutOpacity(light.userData);

            if (light.userData.age >= light.userData.lifetime) {
                this.scene.remove(light);
            }
        }

        this.lights = this.lights.filter(light => light.userData.age < light.userData.lifetime);
    }
}

function generateSparks(position, direction, count, spreadAngle = 0.25 * Math.PI, minSpeedRatio = 0.0667, maxSpeedRatio = 0.333) {
    const basePolar = toPolar(direction);
    const positions = [];
    const velocities = [];

    for (let i = 0; i < count; i++) {
        const polar = { ...basePolar };
        randomWigglePolar(polar, spreadAngle);
        polar.r *= minSpeedRatio + (maxSpeedRatio - minSpeedRatio) * Math.random();
        const dir = toCartesian(polar);

        positions.push(position.x, position.y, position.z);
        velocities.push(dir.x, dir.y, dir.z);
    }

    return {positions, velocities};
}

function generateImpactDebris(position, direction, count, randomSpeed = 0.1) {
    const positions = [];
    const velocities = [];

    for (let i = 0; i < count; i++) {
        const dir = { ...direction };
        dir.x += randomSpeed * getBiRandom();
        dir.y += randomSpeed * getBiRandom();
        dir.z += randomSpeed * getBiRandom();

        positions.push(position.x, position.y, position.z);
        velocities.push(dir.x, dir.y, dir.z);
    }

    return { positions, velocities };
}

function generateSplitDebris(positionPool, baseVelocity, impact, count, outwardSpeed = 0.1, randomSpeed = 0.1, impactWeight = 0.1, impactFalloff = 100) {
    const positions = [];
    const velocities = [];
    const center = getMeanVector3(positionPool);
    for (let i = 0; i < count; i++) {
        const point = positionPool[Math.floor(i / count * positionPool.length)];
        positions.push(point.x, point.y, point.z);
        const vel = point.clone().sub(center).normalize().multiplyScalar(outwardSpeed);
        vel.add(baseVelocity);
        vel.x += randomSpeed * getBiRandom();
        vel.y += randomSpeed * getBiRandom();
        vel.z += randomSpeed * getBiRandom();

        const dist = pointToLineDistanceSquared(point, impact.point, impact.velocity);
        vel.addScaledVector(impact.velocity, impactWeight * Math.exp(-impactFalloff * dist));
        velocities.push(vel.x, vel.y, vel.z);
    }

    return { positions, velocities };
}

function getFadeoutOpacity(data) {
    if (data.age < data.lifetime - data.fadeoutTime) {
        return 1.0;
    }
    return 1.0 - (data.age - (data.lifetime - data.fadeoutTime)) / data.fadeoutTime;
}

function toPolar(vector) {
    const r = Math.sqrt(vector.x ** 2 + vector.y ** 2 + vector.z ** 2);
    const theta = Math.atan2(vector.y, vector.x);
    const phi = Math.acos(vector.z / r);

    return { r, theta, phi };
}

function toCartesian(polar) {
    const { r, theta, phi } = polar;
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    return new THREE.Vector3(x, y, z);
}

function randomWiggleVector3(vector, phi) {
    return toCartesian(randomWigglePolar(toPolar(vector), phi));
}

function randomWigglePolar(polar, maxAngle) {
    const r = maxAngle * getBiRandom();
    const angle = Math.random() * 2 * Math.PI;
    return apply2dPolarTo3dPolar(polar, r, angle);
}

function apply2dPolarTo3dPolar(polar, r, phi) {
    polar.theta += r * Math.cos(phi);
    polar.phi += r * Math.sin(phi);
    return polar;
}

/**
 * Generates a random number [-1..1] with a probability peak at 0.
 */
function getBiRandom() {
    return 4 * (Math.random() - 0.5) * (Math.random() - 0.5);
}

function reflect(normal, impact) {
    const negImpact = impact.clone().multiplyScalar(-1);
    const stretchedNormal = normal.clone().multiplyScalar(negImpact.dot(normal));
    stretchedNormal.add(impact).multiplyScalar(2);
    return negImpact.add(stretchedNormal);
}

function getMeanVector3FromArray(arr) {
    let sumX = 0, sumY = 0, sumZ = 0;
    let count = arr.length / 3; // Number of points

    for (let i = 0; i < arr.length; i += 3) {
        sumX += arr[i];
        sumY += arr[i + 1];
        sumZ += arr[i + 2];
    }

    return new THREE.Vector3(sumX / count, sumY / count, sumZ / count);
}

function getMeanVector3(vectors) {
    let sumX = 0, sumY = 0, sumZ = 0;

    vectors.forEach((vector) => {
        sumX += vector.x;
        sumY += vector.y;
        sumZ += vector.z;
    });

    return new THREE.Vector3(sumX / vectors.length, sumY / vectors.length, sumZ / vectors.length);
}

function getRotatedPointVelocity(point, obj, resolution = 0.01) {
    const transformedPoint = point.clone().sub(obj.position);
    transformedPoint.applyAxisAngle(new THREE.Vector3(1, 0, 0), resolution * obj.userData.rotationalVelocity.x);
    transformedPoint.applyAxisAngle(new THREE.Vector3(0, 1, 0), resolution * obj.userData.rotationalVelocity.y);
    transformedPoint.applyAxisAngle(new THREE.Vector3(0, 0, 1), resolution * obj.userData.rotationalVelocity.z);
    transformedPoint.x += resolution * obj.userData.velocity.x + obj.position.x;
    transformedPoint.y += resolution * obj.userData.velocity.y + obj.position.y;
    transformedPoint.z += resolution * obj.userData.velocity.z + obj.position.z;
    const velocity = transformedPoint.clone().sub(point).multiplyScalar(1 / resolution);
    return velocity;
}

function isPointWithinDistanceOfPoints(point, points, distance) {
    const distanceSq = distance * distance;
    for (const p of points) {
        if (point.clone().sub(p).lengthSq() <= distanceSq) { return true; }
    }
    return false;
}

/**
 * Creates a canvas texture filled with r, g, b. Uses texture's red channel as alpha.
 */
function createColorAlphaTexture(texture, r, g, b) {
    const image = texture.image;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');

    // Draw the PNG image to extract alpha
    ctx.drawImage(image, 0, 0);
    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    const data = imageData.data;

    // Set specified color, use red channel from specified texture as alpha channel
    for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i];
        data[i + 0] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = alpha;
    }

    ctx.putImageData(imageData, 0, 0);

    const newTexture = new THREE.CanvasTexture(canvas);
    newTexture.needsUpdate = true;
    newTexture.minFilter = THREE.LinearFilter;
    newTexture.magFilter = THREE.LinearFilter;
    return newTexture;
}


/**
 * Randomizes array in-place.
 */
function shuffleArray(array) {
    for (var i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
}
