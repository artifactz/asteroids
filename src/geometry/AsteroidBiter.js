import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { SUBTRACTION, Brush, Evaluator } from 'three-bvh-csg';
import { splitEdgesAtVertices } from '../geometry/EdgeSplitter.js';
import { removeCollapsedTriangles } from './GeometryUtils.js';


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

    asteroid.geometry = geo;
}
