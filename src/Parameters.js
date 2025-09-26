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

export const DebrisParameters = {
    radius: 0.07,
    noise: 0.7,
    ttl: 120,
    randomSpeedProbability: 0.2,
    maxRandomSpeed: 2,
    baseOutwardVelocity: 0.1,
    randomOutwardVelocity: 1.2,
    baseImpactVelocity: 0.2,
    impactVelocityFalloff: 10,
    velocityDecay: 0.5,
    fadeoutTime: 10,
    initialColorByLaser: new THREE.Color(1.0, 0.81, 0.4),
    initialColorByCrash: new THREE.Color(0.5333, 0.5333, 0.5333),
}

export const WorldParameters = {
    asteroidExplosionVolume: 0.15,
    asteroidRemovalDistance: 60,
    debrisTakeDistance: 3.5,
    debrisTakeDuration: 1.0,
    debrisTakeFinishDistance: 0.4,
    debrisTransformDuration: 2.5,
}
