import * as THREE from 'three';


export class ParticleSystem {
    constructor(scene) {
        this.scene = scene;
        this.particleChunks = [];
        this.lights = [];
    }

    handleDefaultImpact(intersection, asteroid, divertAngle = 0.3 * Math.PI, minLifetime = 0.333, maxLifetime = 1.0, minFadeoutRatio = 0.333, maxFadeoutRatio = 1.0) {
        const reflection = reflect(intersection.normal, intersection.impact);
        const noisyReflection = randomWiggleVector3(reflection, divertAngle);
        const sparkVelocities = [];
        for (let i = 0; i < 10; i++) {
            const lifetime = minLifetime + (maxLifetime - minLifetime) * Math.random();
            const fadeoutRatio = minFadeoutRatio + (maxFadeoutRatio - minFadeoutRatio) * Math.random();
            const { positions, velocities } = this.generateSparks(intersection.point, noisyReflection, 40);
            this.addParticleChunk(positions, velocities, lifetime, fadeoutRatio * lifetime, 0xffcc66);

            const velocity = getMeanVector3(velocities);
            sparkVelocities.push(velocity.x, velocity.y, velocity.z);
        }

        const meanVelocity = getMeanVector3(sparkVelocities);
        this.addLight(intersection.point, meanVelocity, maxLifetime, maxLifetime - minLifetime);

        const objPointVel = getRotatedPointVelocity(intersection.point, asteroid);
        const awayFromCenter = intersection.point.clone().sub(asteroid.position).normalize();
        const generalDirection = objPointVel.add(awayFromCenter.multiplyScalar(0.2));
        const { positions, velocities } = this.generateDebris(intersection.point, generalDirection, 100, 0.2);
        this.addParticleChunk(positions, velocities, 3.0, 2.0, 0x555555, THREE.NormalBlending, undefined, true);
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

    addParticleChunk(positions, velocities, lifetime, fadeoutTime, color, blending = THREE.AdditiveBlending, size = 0.025, blur = false) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("velocity", new THREE.Float32BufferAttribute(velocities, 3));

        const material = new THREE.PointsMaterial({
            color: color,
            size: size,
            transparent: true,
            opacity: 1,
            depthWrite: false,
            blending: blending
        });

        const particles = new THREE.Points(geometry, material);
        particles.userData = { lifetime, fadeoutTime, age: 0 };
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
    return Math.min(1, Math.max(0, (data.lifetime - data.fadeoutTime - data.age) / data.fadeoutTime));
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

function getBiRandom() {
    return 4 * (Math.random() - 0.5) * (Math.random() - 0.5);
}

function reflect(normal, impact) {
    const negImpact = impact.clone().multiplyScalar(-1);
    const stretchedNormal = normal.clone().multiplyScalar(negImpact.dot(normal));
    stretchedNormal.add(impact).multiplyScalar(2);
    return negImpact.add(stretchedNormal);
}

function getMeanVector3(arr) {
    let sumX = 0, sumY = 0, sumZ = 0;
    let count = arr.length / 3; // Number of points

    for (let i = 0; i < arr.length; i += 3) {
        sumX += arr[i];
        sumY += arr[i + 1];
        sumZ += arr[i + 2];
    }

    return new THREE.Vector3(sumX / count, sumY / count, sumZ / count);
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
