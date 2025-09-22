import * as THREE from 'three';
import { splitEdgesAtVertices } from './EdgeSplitter.js';

/**
 *   /1\           /1\
 *  / | \         / | \
 * 2--0--3  ==>  2--0--3
 *  \   /         \ | /
 *   \4/           \4/
 */
test('splitEdgesAtVertices: 3 triangles -> 4 triangles', () => {
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

    const newGeometry = splitEdgesAtVertices(geometry, 0.0001);

    // geometry should still contain the two upper triangle halves
    expect(hasTriangle(newGeometry, vertices, 0, 1, 2)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 0, 3, 1)).toBe(true);

    // geometry should not contain the whole lower triangle anymore
    expect(hasTriangle(newGeometry, vertices, 2, 4, 3)).toBe(false);

    // geometry should instead contain two lower triangle halves
    expect(hasTriangle(newGeometry, vertices, 0, 2, 4)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 3, 0, 4)).toBe(true);

    expect(newGeometry.index.array.length).toBe(12);
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
test('splitEdgesAtVertices: ignore hole', () => {
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

    const newGeometry = splitEdgesAtVertices(geometry, 0.0001);

    // triangles shouldn't have changed
    expect(hasTriangle(newGeometry, vertices, 0, 1, 2)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 0, 3, 1)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 2, 5, 4)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 3, 4, 6)).toBe(true);

    expect(newGeometry.index.array.length).toBe(12);
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
test('splitEdgesAtVertices: remove and split at flat triangle', () => {
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

    const newGeometry = splitEdgesAtVertices(geometry, 0.0001);

    // TODO awkward... best solution would be to only delete the flat triangle
    expect(hasTriangle(newGeometry, vertices, 1, 2, 3)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 2, 4, 3)).toBe(true);

    expect(newGeometry.index.array.length).toBe(6);
});


/**
 *   /1\           /1\
 *  /   \         / | \
 * 2--0--3  ==>  2--0--3
 *   / \           / \
 *  4---5         4---5
 */
test('splitEdgesAtVertices: 2 triangles -> 3 triangles', () => {
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

    const newGeometry = splitEdgesAtVertices(geometry, 0.0001);

    // geometry should still contain the lower triangle
    expect(hasTriangle(newGeometry, vertices, 0, 4, 5)).toBe(true);

    // geometry should not contain the whole upper triangle anymore
    expect(hasTriangle(newGeometry, vertices, 1, 2, 3)).toBe(false);

    // geometry should instead contain two upper triangle halves
    expect(hasTriangle(newGeometry, vertices, 0, 1, 2)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 0, 3, 1)).toBe(true);

    expect(newGeometry.index.array.length).toBe(9);
});


/**
 *   /2\
 *  /   \
 * 01----3
 *  \   /
 *   \4/
 */
test('splitEdgesAtVertices: too close to split', () => {
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

    const newGeometry = splitEdgesAtVertices(geometry, 0.0001);

    console.log(newGeometry.index.array);

    expect(hasTriangle(newGeometry, vertices, 0, 3, 2)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 1, 4, 3)).toBe(true);

    expect(newGeometry.index.array.length).toBe(6);
});


/**
 *   /2\           /2\
 *  /   \         / / \
 * 0-1---3  ==>  0-1---3
 *   |  /          |  /
 *   |4/           |4/
 */
test('splitEdgesAtVertices: just far enough to split', () => {
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

    const newGeometry = splitEdgesAtVertices(geometry, 0.0001);

    // geometry should still contain the lower triangle
    expect(hasTriangle(newGeometry, vertices, 1, 4, 3)).toBe(true);

    // geometry should not contain the upper triangle anymore
    expect(hasTriangle(newGeometry, vertices, 0, 3, 2)).toBe(false);

    // geometry should instead contain two upper triangle halves
    expect(hasTriangle(newGeometry, vertices, 0, 1, 2)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 1, 3, 2)).toBe(true);

    expect(newGeometry.index.array.length).toBe(9);
});


/**
 *   /1\            /1\    
 *  / | \          / | \   
 * 2  0--3--5 ==> 2--0--3--5
 *  \ |    /       \ | /  /
 *   \4 /           \4 /
 */
test('splitEdgesAtVertices: 3 triangles -> 5 triangles', () => {
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

    const newGeometry = splitEdgesAtVertices(geometry, 0.0001);

    // geometry should still contain the upper right triangle
    expect(hasTriangle(newGeometry, vertices, 0, 3, 1)).toBe(true);

    // geometry should not contain the left and lower right triangles anymore
    expect(hasTriangle(newGeometry, vertices, 1, 2, 4)).toBe(false);
    expect(hasTriangle(newGeometry, vertices, 0, 4, 5)).toBe(false);

    // geometry should instead contain two left and lower right triangle halves, respectively

    expect(hasTriangle(newGeometry, vertices, 0, 1, 2)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 0, 2, 4)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 0, 4, 3)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 3, 4, 5)).toBe(true);

    expect(newGeometry.index.array.length).toBe(15);
});


/**
 *      4                4
 *    /   \            // \\
 *  /       \        / /   \ \
 * 0--1---2--3  ==> 0--1---2--3
 *   /|   |\          /|   |\
 *  6-5   7-8        6-5   7-8
 */
test('splitEdgesAtVertices: two splits along one edge', () => {
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

    const newGeometry = splitEdgesAtVertices(geometry, 0.0001);

    // geometry should still contain the lower triangles
    expect(hasTriangle(newGeometry, vertices, 1, 6, 5)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 2, 7, 8)).toBe(true);

    // geometry should not contain the whole upper triangle anymore
    expect(hasTriangle(newGeometry, vertices, 0, 3, 4)).toBe(false);

    // geometry should instead contain three upper triangle parts
    expect(hasTriangle(newGeometry, vertices, 0, 1, 4)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 1, 2, 4)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 2, 3, 4)).toBe(true);

    expect(newGeometry.index.array.length).toBe(15);
});


/**
 *   1
 *  /|\
 * 2-0-3
 * 
 * 0, 2, 3 is a collapsed triangle
 */
test('splitEdgesAtVertices: remove collapsed triangle', () => {
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

    const newGeometry = splitEdgesAtVertices(geometry, 0.0001);

    // geometry should still contain the two proper triangles
    expect(hasTriangle(newGeometry, vertices, 0, 1, 2)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 0, 3, 1)).toBe(true);

    expect(newGeometry.index.array.length).toBe(6);
});


/**
 *    /4\            /4\
 *   /   \          // \\
 *  /     \        / / \ \
 * 0-1---2-3  ==> 0-1---2-3
 *    \ /            \ /
 *     5              5
 */
test('splitEdgesAtVertices: 2 triangles -> 4 triangles', () => {
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

    const newGeometry = splitEdgesAtVertices(geometry, 0.0001);

    // geometry should still contain the lower triangle
    expect(hasTriangle(newGeometry, vertices, 1, 5, 2)).toBe(true);

    // geometry should not contain the upper triangle anymore
    expect(hasTriangle(newGeometry, vertices, 0, 3, 4)).toBe(false);

    // geometry should instead contain three upper triangle parts
    expect(hasTriangle(newGeometry, vertices, 0, 1, 4)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 1, 2, 4)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 2, 3, 4)).toBe(true);

    expect(newGeometry.index.array.length).toBe(12);
});


/**
 *    0\            0\
 *    | \           | \
 * 5--1  \  ==>  5--1\ \
 * | /|   \      | /|\ \\
 * 6  2-3-4      6  2-3-4
 *     / \           / \
 *    7---8         7---8
 */
test('splitEdgesAtVertices: one triangle is split on two different edges', () => {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
        0.0, 2.0, 0.0,   // 0
        0.0, 1.0, 0.0,   // 1
        0.0, 0.0, 0.0,   // 2
        1.0, 0.0, 0.0,   // 3
        2.0, 0.0, 0.0,   // 4
        -1.0, 1.0, 0.0,  // 5
        -1.0, 0.0, 0.0,  // 6
        0.0, -1.0, 0.0,  // 7
        2.0, -1.0, 0.0,  // 8
    ]);
    const indices = [0, 2, 4,    1, 5, 6,    3, 7, 8];
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    const newGeometry = splitEdgesAtVertices(geometry, 0.0001);

    // geometry should still contain the left and the lower triangles
    expect(hasTriangle(newGeometry, vertices, 1, 5, 6)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 3, 7, 8)).toBe(true);

    // geometry should not contain the center triangle anymore
    expect(hasTriangle(newGeometry, vertices, 0, 2, 4)).toBe(false);

    // geometry should instead contain three split triangles
    expect(hasTriangle(newGeometry, vertices, 0, 1, 4)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 1, 3, 4)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 1, 2, 3)).toBe(true);

    expect(newGeometry.index.array.length).toBe(15);
});


/**
 *      /0\
 * 7---1   6---9
 *  \2/-3-4-\5/
 *      \8/
 */
test('splitEdgesAtVertices: one triangle is split on all three edges', () => {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
        0.0, 2.0, 0.0,   // 0
        -1.0, 1.0, 0.0,  // 1
        -2.0, 0.0, 0.0,  // 2
        -1.0, 0.0, 0.0,  // 3
        1.0, 0.0, 0.0,   // 4
        2.0, 0.0, 0.0,   // 5
        1.0, 1.0, 0.0,   // 6
        -3.0, 1.0, 0.0,  // 7
        0.0, -1.0, 0.0,  // 8
        3.0, 1.0, 0.0,   // 9
    ]);
    const indices = [0, 2, 5,    1, 7, 2,    6, 5, 9,    3, 8, 4];
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setIndex(indices);

    const newGeometry = splitEdgesAtVertices(geometry, 0.0001);

    // geometry should still contain all outer triangles
    expect(hasTriangle(newGeometry, vertices, 1, 7, 2)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 6, 5, 9)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 3, 8, 4)).toBe(true);

    // geometry should not contain the center triangle anymore
    expect(hasTriangle(newGeometry, vertices, 0, 2, 5)).toBe(false);

    // geometry should instead contain 5 split triangles
    expect(hasTriangle(newGeometry, vertices, 1, 2, 3)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 1, 3, 4)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 1, 4, 5)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 1, 5, 6)).toBe(true);
    expect(hasTriangle(newGeometry, vertices, 1, 6, 0)).toBe(true);

    expect(newGeometry.index.array.length).toBe(24);
});


/**
 * Checks for existence of a triangle in the new geometry (in any order preserving correct winding).
 * @param {*} geometry New geometry
 * @param {*} vertices Old vertex positions
 * @param {*} u Old vertex index
 * @param {*} v Old vertex index
 * @param {*} w Old vertex index
 */
function hasTriangle(geometry, vertices, u, v, w) {
    const vertex1 = new THREE.Vector3().fromArray(vertices, 3 * u);
    const vertex2 = new THREE.Vector3().fromArray(vertices, 3 * v);
    const vertex3 = new THREE.Vector3().fromArray(vertices, 3 * w);

    for (let i = 0; i < geometry.index.count; i += 3) {
        const i1 = geometry.index.array[i];
        const i2 = geometry.index.array[i + 1];
        const i3 = geometry.index.array[i + 2];

        const pos = geometry.attributes.position;
        const gVertex1 = new THREE.Vector3().fromBufferAttribute(pos, i1);
        const gVertex2 = new THREE.Vector3().fromBufferAttribute(pos, i2);
        const gVertex3 = new THREE.Vector3().fromBufferAttribute(pos, i3);

        if (
            (gVertex1.equals(vertex1) && gVertex2.equals(vertex2) && gVertex3.equals(vertex3)) ||
            (gVertex1.equals(vertex2) && gVertex2.equals(vertex3) && gVertex3.equals(vertex1)) ||
            (gVertex1.equals(vertex3) && gVertex2.equals(vertex1) && gVertex3.equals(vertex2))
        ) {
            return true;
        }
    }

    return false;
}
