import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { SUBTRACTION, INTERSECTION, Brush, Evaluator } from 'three-bvh-csg';
import { ParticleSystem } from './Particles.js';
import { GeometryManipulator, simplifyGeometry, printDuplicateTriangles, printCollapsedTriangles } from './GeometryUtils.js';


export class World {
    constructor() {
        this.scene = new THREE.Scene();
        this.clearColor = new THREE.Color(0x000000);

        this.camera = this.createCamera();
        this.addDefaultLights();
        this.addPreliminaryBackground();
        this.player = createPlayer();
        this.scene.add(this.player);

        this.asteroids = [createAsteroid()];
        this.asteroids[0].position.set(3, 1, 0);
        this.scene.add(this.asteroids[0]);

        this.lasers = [];
        this.particles = new ParticleSystem(this.scene);
    }

    createCamera() {
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(0, 0, 10);
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, 0);
        camera.userData.slackPerSecond = 0.001;
        return camera;
    }

    addDefaultLights() {
        const dLight = new THREE.DirectionalLight(0xffffff, 1);
        dLight.position.set(5, 5, 10);
        const aLight = new THREE.AmbientLight(0x707070);
        this.scene.add(dLight);
        this.scene.add(aLight);
    }

    addPreliminaryBackground() {
        this.scene.add(createUniverse());
        this.scene.add(createUniverse2());
        this.scene.add(createUniverse3());
        this.scene.add(createUniverse4());
        this.scene.add(createUniverse5());
        this.brightStar = createUniverse6();
        this.scene.add(this.brightStar);
    }

    createLaser(position, angle, speed = 14.4, length = 0.5, radius = 0.02, ttl = 3) {
        const geo = new THREE.CylinderGeometry(radius, radius, length);
        geo.rotateZ(Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const laser = new THREE.Mesh(geo, mat);
        laser.rotation.z = angle;
        laser.position.set(position.x, position.y, 0);
        laser.userData.velocity = new THREE.Vector2(Math.cos(angle), Math.sin(angle)).multiplyScalar(speed);
        laser.userData.length = length;
        laser.userData.radius = radius;
        laser.userData.ttl = ttl;

        const light = new THREE.PointLight(0xff6666, 1, 20);
        light.position.copy(laser.position);
        laser.userData.light = light;

        this.lasers.push(laser);
        this.scene.add(light);
        this.scene.add(laser);

        return laser;
    }

    splitAsteroid(asteroid, laser) {
        const dir = new THREE.Vector3(laser.userData.velocity.x, laser.userData.velocity.y, 0).normalize();
        const boxSize = 2.0 * asteroid.userData.diameter;

        const cutterGeo = buildNoisyCutter(boxSize);
        cutterGeo.translate(0.5 * boxSize, 0.0, 0.0);
        const laserRotation = Math.atan2(laser.userData.velocity.y, laser.userData.velocity.x);
        cutterGeo.rotateZ(laserRotation + 0.5 * Math.PI);

        const brush1 = new Brush(asteroid.geometry);
        brush1.position.copy(asteroid.position);
        brush1.rotation.copy(asteroid.rotation);
        brush1.updateMatrixWorld();

        const brush2 = new Brush(cutterGeo);
        brush2.position.copy(laser.position);
        brush2.position.addScaledVector(dir, 0.5 * asteroid.userData.diameter);
        brush2.updateMatrixWorld();

        const evaluator = new Evaluator();
        evaluator.attributes = ["position", "normal"];
        const A = evaluator.evaluate( brush1, brush2, SUBTRACTION );
        const B = evaluator.evaluate( brush1, brush2, INTERSECTION );

        let sign = 1;
        [A, B].forEach(brush => {
            // printDuplicateTriangles(brush.geometry);

            const cleanGeo = new GeometryManipulator(BufferGeometryUtils.mergeVertices(brush.geometry, 0.0001)).splitTrianglesOnTouchingVertices();
            // TODO replace with simplifyGeometry
            const geo = BufferGeometryUtils.mergeVertices(cleanGeo, 0.01);

            // printCollapsedTriangles(geo);

            geo.translate(-asteroid.position.x, -asteroid.position.y, -asteroid.position.z);
            geo.computeBoundingBox();
            const t = geo.boundingBox.getCenter(new THREE.Vector3());
            geo.translate(-t.x, -t.y, -t.z);
            const mesh = new THREE.Mesh(geo, defaultAsteroidMat);
            mesh.position.copy(asteroid.position).add(t);

            mesh.userData.velocity = new THREE.Vector2(Math.cos(laserRotation - sign * 0.5 * Math.PI) * 0.15, Math.sin(laserRotation - sign * 0.5 * Math.PI) * 0.15);
            mesh.userData.rotationalVelocity = new THREE.Vector2((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3);
            mesh.userData.diameter = getDiameter(geo);
            sign *= -1;

            mesh.geometry.setIndex(new GeometryManipulator(geo).removeCollapsedTriangles());
            geo.computeVertexNormals();

            this.scene.add(mesh);
            this.asteroids.push(mesh);
        });

        this.scene.remove(asteroid);
        this.asteroids = this.asteroids.filter(a => a !== asteroid);
    }
}


const defaultAsteroidMat = new THREE.MeshStandardMaterial({ color: 0x888888, flatShading: true });

export function createAsteroid(radius = 0.9) {
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
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, defaultAsteroidMat);
    mesh.userData.velocity = new THREE.Vector2(0, 0);
    mesh.userData.rotationalVelocity = new THREE.Vector2(0.15, 0.05);
    mesh.userData.diameter = getDiameter(geo);
    return mesh;
}

export function createPlayer() {
    const geo = new THREE.BufferGeometry();
    geo.setFromPoints([
        new THREE.Vector3(0.2, 0, 0),
        new THREE.Vector3(-0.2, 0.1, 0),
        new THREE.Vector3(-0.2, -0.1, 0),
    ]);
    geo.setIndex([0, 1, 2]);
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const player = new THREE.Mesh(geo, mat);
    player.userData.speed = 4.2;
    player.userData.rotationalSpeed = 4.2;
    return player;
}

function createUniverse() {
    const geo = new THREE.PlaneGeometry(300, 300);
    const texture = generateStarTexture({ minRadius: 1.2, maxRadius: 1.5, starCount: 100 });
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true });
    const universe = new THREE.Mesh(geo, material);
    universe.position.z = -140;
    return universe;
}

function createUniverse2() {
    const geo = new THREE.PlaneGeometry(600, 600);
    const texture = generateStarTexture({ minRadius: 0.8, maxRadius: 1.2, starCount: 800 });
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true });
    const universe = new THREE.Mesh(geo, material);
    universe.position.z = -210;
    return universe;
}

function createUniverse3() {
    const geo = new THREE.PlaneGeometry(900, 900);
    const texture = generateStarTexture({
        minRadius: 0.45, maxRadius: 0.8, starCount: 1200,
        minRed: 100, maxRed: 255,
        minGreen: 175, maxGreen: 175,
        minBlue: 100, maxBlue: 255,
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true });
    const universe = new THREE.Mesh(geo, material);
    universe.position.z = -300;
    return universe;
}

function createUniverse4() {
    const geo = new THREE.PlaneGeometry(1200, 1200);
    const texture = generateStarTexture({
        minRadius: 0.25, maxRadius: 0.45, starCount: 10000, minBrightness: 0.3, maxBrightness: 1.0,
        minRed: 100, maxRed: 255,
        minGreen: 160, maxGreen: 175,
        minBlue: 100, maxBlue: 255,
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true });
    const universe = new THREE.Mesh(geo, material);
    universe.position.z = -400;
    return universe;
}

function createUniverse5(starCount = 2500, minZ = -350, maxZ = -90) {
    const positions = [];

    for (let i = 0; i < starCount; i++) {
        const z = minZ + Math.random() * (maxZ - minZ);
        const x = -z * 3.5 * (Math.random() - 0.5)
        const y = -z * 3.5 * (Math.random() - 0.5)
        positions.push(x, y, z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.5,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    const stars = new THREE.Points(geometry, material);

    return stars;
}

function createUniverse6() {
    const geo = new THREE.PlaneGeometry(55, 55);
    const textureLoader = new THREE.TextureLoader()
    const texture = textureLoader.load('/media/bright_star.png');
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, blending: THREE.AdditiveBlending, transparent: true });
    const universe = new THREE.Mesh(geo, material);
    universe.position.set(10, 15, -50);
    return universe;
}

function generateStarTexture({
    size = 1536,
    starCount = 500,
    minRadius = 0.5,
    maxRadius = 2.5,
    minBrightness = 0.8,
    maxBrightness = 1.0,
    minRed = 255,
    maxRed = 255,
    minGreen = 255,
    maxGreen = 255,
    minBlue = 255,
    maxBlue = 255,
    bgColor = "black",
} = {}) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;

    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size, size);

    // Draw stars
    for (let i = 0; i < starCount; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const radius = minRadius + Math.random() * (maxRadius - minRadius);

        const alpha = minBrightness + Math.random() * (maxBrightness - minBrightness);

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        const r = minRed + Math.random() * (maxRed - minRed);
        const g = minGreen + Math.random() * (maxGreen - minGreen);
        const b = minBlue + Math.random() * (maxBlue - minBlue);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.fill();
    }

    return new THREE.CanvasTexture(canvas);
}

function buildNoisyCutter(boxSize, resolution = 15, amplitude = 0.1) {
    const front = new THREE.PlaneGeometry(boxSize, boxSize);
    front.translate(0, 0, 0.5 * boxSize);
    const right = new THREE.BufferGeometry().copy(front);
    right.rotateY(0.5 * Math.PI);
    const back = new THREE.BufferGeometry().copy(front);
    back.rotateY(Math.PI);
    const top = new THREE.BufferGeometry().copy(front);
    top.rotateX(-0.5 * Math.PI);
    const bottom = new THREE.BufferGeometry().copy(front);
    bottom.rotateX(0.5 * Math.PI);

    const crack = createCrackPlane(boxSize, boxSize, resolution, amplitude);

    // Position the plane where the left face would be
    crack.rotateY(-Math.PI / 2);
    crack.translate(-0.5 * boxSize, 0, 0);

    // Merge box and noisy crack
    const merged = BufferGeometryUtils.mergeGeometries([front, right, back, top, bottom, crack]);
    return merged
}

function createCrackPlane(width = 1.0, height = 1.0, segments = 20, amplitude = 0.1) {
    const plane = new THREE.PlaneGeometry(width, height, segments, segments);
    const pos = plane.attributes.position;

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);

        // Keep edges straight
        if (Math.abs(x + 0.5 * width) < 1e-4 || Math.abs(x - 0.5 * width) < 1e-4 || Math.abs(y + 0.5 * height) < 1e-4 || Math.abs(y - 0.5 * height) < 1e-4) {
            continue;
        }

        const noise = amplitude * (Math.random() - 0.5);

        pos.setZ(i, noise); // displace along Z-axis
    }

    plane.computeVertexNormals();
    return plane;
}

export function checkLaserHit(laser, asteroids) {
    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;

    const dir = new THREE.Vector3(laser.userData.velocity.x, laser.userData.velocity.y, 0).normalize();
    const origin = new THREE.Vector3().copy(laser.position).addScaledVector(dir, -0.5 * laser.userData.length);

    raycaster.set(origin, dir);
    raycaster.far = laser.userData.length;

    for (const asteroid of asteroids) {
        const intersects = raycaster.intersectObject(asteroid, true);
        if (intersects.length > 0) {
            return { asteroid, intersection: intersects[0] };
        }
    }

    return null;
}

function getDiameter(geometry) {
    const pos = geometry.attributes.position;
    let maxDistSq = 0;
    for (let i = 0; i < pos.count; i++) {
        const p1 = new THREE.Vector3().fromBufferAttribute(pos, i);
        for (let j = 0; j < i; j++) {
            const p2 = new THREE.Vector3().fromBufferAttribute(pos, j);
            const distSq = p2.sub(p1).lengthSq();
            if (distSq > maxDistSq) {
                maxDistSq = distSq;
            }
        }
    }
    return Math.sqrt(maxDistSq);
}


const defaultNibbleRadius = 0.15;
const defaultNibbleDepth = 0.05;
const defaultNibbleGeometry = new THREE.IcosahedronGeometry(defaultNibbleRadius, 0);

export function nibbleAsteroid(asteroid, intersection, rx = null, ry = null, rz = null) {
    const brush1 = new Brush(asteroid.geometry);
    const brush2 = new Brush(defaultNibbleGeometry);
    const negativeNormalizedImpact = intersection.impact.clone().normalize().multiplyScalar(-1);
    brush2.position.copy(asteroid.worldToLocal(
        intersection.point.clone().add(negativeNormalizedImpact.multiplyScalar(defaultNibbleRadius - defaultNibbleDepth))
    ));
    rx = rx || Math.random() * 2 * Math.PI;
    ry = ry || Math.random() * 2 * Math.PI;
    rz = rz || Math.random() * 2 * Math.PI;

    brush2.rotation.set(rx, ry, rz);
    brush2.updateMatrixWorld();

    const evaluator = new Evaluator();
    evaluator.attributes = ["position"];
    const result = evaluator.evaluate(brush1, brush2, SUBTRACTION);
    let geo = result.geometry;

    // printDuplicateTriangles(geo);

    simplifyGeometry(geo, 0.0001);

    // printDuplicateTriangles(geo);

    geo = new GeometryManipulator(geo).splitTrianglesOnTouchingVertices();

    // printDuplicateTriangles(geo);  // <-- TODO this happens

    simplifyGeometry(geo, 0.04);

    // printDuplicateTriangles(geo);

    geo.computeVertexNormals();
    asteroid.geometry = geo;
}
