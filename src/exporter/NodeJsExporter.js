import * as THREE from 'three';
import * as fs from 'node:fs';


/**
 * Exports a geometry object in X3D format. Needs Node.js to access file system. Use HtmlExporter when runnning in a browser.
 * @param {THREE.BufferGeometry} geometry 
 * @param {string} filename 
 */
export function exportGeometry(geometry, filename = 'geometry.x3d') {
    const coordIndex = [];
    if (geometry.index) {
        for (let i = 0; i < geometry.index.count; i += 3) {
            coordIndex.push(geometry.index.array[i], geometry.index.array[i + 1], geometry.index.array[i + 2], -1);
        }
    } else {
        for (let i = 0; i < geometry.attributes.position.count; i += 3) {
            coordIndex.push(i, i + 1, i + 2, -1);
        }
    }
    const coordIndexStr = coordIndex.join(" ");

    const point = [...geometry.attributes.position.array];
    const pointStr = point.join(" ");

    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 3.0//EN" "http://www.web3d.org/specifications/x3d-3.0.dtd">
<X3D version="3.0">
  <Scene>
    <Shape>
      <IndexedFaceSet solid="false"
              coordIndex="${coordIndexStr} "
              >
        <Coordinate DEF="coords_ME_Cube"
              point="${pointStr} "
              />
      </IndexedFaceSet>
    </Shape>
  </Scene>
</X3D>`;

    fs.writeFileSync(filename, content);
}
