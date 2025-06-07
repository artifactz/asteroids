import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';


/**
 * Exports a scene in GLTF format. Needs DOM, so it only works in a browser. Use NodeJsExporter when runnning via node.
 * @param {THREE.Scene} scene 
 * @param {string} filename 
 */
export function exportScene(scene, filename = 'scene.gltf') {
    const exporter = new GLTFExporter();
    exporter.parse(scene, function(gltf) {
        const json = JSON.stringify(gltf, null, 2);
        const blob = new Blob([json]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
    });
}
