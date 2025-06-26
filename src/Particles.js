import * as THREE from 'three';
import { SurfaceSampler, pointToLineDistanceSquared } from './GeometryUtils.js';


export class ParticleSystem {
    constructor(scene) {
        this.scene = scene;
        this.particleChunks = [];
        this.lights = [];

        const textureLoader = new THREE.TextureLoader()
        textureLoader.load('/media/smoke.png', (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            this.smokeTexture = createColorAlphaTexture(texture, 76, 76, 76);
        });
    }

    handleDefaultImpact(intersection, asteroid, divertAngle = 0.3 * Math.PI, minLifetime = 0.333, maxLifetime = 1.0, minFadeoutRatio = 0.333, maxFadeoutRatio = 1.0) {
        // Sparks
        const reflection = reflect(intersection.normal, intersection.impact);
        const noisyReflection = randomWiggleVector3(reflection, divertAngle);
        const sparkVelocities = [];
        for (let i = 0; i < 10; i++) {
            const lifetime = minLifetime + (maxLifetime - minLifetime) * Math.abs(getBiRandom());
            const fadeoutRatio = minFadeoutRatio + (maxFadeoutRatio - minFadeoutRatio) * Math.random();
            const { positions, velocities } = this.generateSparks(intersection.point, noisyReflection, 40);
            this.addColorParticleChunk(positions, velocities, lifetime, fadeoutRatio * lifetime, 0, 0xffcc66);

            const velocity = getMeanVector3FromArray(velocities);
            sparkVelocities.push(velocity.x, velocity.y, velocity.z);
        }

        // Spark light
        const meanVelocity = getMeanVector3FromArray(sparkVelocities);
        this.addLight(intersection.point, meanVelocity, maxLifetime, maxLifetime - minLifetime);

        // Debris
        const objPointVel = getRotatedPointVelocity(intersection.point, asteroid);
        const awayFromCenter = intersection.point.clone().sub(asteroid.position).normalize();
        const generalDirection = objPointVel.add(awayFromCenter.multiplyScalar(0.2));
        const { positions, velocities } = this.generateDebris(intersection.point, generalDirection, 100, 0.2);
        this.addColorParticleChunk(positions, velocities, 3.0, 2.0, 0, 0x555555, THREE.NormalBlending, 0.025);

        // Smoke
        const smoke = this.generateDebris(intersection.point, generalDirection, 10, 0.3);
        const lifetime = 7.0 + (2 * Math.random() - 1);
        this.addTextureParticleChunk(smoke.positions, smoke.velocities, lifetime, 70.0, 0.25, this.smokeTexture, THREE.NormalBlending, 0.25, false);
    }

    handleDefaultSplit(intersection, asteroid) {
        // Prepare spawn points
        const minPointDistance = 0.1;
        const minPlaneDistance = 0.051;

        const projectedPoints = [];
        const planeOrigin = intersection.point;
        const planeNormal = new THREE.Vector3(intersection.impact.y, -intersection.impact.x, 0).normalize();  // rotate impact 90° ccw
        const pos = asteroid.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const p = asteroid.localToWorld(new THREE.Vector3().fromBufferAttribute(pos, i));
            const v = p.clone().sub(planeOrigin);
            const dist = v.dot(planeNormal);
            if (dist > minPlaneDistance) { continue; }
            const projectedPoint = p.clone().sub(planeNormal.clone().multiplyScalar(dist));
            if (!isPointWithinDistanceOfPoints(projectedPoint, projectedPoints, minPointDistance)) {
                projectedPoints.push(projectedPoint);
            }
        }

        // Smoke
        const numSmokeParticles = Math.ceil(25 * asteroid.userData.diameter);
        const outwardSpeed = 0.1;
        const randomSpeed = 0.14;

        const positions = [];
        const velocities = [];
        const center = getMeanVector3(projectedPoints);
        for (let i = 0; i < numSmokeParticles; i++) {
            const point = projectedPoints[Math.floor(i / numSmokeParticles * projectedPoints.length)];
            positions.push(point.x, point.y, point.z);
            const vel = point.clone().sub(center).normalize().multiplyScalar(outwardSpeed);
            vel.x += randomSpeed * getBiRandom();
            vel.y += randomSpeed * getBiRandom();
            vel.z += randomSpeed * getBiRandom();
            velocities.push(vel.x, vel.y, vel.z);
        }

        const lifetime = 7.0 + (2 * Math.random() - 1);
        this.addTextureParticleChunk(positions, velocities, lifetime, 70.0, 0.3, this.smokeTexture, THREE.NormalBlending, 0.25, false);

        // Debris
        const numDebrisParticles = Math.ceil(40 * asteroid.userData.diameter);
        const debrisOutwardSpeed = 0.25;
        const debrisRandomSpeed = 0.1;
        const debrisPositions = [];
        const debrisVelocities = [];
        for (let i = 0; i < numDebrisParticles; i++) {
            const point = projectedPoints[Math.floor(i / numDebrisParticles * projectedPoints.length)];
            debrisPositions.push(point.x, point.y, point.z);
            const vel = point.clone().sub(center).normalize().multiplyScalar(debrisOutwardSpeed);
            vel.x += debrisRandomSpeed * getBiRandom();
            vel.y += debrisRandomSpeed * getBiRandom();
            vel.z += debrisRandomSpeed * getBiRandom();

            const dist = pointToLineDistanceSquared(point, asteroid.userData.recentHit.point, asteroid.userData.recentHit.impact);
            const laserWeight = 0.05 * Math.exp(-100 * dist);
            vel.addScaledVector(asteroid.userData.recentHit.impact, laserWeight);

            debrisVelocities.push(vel.x, vel.y, vel.z);
        }

        const debrisLifetime = 3.0 + (1 * Math.random() - 0.5);
        this.addColorParticleChunk(debrisPositions, debrisVelocities, debrisLifetime, 2.0, 0, 0x555555, THREE.NormalBlending, 0.025);
    }

    handleDefaultBreakdown(asteroid) {
        const surfaceSampler = new SurfaceSampler(asteroid.geometry);

        // Debris
        const numChunks = Math.ceil(15 * asteroid.userData.diameter);
        const chunkSize = Math.ceil(15 * asteroid.userData.diameter);
        for (let i = 0; i < numChunks; i++) {
            const debrisPositions = [];
            const debrisVelocities = [];
            for (let j = 0; j < chunkSize; j++) {
                const point = asteroid.localToWorld(surfaceSampler.getRandomPoint());
                debrisPositions.push(point.x, point.y, point.z);
                const vel = getRotatedPointVelocity(point, asteroid);

                // Close particles get dragged by laser
                const dist = pointToLineDistanceSquared(point, asteroid.userData.recentHit.point, asteroid.userData.recentHit.impact);
                const laserWeight = 0.03 * Math.exp(-100 * dist);
                vel.addScaledVector(asteroid.userData.recentHit.impact, laserWeight);

                debrisVelocities.push(vel.x, vel.y, vel.z);
            }
            const debrisLifetime = 4.0 + (1 * Math.random() - 0.5);
            this.addColorParticleChunk(debrisPositions, debrisVelocities, debrisLifetime, 3.0, 0, 0x555555, THREE.NormalBlending, 0.025);
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
        this.addTextureParticleChunk(smokePositions, smokeVelocities, smokeLifetime, 80.0, 0.4, this.smokeTexture, THREE.NormalBlending, 0.8, false);
    }

    generateSparks(position, direction, count, spreadAngle = 0.25 * Math.PI, minSpeedRatio = 0.0667, maxSpeedRatio = 0.333) {
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

    generateDebris(position, direction, count, randomSpeed = 0.1) {
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

        return {positions, velocities};
    }

    addColorParticleChunk(positions, velocities, lifetime, fadeoutTime, growthRate, color, blending = THREE.AdditiveBlending, size = 0.025, blur = false) {
        const material = new THREE.PointsMaterial({
            color: color,
            size: size,
            transparent: true,
            opacity: 1,
            depthWrite: false,
            blending: blending
        });

        this.addParticleChunk(positions, velocities, lifetime, fadeoutTime, growthRate, material, blur);
    }

    addTextureParticleChunk(positions, velocities, lifetime, fadeoutTime, growthRate, texture, blending = THREE.AdditiveBlending, size = 0.02, blur = false) {
        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            map: texture,
            size: size,
            transparent: true,
            opacity: 1,
            depthWrite: false,
            blending: blending
        });

        this.addParticleChunk(positions, velocities, lifetime, fadeoutTime, growthRate, material, blur);
    }

    addParticleChunk(positions, velocities, lifetime, fadeoutTime, growthRate, material, blur = false) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("velocity", new THREE.Float32BufferAttribute(velocities, 3));

        const particles = new THREE.Points(geometry, material);
        particles.userData = { lifetime, fadeoutTime, growthRate, age: 0 };
        if (blur) {
            particles.layers.enable(1);  // blur layer
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

            for (let i = 0; i < pos.count; i++) {
                // update position
                pos.setXYZ(
                    i,
                    pos.getX(i) + vel.getX(i) * dt,
                    pos.getY(i) + vel.getY(i) * dt,
                    pos.getZ(i) + vel.getZ(i) * dt
                );
            }

            particles.userData.age += dt;
            particles.material.opacity = getFadeoutOpacity(particles.userData);
            particles.material.size += particles.userData.growthRate * dt;

            pos.needsUpdate = true;

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
    transformedPoint.x += resolution * obj.userData.velocity.x + obj.position.x;
    transformedPoint.y += resolution * obj.userData.velocity.y + obj.position.y;
    transformedPoint.z += obj.position.z;
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
