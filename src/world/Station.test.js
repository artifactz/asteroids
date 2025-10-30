import * as THREE from 'three';
import { OrientedBoundingBox } from './Station.js'


test('outside', () => {
    const obb = new OrientedBoundingBox(new THREE.Vector2(0, 0), new THREE.Vector2(1, 1), 0);
    const result = obb.intersects(new THREE.Vector2(1.1, 0));
    expect(result.inside).toBe(false);
});

test('canonical right', () => {
    const obb = new OrientedBoundingBox(new THREE.Vector2(0, 0), new THREE.Vector2(1, 1), 0);
    const result = obb.intersects(new THREE.Vector2(0.9, 0.1));
    expect(result.inside).toBe(true);
    expect(result.repel.x).toBeCloseTo(0.1);
    expect(result.repel.y).toBeCloseTo(0);
});

test('canonical left', () => {
    const obb = new OrientedBoundingBox(new THREE.Vector2(0, 0), new THREE.Vector2(1, 1), 0);
    const result = obb.intersects(new THREE.Vector2(-0.9, 0.2));
    expect(result.inside).toBe(true);
    expect(result.repel.x).toBeCloseTo(-0.1);
    expect(result.repel.y).toBeCloseTo(0);
});

test('canonical top', () => {
    const obb = new OrientedBoundingBox(new THREE.Vector2(0, 0), new THREE.Vector2(1, 1), 0);
    const result = obb.intersects(new THREE.Vector2(0.3, 0.9));
    expect(result.inside).toBe(true);
    expect(result.repel.x).toBeCloseTo(0);
    expect(result.repel.y).toBeCloseTo(0.1);
});

test('canonical bottom', () => {
    const obb = new OrientedBoundingBox(new THREE.Vector2(0, 0), new THREE.Vector2(1, 1), 0);
    const result = obb.intersects(new THREE.Vector2(0.4, -0.9));
    expect(result.inside).toBe(true);
    expect(result.repel.x).toBeCloseTo(0);
    expect(result.repel.y).toBeCloseTo(-0.1);
});

test('translated', () => {
    const obb = new OrientedBoundingBox(new THREE.Vector2(5, -3), new THREE.Vector2(2, 2), 0);
    const result = obb.intersects(new THREE.Vector2(6.5, -2.1));
    expect(result.inside).toBe(true);
    expect(result.repel.x).toBeCloseTo(0.5);
    expect(result.repel.y).toBeCloseTo(0);
});

test('rotated', () => {
    const obb = new OrientedBoundingBox(new THREE.Vector2(0, 0), new THREE.Vector2(1, 1), Math.PI / 4);
    const result = obb.intersects(new THREE.Vector2(0.5, 0.5));
    expect(result.inside).toBe(true);
    expect(result.repel.x).toBeGreaterThan(0);
    expect(result.repel.x).toBeCloseTo(result.repel.y);
});

test('non-square x', () => {
    const obb = new OrientedBoundingBox(new THREE.Vector2(0, 0), new THREE.Vector2(2, 1), 0);
    const result = obb.intersects(new THREE.Vector2(1.9, 0.123));
    expect(result.inside).toBe(true);
    expect(result.repel.x).toBeCloseTo(0.1);
    expect(result.repel.y).toBeCloseTo(0);
});

test('non-square y', () => {
    const obb = new OrientedBoundingBox(new THREE.Vector2(0, 0), new THREE.Vector2(2, 1), 0);
    const result = obb.intersects(new THREE.Vector2(-0.321, 0.9));
    expect(result.inside).toBe(true);
    expect(result.repel.x).toBeCloseTo(0);
    expect(result.repel.y).toBeCloseTo(0.1);
});

test('non-square x flipped', () => {
    const obb = new OrientedBoundingBox(new THREE.Vector2(0, 0), new THREE.Vector2(2, 1), Math.PI);
    const result = obb.intersects(new THREE.Vector2(1.9, 0.123));
    expect(result.inside).toBe(true);
    expect(result.repel.x).toBeCloseTo(0.1);
    expect(result.repel.y).toBeCloseTo(0);
});

test('non-square y flipped', () => {
    const obb = new OrientedBoundingBox(new THREE.Vector2(0, 0), new THREE.Vector2(2, 1), Math.PI);
    const result = obb.intersects(new THREE.Vector2(-0.321, 0.9));
    expect(result.inside).toBe(true);
    expect(result.repel.x).toBeCloseTo(0);
    expect(result.repel.y).toBeCloseTo(0.1);
});

test('real example', () => {
    const obb = new OrientedBoundingBox(new THREE.Vector2(0, -10), new THREE.Vector2(7, 1.5), 4.972398658618638);
    const result = obb.intersects(new THREE.Vector2(1.8618633609247504, -16.733049275657724));
    expect(result.inside).toBe(true);
    expect(result.repel.x).toBeGreaterThan(0);
    expect(result.repel.y).toBeLessThan(0);
});

