import * as THREE from 'three';
import { GeometryManipulator } from './GeometryUtils.js';

/**
 *   /1\           /1\
 *  / | \         / | \
 * 2--0--3  ==>  2--0--3
 *  \   /         \ | /
 *   \4/           \4/
 */
test('splitTrianglesOnTouchingVertices: 3 triangles -> 4 triangles', () => {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
        0.0, 0.0, 0.0,  // center
        0.0, 1.0, 0.0,  // top
        -1.0, 0.0, 0.0, // left
        1.0, 0.0, 0.0,  // right
        0.0, -1.0, 0.0, // bottom
    ]);
    const indices = [0, 1, 2,    0, 3, 1,    2, 4, 3];
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    const mani = new GeometryManipulator(geometry);

    const newGeometry = mani.splitTrianglesOnTouchingVertices(0.0001);

    const newIndices = newGeometry.index.array;
    const newTriangles = [];
    for (let i = 0; i < newIndices.length; i += 3) {
        newTriangles.push([newIndices[i], newIndices[i + 1], newIndices[i + 2]]);
    }

    // console.log(newTriangles);

    // vertices shouldn't have changed
    expect(newGeometry.attributes.position.array).toStrictEqual(geometry.attributes.position.array);

    // index should still contain the two upper triangle halves
    expect(newTriangles).toContainEqual([0, 1, 2]);
    expect(newTriangles).toContainEqual([0, 3, 1]);

    // index should not contain the whole lower triangle anymore
    expect(newTriangles).not.toContainEqual([2, 4, 3]);

    // index should instead contain two lower triangle halves
    expect(newTriangles).toContainEqual([0, 2, 4]);
    expect(newTriangles).toContainEqual([0, 4, 3]);
});


/**
 *     /1\
 *    / | \
 *   2--0--3
 *  / \   / \
 * 5---\4/---6
 * 
 * 2, 4, 3 is a hole
 */
test('splitTrianglesOnTouchingVertices: ignore hole', () => {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
        0.0, 0.0, 0.0,   // center
        0.0, 1.0, 0.0,   // top
        -1.0, 0.0, 0.0,  // left
        1.0, 0.0, 0.0,   // right
        0.0, -1.0, 0.0,  // bottom
        -2.0, -1.0, 0.0, // bottom left
        2.0, -1.0, 0.0,  // bottom right
    ]);
    const indices = [0, 1, 2,    0, 3, 1,    2, 5, 4,    3, 4, 6];
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    const mani = new GeometryManipulator(geometry);

    const newGeometry = mani.splitTrianglesOnTouchingVertices(0.0001);

    // vertices shouldn't have changed
    expect(newGeometry.attributes.position.array).toStrictEqual(geometry.attributes.position.array);

    // index shouldn't have changed
    expect(newGeometry.index.array).toStrictEqual(geometry.index.array);
});


/**
 *   /1\           /1\
 *  /   \         / | \
 * 2--0--3  ==>  2--0--3
 *  \   /         \ | /
 *   \4/           \4/
 * 
 * 2, 0, 3 is a flat triangle
 */
test('splitTrianglesOnTouchingVertices: remove and split at flat triangle', () => {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
        0.0, 0.0, 0.0,  // center
        0.0, 1.0, 0.0,  // top
        -1.0, 0.0, 0.0, // left
        1.0, 0.0, 0.0,  // right
        0.0, -1.0, 0.0, // bottom
    ]);
    const indices = [0, 2, 3,    1, 2, 3,    2, 4, 3];
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    const mani = new GeometryManipulator(geometry);

    const newGeometry = mani.splitTrianglesOnTouchingVertices(0.0001);

    const newIndices = newGeometry.index.array;
    const newTriangles = [];
    for (let i = 0; i < newIndices.length; i += 3) {
        newTriangles.push([newIndices[i], newIndices[i + 1], newIndices[i + 2]]);
    }

    // vertices shouldn't have changed
    expect(newGeometry.attributes.position.array).toStrictEqual(geometry.attributes.position.array);

    // index should not contain any of the original triangles anymore
    expect(newTriangles).not.toContainEqual([0, 2, 3]);
    expect(newTriangles).not.toContainEqual([1, 2, 3]);
    expect(newTriangles).not.toContainEqual([2, 4, 3]);

    // index should instead contain four triangle halves
    expect(newTriangles).toContainEqual([0, 1, 2]);
    expect(newTriangles).toContainEqual([0, 3, 1]);
    expect(newTriangles).toContainEqual([0, 2, 4]);
    expect(newTriangles).toContainEqual([0, 4, 3]);
});


/**
 *   /1\           /1\
 *  /   \         / | \
 * 2--0--3  ==>  2--0--3
 *   / \           / \
 *  4---5         4---5
 */
test('splitTrianglesOnTouchingVertices: 2 triangles -> 3 triangles', () => {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
        0.0, 0.0, 0.0,   // center
        0.0, 1.0, 0.0,   // top
        -1.0, 0.0, 0.0,  // left
        1.0, 0.0, 0.0,   // right
        -1.0, -1.0, 0.0, // bottom left
        1.0, -1.0, 0.0,  // bottom right
    ]);
    const indices = [1, 2, 3,    0, 4, 5];
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    const mani = new GeometryManipulator(geometry);

    const newGeometry = mani.splitTrianglesOnTouchingVertices(0.0001);

    const newIndices = newGeometry.index.array;
    const newTriangles = [];
    for (let i = 0; i < newIndices.length; i += 3) {
        newTriangles.push([newIndices[i], newIndices[i + 1], newIndices[i + 2]]);
    }

    // vertices shouldn't have changed
    expect(newGeometry.attributes.position.array).toStrictEqual(geometry.attributes.position.array);

    // index should still contain the lower triangle
    expect(newTriangles).toContainEqual([0, 4, 5]);

    // index should not contain the whole upper triangle anymore
    expect(newTriangles).not.toContainEqual([1, 2, 3]);

    // index should instead contain two upper triangle halves
    expect(newTriangles).toContainEqual([0, 1, 2]);
    expect(newTriangles).toContainEqual([0, 3, 1]);
});


/**
 *   /2\
 *  /   \
 * 01----3
 *  \   /
 *   \4/
 */
test('splitTrianglesOnTouchingVertices: too close to split', () => {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
        -1.0, 0.0, 0.0,     // leftmost
        -1.00001, 0.0, 0.0, // left
        0.0, 1.0, 0.0,      // top
        1.0, 0.0, 0.0,      // right
        0.0, -1.0, 0.0,     // bottom
    ]);
    const indices = [0, 3, 2,    1, 4, 3];
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    const mani = new GeometryManipulator(geometry);

    const newGeometry = mani.splitTrianglesOnTouchingVertices(0.0001);

    console.log(newGeometry.index.array);

    // vertices shouldn't have changed
    expect(newGeometry.attributes.position.array).toStrictEqual(geometry.attributes.position.array);

    // index shouldn't have changed
    expect(newGeometry.index.array).toStrictEqual(geometry.index.array);
});


/**
 *   /2\           /2\
 *  /   \         / / \
 * 0-1---3  ==>  0-1---3
 *   |  /          |  /
 *   |4/           |4/
 */
test('splitTrianglesOnTouchingVertices: just far enough to split', () => {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
        -1.0, 0.0, 0.0,    // leftmost
        -0.9998, 0.0, 0.0, // left
        0.0, 1.0, 0.0,     // top
        1.0, 0.0, 0.0,     // right
        0.0, -1.0, 0.0,    // bottom
    ]);
    const indices = [0, 3, 2,    1, 4, 3];
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    const mani = new GeometryManipulator(geometry);

    const newGeometry = mani.splitTrianglesOnTouchingVertices(0.0001);

    const newIndices = newGeometry.index.array;
    const newTriangles = [];
    for (let i = 0; i < newIndices.length; i += 3) {
        newTriangles.push([newIndices[i], newIndices[i + 1], newIndices[i + 2]]);
    }

    // vertices shouldn't have changed
    expect(newGeometry.attributes.position.array).toStrictEqual(geometry.attributes.position.array);

    // index should still contain the lower triangle
    expect(newTriangles).toContainEqual([1, 4, 3]);

    // index should not contain the upper triangle anymore
    expect(newTriangles).not.toContainEqual([0, 3, 2]);

    // index should instead contain two upper triangle halves
    expect(newTriangles).toContainEqual([0, 1, 2]);
    expect(newTriangles).toContainEqual([1, 3, 2]);
});


/**
 *   /1\            /1\    
 *  / | \          / | \   
 * 2  0--3--5 ==> 2--0--3--5
 *  \ |    /       \ | /  /
 *   \4 /           \4 /
 */
test('splitTrianglesOnTouchingVertices: 3 triangles -> 5 triangles', () => {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
        0.0, 0.0, 0.0,  // center
        0.0, 1.0, 0.0,  // top
        -1.0, 0.0, 0.0, // left
        1.0, 0.0, 0.0,  // right
        0.0, -1.0, 0.0, // bottom
        2.0, 0.0, 0.0,  // rightmost
    ]);
    const indices = [0, 3, 1,    1, 2, 4,    0, 4, 5];
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    const mani = new GeometryManipulator(geometry);

    const newGeometry = mani.splitTrianglesOnTouchingVertices(0.0001);

    const newIndices = newGeometry.index.array;
    const newTriangles = [];
    for (let i = 0; i < newIndices.length; i += 3) {
        newTriangles.push([newIndices[i], newIndices[i + 1], newIndices[i + 2]]);
    }

    // vertices shouldn't have changed
    expect(newGeometry.attributes.position.array).toStrictEqual(geometry.attributes.position.array);

    // index should still contain the upper right triangle
    expect(newTriangles).toContainEqual([0, 3, 1]);

    // index should not contain the left and lower right triangles anymore
    expect(newTriangles).not.toContainEqual([1, 2, 4]);
    expect(newTriangles).not.toContainEqual([0, 4, 5]);

    // index should instead contain two left and lower right triangle halves, respectively
    expect(newTriangles).toContainEqual([0, 1, 2]);
    expect(newTriangles).toContainEqual([0, 2, 4]);
    expect(newTriangles).toContainEqual([0, 4, 3]);
    expect(newTriangles).toContainEqual([3, 4, 5]);
});


/**
 *      4                4
 *    /   \            // \\
 *  /       \        / /   \ \
 * 0--1---2--3  ==> 0--1---2--3
 *   /|   |\          /|   |\
 *  6-5   7-8        6-5   7-8
 */
test('splitTrianglesOnTouchingVertices: two splits along one edge', () => {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
        -2.0, 0.0, 0.0,  // leftmost
        -1.0, 0.0, 0.0,  // left
        1.0, 0.0, 0.0,   // right
        2.0, 0.0, 0.0,   // rightmost
        0.0, 1.0, 0.0,   // top
        -2.0, -1.0, 0.0, // bottom leftmost
        -1.0, -1.0, 0.0, // bottom left
        1.0, -1.0, 0.0,  // bottom right
        2.0, -1.0, 0.0,  // bottom rightmost
    ]);
    const indices = [0, 3, 4,    1, 6, 5,    2, 7, 8];
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    const mani = new GeometryManipulator(geometry);

    const newGeometry = mani.splitTrianglesOnTouchingVertices(0.0001);

    const newIndices = newGeometry.index.array;
    const newTriangles = [];
    for (let i = 0; i < newIndices.length; i += 3) {
        newTriangles.push([newIndices[i], newIndices[i + 1], newIndices[i + 2]]);
    }

    // vertices shouldn't have changed
    expect(newGeometry.attributes.position.array).toStrictEqual(geometry.attributes.position.array);

    // index should still contain the lower triangles
    expect(newTriangles).toContainEqual([1, 6, 5]);
    expect(newTriangles).toContainEqual([2, 7, 8]);

    // index should not contain the whole upper triangle anymore
    expect(newTriangles).not.toContainEqual([0, 3, 4]);

    // index should instead contain three upper triangle parts
    expect(newTriangles).toContainEqual([0, 1, 4]);
    expect(newTriangles).toContainEqual([1, 2, 4]);
    expect(newTriangles).toContainEqual([2, 3, 4]);
});


/**
 *    0-1
 *   / / \
 *  //    \
 * 2-------3
 * 
 * 0 and 1 are more than tolerance apart, but closer to their edges than tolerance
 */
test('splitTrianglesOnTouchingVertices: no infinite loop', () => {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
        -0.01, 1.0, 0.0, // top left
        0.01, 1.0, 0.0,  // top right
        -1.0, 0.0, 0.0,  // bottom left
        1.0, 0.0, 0.0,   // bottom right
    ]);
    const indices = [0, 2, 1,    1, 2, 3];
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    const mani = new GeometryManipulator(geometry);

    const newGeometry = mani.splitTrianglesOnTouchingVertices(0.019);

    // vertices shouldn't have changed
    expect(newGeometry.attributes.position.array).toStrictEqual(geometry.attributes.position.array);

    // index shouldn't have changed
    expect(newGeometry.index.array).toStrictEqual(geometry.index.array);
});


/**
 *   1
 *  /|\
 * 2-0-3
 * 
 * 0, 2, 3 is a collapsed triangle
 */
test('splitTrianglesOnTouchingVertices: remove collapsed triangle', () => {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
        0.0, 0.0, 0.0,  // center
        0.0, 1.0, 0.0,  // top
        -1.0, 0.0, 0.0, // left
        1.0, 0.0, 0.0,  // right
    ]);
    const indices = [0, 1, 2,    0, 3, 1,    0, 2, 3];
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    const mani = new GeometryManipulator(geometry);

    const newGeometry = mani.splitTrianglesOnTouchingVertices(0.0001);

    const newIndices = newGeometry.index.array;
    const newTriangles = [];
    for (let i = 0; i < newIndices.length; i += 3) {
        newTriangles.push([newIndices[i], newIndices[i + 1], newIndices[i + 2]]);
    }

    // console.log(newTriangles);

    // vertices shouldn't have changed
    expect(newGeometry.attributes.position.array).toStrictEqual(geometry.attributes.position.array);

    // index should still contain the two proper triangles
    expect(newTriangles).toContainEqual([0, 1, 2]);
    expect(newTriangles).toContainEqual([0, 3, 1]);

    // index should not contain the collapsed triangle anymore
    expect(newTriangles).not.toContainEqual([0, 2, 3]);
});


/**
 *    /4\            /4\
 *   /   \          // \\
 *  /     \        / / \ \
 * 0-1---2-3  ==> 0-1---2-3
 *    \ /            \ /
 *     5              5
 */
test('splitTrianglesOnTouchingVertices: 2 triangles -> 4 triangles', () => {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
        -2.0, 0.0, 0.0, // leftmost
        -1.0, 0.0, 0.0, // left
        1.0, 0.0, 0.0,  // right
        2.0, 0.0, 0.0,  // rightmost
        0.0, 1.0, 0.0,  // top
        0.0, -1.0, 0.0, // bottom
    ]);
    const indices = [0, 3, 4,    1, 5, 2];
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    const mani = new GeometryManipulator(geometry);

    const newGeometry = mani.splitTrianglesOnTouchingVertices(0.0001);

    const newIndices = newGeometry.index.array;
    const newTriangles = [];
    for (let i = 0; i < newIndices.length; i += 3) {
        newTriangles.push([newIndices[i], newIndices[i + 1], newIndices[i + 2]]);
    }

    // vertices shouldn't have changed
    expect(newGeometry.attributes.position.array).toStrictEqual(geometry.attributes.position.array);

    // index should still contain the lower triangle
    expect(newTriangles).toContainEqual([1, 5, 2]);

    // index should not contain the upper triangle anymore
    expect(newTriangles).not.toContainEqual([0, 3, 4]);

    // index should instead contain three upper triangle parts
    expect(newTriangles).toContainEqual([0, 1, 4]);
    expect(newTriangles).toContainEqual([1, 2, 4]);
    expect(newTriangles).toContainEqual([2, 3, 4]);
});
