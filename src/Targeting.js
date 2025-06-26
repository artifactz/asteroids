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
    const maxRotation = actor.userData.rotationalSpeed * dt;
    const rotation = Math.min(maxRotation, Math.max(-maxRotation, difference));

    actor.rotation.z += rotation;
}


export function moveCamera(world, aimPoint, dt) {
    const destination = new THREE.Vector2(
        0.5 * (world.player.position.x + aimPoint.x),
        0.5 * (world.player.position.y + aimPoint.y)
    );
    const alpha = Math.pow(world.camera.userData.slackPerSecond, dt);
    world.camera.position.set(
        (1 - alpha) * destination.x + alpha * world.camera.position.x,
        (1 - alpha) * destination.y + alpha * world.camera.position.y,
        world.camera.position.z
    );
}


function getAngleDifference(a, b) {
	let c = (a % (2 * Math.PI)) - (b % (2 * Math.PI));
	if (c < Math.PI) { c += 2 * Math.PI; }
	if (c > Math.PI) { c -= 2 * Math.PI; }
	return c;
}
