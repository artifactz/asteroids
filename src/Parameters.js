import * as THREE from 'three';

export const GameControllerParameters = {
    numStartAsteroids: 4,
    startAsteroidCooldown: 3.5,
    initialAsteroidSpawnProbability: 10.0,
    asteroidSpawnDistance: 32,
    asteroidSpawnProbabilityGainPerSecond: 0.15,
    maxAsteroids: 100,
    startScreenPlayerSpeed: 40,
    gameOverDuration: 2,
    highscoresTimeout: 7,
}

export const AsteroidParameters = {
    materialRoughness: 1.0,
}

export const ParticleParameters = {
    asteroidColor: 0xaaaaaa,
}

export const DebrisParameters = {
    radius: 0.09,
    noise: 0.7,
    materialMetalness: 0.5,
    materialRoughness: 0.3,
    materialEmissiveIntensity: 0.15,
    materialBaseOpacity: 0.8,
    ttl: 120,
    randomSpeedProbability: 0.2,
    maxRandomSpeed: 2,
    baseOutwardVelocity: 0.1,
    randomOutwardVelocity: 1.2,
    baseImpactVelocity: 0.2,
    impactVelocityFalloff: 10,
    rotationalVelocity: 6.5,
    velocityDecay: 0.5,
    steer0P: 0.001,
    steer0D: 0.5,
    staleMaxSpeedSquared: 1e-3,
    staleMinZ: -2,
    staleMaxZ: 6.5,
    fadeoutTime: 10,
    initialColorByLaser: new THREE.Color(1.0, 0.81, 0.4),
    initialColorByCrash: new THREE.Color(0.5333, 0.5333, 0.5333),
    takeDistance: 3.5,
    takeDuration: 1.0,
    takeFinishDistance: 0.4,
    transformDuration: 2.5,
}

export const WorldParameters = {
    asteroidExplosionVolume: 0.15,
    asteroidRemovalDistance: 60,
}

export const TrailParameters = {
    stepSize: 0.1,
    baseWidth: 0.15,
    baseAlpha: 0.1,
    thrustAlpha: 0.9,
    thrustActivationAttack: 7.0,
    thrustActivationDecay: 0.25,
    burstActivationDecay: 0.2,
    deathSegmentsDecay: 0.5,
    deathAlphaDelta: -4,
    deathLightIntensity: 3,
    deathLightIntensityDelta: -2,
}

export const UniverseParameters = {
    brightStarProbabilityPerTile: 0.29,
}
