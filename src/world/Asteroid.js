import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { computeMeshVolume } from 'three-bvh-csg';
import { addBarycentricCoordinates } from '../geometry/GeometryUtils.js';
import { AsteroidParameters } from '../Parameters.js';


const shaderAsteroidMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: AsteroidParameters.materialRoughness });
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

export function createAsteroid(geometry, rotationSpeed = 0.4, randomHealth = 15) {
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
        isBitten: false,
        type: "asteroid",
    };

    Object.defineProperty(mesh.userData, "isSplitting", { get: function () { return mesh.userData.splitAge !== null; } });

    return mesh;
}

/** For loading scenes. */
export function createDummyAsteroid() {
    return new THREE.Mesh(new THREE.BoxGeometry(), shaderAsteroidMat);
}
