import * as THREE from 'three';
import { biteAsteroid } from "../geometry/AsteroidBiter.js";

onmessage = async (message) => {
    const { asteroid, impact } = message.data;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(asteroid.vertexArray, 3));
    const mesh = new THREE.Mesh(geo);
    mesh.position.set(asteroid.position.x, asteroid.position.y, asteroid.position.z);
    mesh.rotation.set(asteroid.rotation.x, asteroid.rotation.y, asteroid.rotation.z);

    impact.point = new THREE.Vector3(impact.point.x, impact.point.y, impact.point.z);
    impact.velocity = new THREE.Vector3(impact.velocity.x, impact.velocity.y, impact.velocity.z);

    biteAsteroid(mesh, impact);
    // await new Promise(r => setTimeout(r, 1000));

    postMessage({
        uuid: asteroid.uuid,
        vertexArray: mesh.geometry.attributes.position.array,
        normalArray: mesh.geometry.attributes.normal.array,
    });
};
