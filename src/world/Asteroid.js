import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { computeMeshVolume } from 'three-bvh-csg';
import { SUBTRACTION, Brush, Evaluator } from 'three-bvh-csg';
import { GeometryManipulator, simplifyGeometry, printDuplicateTriangles, printCollapsedTriangles } from '../GeometryUtils.js';


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

        nibble(impact) { nibbleAsteroid(mesh, impact); }
    };

    Object.defineProperty(mesh.userData, "isSplitting", { get: function () { return mesh.userData.splitAge !== null; } });

    return mesh;
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


const nibbleRadius = 0.25;
const nibbleDepth = 0.07;
const nibbleGeometry = new THREE.IcosahedronGeometry(nibbleRadius, 0);
const nibbleBrush = new Brush(nibbleGeometry);
const nibbleEvaluator = new Evaluator();
nibbleEvaluator.attributes = ["position"];

/**
 * Subtracts a low-detail sphere from the geometry around the impact area.
 * @param {THREE.Mesh} asteroid 
 * @param {Object} impact Impact object with a point and a velocity.
 */
function nibbleAsteroid(asteroid, impact, rx = null, ry = null, rz = null) {
    const brush1 = new Brush(asteroid.geometry);
    // const brush2 = new Brush(defaultNibbleGeometry);
    const negativeNormalizedImpact = impact.velocity.clone().normalize().multiplyScalar(-1);
    nibbleBrush.position.copy(asteroid.worldToLocal(
        impact.point.clone().add(negativeNormalizedImpact.multiplyScalar(nibbleRadius - nibbleDepth))
    ));
    rx = rx || Math.random() * 2 * Math.PI;
    ry = ry || Math.random() * 2 * Math.PI;
    rz = rz || Math.random() * 2 * Math.PI;

    nibbleBrush.rotation.set(rx, ry, rz);
    nibbleBrush.updateMatrixWorld();

    const result = nibbleEvaluator.evaluate(brush1, nibbleBrush, SUBTRACTION);
    let geo = result.geometry;

    // printDuplicateTriangles(geo);

    simplifyGeometry(geo, 0.0001);

    // printDuplicateTriangles(geo);

    geo = new GeometryManipulator(geo).splitTrianglesOnTouchingVertices();

    // printDuplicateTriangles(geo);  // <-- TODO this happens

    simplifyGeometry(geo, 0.04);

    // printDuplicateTriangles(geo);

    geo = geo.toNonIndexed();
    geo.computeVertexNormals();
    addBarycentricCoordinates(geo);

    asteroid.geometry = geo;
}
