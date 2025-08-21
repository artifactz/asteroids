import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { computeMeshVolume } from 'three-bvh-csg';

const defaultAsteroidMat = new THREE.MeshStandardMaterial({ color: 0x888888, flatShading: true, depthWrite: true, onBeforeCompile: shader => { console.log(shader.vertexShader); console.log(shader.fragmentShader); } });
// const shaderAsteroidMat = new THREE.ShaderMaterial({
//     lights: true, // let Three.js inject light uniforms and parser hooks

//     uniforms: THREE.UniformsUtils.merge([
//         THREE.UniformsLib.common,      // pos, normal, uv, etc
//         THREE.UniformsLib.lights,      // ambientLightColor, directionalLights, etc
//         {                        // our edge params
//             edgeWidth:    { value: 0.02  },
//             edgeIntensity:{ value: 0.5   },
//             edgeColor:    { value: new THREE.Color(0xffffff) }
//         }
//     ]),

//     vertexShader: `
//     #include <common>
//     #include <lights_pars_begin>

//     attribute vec3 barycentric;
//     varying   vec3 vBarycentric;
//     varying   vec3 vNormal;
//     varying   vec3 vViewPosition;

//     void main() {
//       vBarycentric   = barycentric;
//       vNormal        = normalize( normalMatrix * normal );
//       vec4 mvPos     = modelViewMatrix * vec4( position, 1.0 );
//       vViewPosition  = -mvPos.xyz;
//       gl_Position    = projectionMatrix * mvPos;

//       #include <lights_vertex>
//     }`,

//     fragmentShader: `
//     #include <common>
//     #include <bsdfs>
//     #include <lights_pars_begin>

//     uniform float edgeWidth;
//     uniform float edgeIntensity;
//     uniform vec3  edgeColor;

//     varying vec3 vBarycentric;
//     varying vec3 vNormal;
//     varying vec3 vViewPosition;

//     void main() {
//       // build a simple lambertian base
//       ReflectedLight refl;
//       refl.directDiffuse    = vec3(0.0);
//       refl.indirectDiffuse  = vec3(0.0);
//       refl.directSpecular   = vec3(0.0);
//       refl.indirectSpecular = vec3(0.0);

//       #include <lights_fragment>

//       vec3 lit = refl.directDiffuse + refl.indirectDiffuse;

//       // edge highlight via barycentrics
//       float d = min(min(vBarycentric.x, vBarycentric.y), vBarycentric.z);
//       float t = smoothstep(edgeWidth, 0.0, d);
//       lit = mix(lit, lit + edgeIntensity * edgeColor, t);

//       gl_FragColor = vec4(lit, 1.0);
//     }`
// });

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
  shader.uniforms.edgeIntensity = { value: 0.027  };
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
    // TODO replace with simplifyGeometry / reduce tolerance
    geo = BufferGeometryUtils.mergeVertices(geo, 0.09);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        v.addScaledVector(v.clone().normalize(), (Math.random() - 0.5) * 0.4);
        pos.setXYZ(i, v.x, v.y, v.z);
    }
    return geo;
}

export function createAsteroid(geometry, rotationSpeed = 0.4, randomHealth = 40) {
    geometry = geometry.toNonIndexed();
    geometry.computeVertexNormals();
    addBarycentricCoordinates(geometry);

    geometry.computeBoundingSphere();
    // const mesh = new THREE.Mesh(geometry, defaultAsteroidMat);
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
        asteroidCollisionCooldownPeriod: 0.1,
        asteroidCollisionHeat: new Map(),
        health: 30 * Math.sqrt(volume) + randomHealth * Math.random(),
        materialValue: 2.5,
        splitAge: null,
        type: "asteroid"
    };

    Object.defineProperty(mesh.userData, "isSplitting", { get: function () { return mesh.userData.splitAge !== null; } });

    return mesh;
}

/**
 * Generates barycentric coords for every triangle.
 */
export function addBarycentricCoordinates(geometry) {
    const count = geometry.attributes.position.count;  // vertex count
    const bary = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 3) {
        bary.set([1,0,0,  0,1,0,  0,0,1], i * 3);
    }
    geometry.setAttribute('barycentric', new THREE.BufferAttribute(bary, 3));
}
