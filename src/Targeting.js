import * as THREE from 'three';


/**
 * Calculates the position of the mouse cursor in world coordinates at a given z.
 * @param {DOMRect} canvasRect
 * @param {THREE.Camera} camera
 * @param {number} mouseX
 * @param {number} mouseY
 * @param {number} worldZ
 * @returns {THREE.Vector3}
 */
export function getMousePositionAtZ(canvasRect, camera, mouseX, mouseY, worldZ) {
    const mouseVector = new THREE.Vector3(
        2 * (mouseX - canvasRect.left) / canvasRect.width - 1,
        -2 * (mouseY - canvasRect.top) / canvasRect.height + 1,
        0
    );

    mouseVector.unproject(camera);

    const mouseRay = mouseVector.sub(camera.position);

    const t = (worldZ - camera.position.z) / mouseRay.z;

    return new THREE.Vector3(camera.position.x + t * mouseRay.x, camera.position.y + t * mouseRay.y, worldZ);
}


export function rotateTowards(actor, point, dt) {
    const targetOrientation = Math.atan2(point.y - actor.position.y, point.x - actor.position.x);
    const difference = getAngleDifference(targetOrientation, actor.rotation.z);
    const maxRotation = actor.userData.maxRotationalSpeed * dt;
    const rotation = Math.min(maxRotation, Math.max(-maxRotation, difference));

    actor.rotation.z += rotation;
    actor.userData.rotationalVelocity = new THREE.Vector3(0, 0, rotation / dt);
}


/**
 * Steers camera towards the point between player and cursor, and slightly towards nearby asteroids.
 * Handles camera shake.
 */
export function moveCamera(world, aimPoint, dt) {
    const destination = new THREE.Vector2(
        0.5 * (world.player.position.x + aimPoint.x),
        0.5 * (world.player.position.y + aimPoint.y)
    );

    // Steer camera towards nearby asteroids
    if (world.asteroids.length > 0) {
        // TODO add more weight to asteroids closing in on us
        const asteroidPull = 6;
        const distanceCutoff = 2;
        const distanceFallofoff = 0.25;

        const weights = world.asteroids.map(
            (a) => Math.exp(-distanceFallofoff * Math.max(0, world.player.position.clone().sub(a.position).length() - distanceCutoff))
        );
        const weightsIter = weights.values();
        const weightedSum = world.asteroids
            .map((a) => a.position)
            .reduce((a, b) => a.addScaledVector(new THREE.Vector2(b.x, b.y).sub(destination), weightsIter.next().value), new THREE.Vector2());
        const weightsTotal = weights.reduce((a, b) => a + b, 0);
        const asteroidsMean = weightedSum.multiplyScalar(1 / (weightsTotal * world.asteroids.length));
        asteroidsMean.multiplyScalar(1 - Math.exp(-asteroidPull * weightsTotal));
        const norm = asteroidsMean.length();
        if (norm > 5) { asteroidsMean.multiplyScalar(5 / norm); }
        if (world.camera.userData.lastAsteroidsMean) {
            const beta = Math.pow(0.5, dt);
            asteroidsMean.multiplyScalar(1 - beta).addScaledVector(world.camera.userData.lastAsteroidsMean, beta);
        }
        destination.add(asteroidsMean);
        world.camera.userData.lastAsteroidsMean = asteroidsMean;
    }

    const alpha = Math.pow(world.camera.userData.slackPerSecond, dt);
    destination.x = (1 - alpha) * destination.x + alpha * world.camera.position.x;
    destination.y = (1 - alpha) * destination.y + alpha * world.camera.position.y;

    if (world.camera.userData.shake) {
        world.camera.userData.shake = Math.max(0, Math.min(world.camera.userData.maxShake, world.camera.userData.shake) - world.camera.userData.shakeDecay * dt);
        destination.x += world.camera.userData.shake * Math.cos(0.0587 * Date.now());
        destination.y += world.camera.userData.shake * Math.sin(0.0412 * Date.now());
    }

    world.camera.position.set(
        destination.x,
        destination.y,
        world.camera.position.z
    );
}


export function fixCameraOnPlayer(world, dx = 0, dy = 0) {
    world.camera.position.set(
        world.player.position.x + dx,
        world.player.position.y + dy,
        world.camera.position.z
    );
}


function getAngleDifference(a, b) {
	let c = (a % (2 * Math.PI)) - (b % (2 * Math.PI));
	if (c < Math.PI) { c += 2 * Math.PI; }
	if (c > Math.PI) { c -= 2 * Math.PI; }
	return c;
}
