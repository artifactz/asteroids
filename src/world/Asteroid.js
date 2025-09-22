import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { SUBTRACTION, Brush, Evaluator, computeMeshVolume } from 'three-bvh-csg';
import { splitEdgesAtVertices } from '../geometry/EdgeSplitter.js';
import { removeCollapsedTriangles } from '../GeometryUtils.js';


const shaderAsteroidMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 1.0 });
shaderAsteroidMat.onBeforeCompile = shader => {
    // inject barycentric
    shader.vertexShader   = `
        attribute vec3 barycentric;
        varying vec3 vBarycentric;
    ` + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vBarycentric = barycentric;`
    );

  // inject varying
  shader.fragmentShader = 'varying vec3 vBarycentric;\n' + shader.fragmentShader;

  // add edge uniforms
  shader.uniforms.edgeWidth     = { value: 0.35 };
  shader.uniforms.edgeIntensity = { value: 0.027 };
  shader.uniforms.edgeColor     = { value: new THREE.Color(0xffffbb) };

  // modify the final color
  shader.fragmentShader = `
    uniform float edgeWidth;
    uniform float edgeIntensity;
    uniform vec3 edgeColor;
  ` + shader.fragmentShader.replace(
    "#include <color_fragment>",
    `
      #include <color_fragment>
      float d = min(min(vBarycentric.x, vBarycentric.y), vBarycentric.z);
      float t = smoothstep(edgeWidth, 0.0, d);
      vec3 edged = diffuseColor.rgb + edgeIntensity * edgeColor;
      diffuseColor.rgb = mix(diffuseColor.rgb, edged, t);
    `
  );
};

export function createAsteroidGeometry(radius = 0.9) {
    let geo = new THREE.IcosahedronGeometry(radius, 2);
    geo.deleteAttribute('normal');
    geo.deleteAttribute('uv');
    geo = BufferGeometryUtils.mergeVertices(geo, 0.0001);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        v.addScaledVector(v.clone().normalize(), (Math.random() - 0.5) * 0.4);
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    return geo;
}

export function createAsteroid(geometry, rotationSpeed = 0.4, randomHealth = 40) {
    if (geometry.index) { geometry = geometry.toNonIndexed(); }
    geometry.computeVertexNormals();
    addBarycentricCoordinates(geometry);

    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, shaderAsteroidMat);
    const volume = computeMeshVolume(mesh);
    mesh.userData = {
        velocity: new THREE.Vector3(0, 0, 0),
        rotationalVelocity: new THREE.Vector3(
            rotationSpeed * (Math.random() - 0.5),
            rotationSpeed * (Math.random() - 0.5),
            rotationSpeed * (Math.random() - 0.5)
        ),
        diameter: 2 * geometry.boundingSphere.radius,
        volume: volume,
        health: 30 * Math.sqrt(volume) + randomHealth * Math.random(),
        materialValue: 2.5,
        splitAge: null,
        type: "asteroid",

        bite(impact) { biteAsteroid(mesh, impact); }
    };

    Object.defineProperty(mesh.userData, "isSplitting", { get: function () { return mesh.userData.splitAge !== null; } });

    return mesh;
}

/** For loading scenes. */
export function createDummyAsteroid() {
    return new THREE.Mesh(new THREE.BoxGeometry(), shaderAsteroidMat);
}

/**
 * Generates barycentric coords for every triangle.
 */
function addBarycentricCoordinates(geometry) {
    const count = geometry.attributes.position.count;  // vertex count
    const bary = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 3) {
        bary.set([1,0,0,  0,1,0,  0,0,1], i * 3);
    }
    geometry.setAttribute('barycentric', new THREE.BufferAttribute(bary, 3));
}


const biteRadius = 0.3;
const biteDepth = 0.1;
const biteGeometry = new THREE.IcosahedronGeometry(biteRadius, 0);
const biteBrush = new Brush(biteGeometry);
const biteEvaluator = new Evaluator();
biteEvaluator.attributes = ["position"];

/**
 * Subtracts a low-detail sphere from the geometry around the impact area.
 * @param {THREE.Mesh} asteroid 
 * @param {Object} impact Impact object with a point and a velocity.
 */
export function biteAsteroid(asteroid, impact, rx = null, ry = null, rz = null) {
    // TODO intersect and use surface sampler on result to create particles
    const asteroidBrush = new Brush(asteroid.geometry);
    const negativeNormalizedImpact = impact.velocity.clone().normalize().multiplyScalar(-1);
    biteBrush.position.copy(asteroid.worldToLocal(
        impact.point.clone().add(negativeNormalizedImpact.multiplyScalar(biteRadius - biteDepth))
    ));
    rx = rx || Math.random() * 2 * Math.PI;
    ry = ry || Math.random() * 2 * Math.PI;
    rz = rz || Math.random() * 2 * Math.PI;

    biteBrush.rotation.set(rx, ry, rz);
    biteBrush.updateMatrixWorld();

    const result = biteEvaluator.evaluate(asteroidBrush, biteBrush, SUBTRACTION);
    let geo = result.geometry;

    geo = BufferGeometryUtils.mergeVertices(geo, 0.0001);
    removeCollapsedTriangles(geo);
    geo = splitEdgesAtVertices(geo);
    geo = BufferGeometryUtils.mergeVertices(geo, 0.04);
    removeCollapsedTriangles(geo);

    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    addBarycentricCoordinates(geo);

    asteroid.geometry = geo;
}
