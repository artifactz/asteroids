import Ammo from 'ammo.js';
import * as THREE from 'three';
import { iteratePoints } from './GeometryUtils.js';


/**
 * Handles mesh movement in one of three ways:
 * * add(enableAmmo = true) -- Mesh is moved according to ammo.js, collisions enabled.
 * * add(enableAmmo = false) -- Mesh is moved according to userData values, collisions disabled.
 * * player -- Mesh is moved according to userData values but it also exists in ammo.js, where its state is adopted from
 *   userData before every step, collisions enabled.
 * 
 * NOTE: There seems to be a memory leak caused by ammo.js. It is currently unclear which objects to Ammo.destroy().
 */
export class Physics {
    constructor() {
        const collisionConfig = new Ammo.btDefaultCollisionConfiguration();
        this.ammoWorld = new Ammo.btDiscreteDynamicsWorld(
            new Ammo.btCollisionDispatcher(collisionConfig),
            new Ammo.btDbvtBroadphase(),
            new Ammo.btSequentialImpulseConstraintSolver(),
            collisionConfig
        );
        this.ammoWorld.setGravity(new Ammo.btVector3(0, 0, 0));  // No gravity in space

        this.meshes = new Map();
        this.meshesByAmmoId = new Map();
    }

    setPlayer(player) {
        this.player = player;
        this.enableAmmo(player, { mass: this.player.userData.mass });
    }

    /**
     * 
     * @param {*} mesh 
     * @param {*} param1 
     * @param {*} enableAmmo 
     * @param {*} easeInSeconds 
     * @returns 
     */
    add(mesh, { mass = 1, restitution = 0.999, friction = 0, rollingFriction = 1, dampingA = 0, dampingB = 0 } = {}, enableAmmo = true, easeInSeconds = 0) {
        if (this.meshes.has(mesh)) { return; }

        // Collisions between objects in ease-in stage are disabled
        mesh.userData.physicsAge = 0;
        mesh.userData.physicsEaseInSeconds = Math.max(0, easeInSeconds);

        if (enableAmmo) {
            const [group, mask] = (easeInSeconds > 0) ? [2, 1] : [1, 1 | 2];
            this.enableAmmo(mesh, { mass, restitution, friction, rollingFriction, dampingA, dampingB, group, mask });
        }

        this.meshes.set(mesh, enableAmmo);
    }

    /**
     * Enables ammo.js physics for a mesh.
     */
    enableAmmo(mesh, { mass = 1, restitution = 0.999, friction = 0, rollingFriction = 0, dampingA = 0, dampingB = 0, group = 1, mask = 1 } = {}) {
        console.time('enableAmmo');

        const shape = shapeFromMesh(mesh);
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(mesh.position.x, mesh.position.y, mesh.position.z));
        const quaternion = new THREE.Quaternion().setFromEuler(mesh.rotation);
        transform.setRotation(new Ammo.btQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w));
        const motionState = new Ammo.btDefaultMotionState(transform);

        const localInertia = new Ammo.btVector3(0, 0, 0);
        shape.calculateLocalInertia(1000 * mass, localInertia);

        const rbInfo = new Ammo.btRigidBodyConstructionInfo(1000 * mass, motionState, shape, localInertia);
        const body = new Ammo.btRigidBody(rbInfo);

        body.setLinearVelocity(new Ammo.btVector3(mesh.userData.velocity.x, mesh.userData.velocity.y, mesh.userData.velocity.z));
        body.setAngularVelocity(new Ammo.btVector3(mesh.userData.rotationalVelocity.x, mesh.userData.rotationalVelocity.y, mesh.userData.rotationalVelocity.z));

        body.setActivationState(4);  // DISABLE_DEACTIVATION

        body.setRestitution(restitution);
        body.setFriction(friction);
        body.setRollingFriction(rollingFriction);
        body.setDamping(dampingA, dampingB);

        this.ammoWorld.addRigidBody(body, group, mask);
        mesh.userData.collisionAge = 0;
        mesh.userData.physicsBody = body;
        this.meshesByAmmoId.set(body.ptr, mesh);

        console.timeEnd('enableAmmo');
    }

    /**
     * Takes back control from ammo.js.
     */
    disableAmmo(mesh) {
        const body = mesh.userData.physicsBody;
        if (!body) { return; }

        this.storeMeshPhysicsVelocity(mesh);
        this.ammoWorld.removeRigidBody(body);
        this.meshesByAmmoId.delete(body.ptr);
        Ammo.destroy(body);
        mesh.userData.physicsBody = null;
    }

    remove(mesh) {
        this.disableAmmo(mesh);
        this.meshes.delete(mesh);
    }

    /**
     * Performs a step.
     * @param {number} dt Time delta.
     */
    update(dt) {
        for (const mesh of this.meshes.keys()) { this.storeMeshPhysicsVelocity(mesh); }
        this.updatePlayerPhysics(dt);
        this.ammoWorld.stepSimulation(dt, 10);
        this.movePlayer(dt);
        this.updateMeshes(dt);
        this.handleCollisions();
    }

    storeMeshPhysicsVelocity(mesh) {
        if (!mesh.userData.physicsBody) { return; }
        const vel = mesh.userData.physicsBody.getLinearVelocity();
        const rotVel = mesh.userData.physicsBody.getAngularVelocity();
        mesh.userData.velocity.set(vel.x(), vel.y(), vel.z());
        mesh.userData.rotationalVelocity.set(rotVel.x(), rotVel.y(), rotVel.z());
    }

    updatePlayerPhysics(dt) {
        if (!this.player) { return; }

        this.player.userData.speed += this.player.userData.accel * dt;
        this.player.userData.speed = Math.max(-this.player.userData.maxSpeed, Math.min(this.player.userData.speed, this.player.userData.maxSpeed));

        // Update physics state from mesh values for proper collision detection
        if (!this.player.userData.physicsBody) { return; }

        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(this.player.position.x, this.player.position.y, this.player.position.z));
        const quaternion = new THREE.Quaternion().setFromEuler(this.player.rotation);
        transform.setRotation(new Ammo.btQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w));
        this.player.userData.physicsBody.setMotionState(new Ammo.btDefaultMotionState(transform));
        this.player.userData.physicsBody.setLinearVelocity(new Ammo.btVector3(this.player.userData.velocity.x, this.player.userData.velocity.y, this.player.userData.velocity.z));
        this.player.userData.physicsBody.setAngularVelocity(new Ammo.btVector3(this.player.userData.rotationalVelocity.x, this.player.userData.rotationalVelocity.y, this.player.userData.rotationalVelocity.z));
        Ammo.destroy(transform);
    }

    movePlayer(dt) {
        if (!this.player) { return; }

        // Handle movement at mesh level
        this.player.position.set(
            this.player.position.x + dt * Math.cos(this.player.rotation.z) * this.player.userData.speed,
            this.player.position.y + dt * Math.sin(this.player.rotation.z) * this.player.userData.speed,
            0
        );
    }

    updateMeshes(dt) {
        for (const [mesh, isAmmoPhysics] of this.meshes.entries()) {
            mesh.userData.physicsAge += dt;

            if (!isAmmoPhysics || !this.updateAmmoMesh(mesh, dt)) {
                this.updateBasicMesh(mesh, dt);
            }

            mesh.userData.isColliding = false;
        }
    }

    /**
     * Updates mesh position and orientation from its physics state. Updates physics state to steer toward z=0.
     * @param {*} mesh
     * @returns {boolean} True if mesh was updated, false if not.
     */
    updateAmmoMesh(mesh, dt) {
        const body = mesh.userData.physicsBody;
        if (!body) { return false; }

        if (mesh.userData.physicsEaseInSeconds > 0 && mesh.userData.physicsAge > mesh.userData.physicsEaseInSeconds) {
            this.ammoWorld.removeRigidBody(body);
            this.ammoWorld.addRigidBody(body, 1, 1 | 2);
            mesh.userData.physicsEaseInSeconds = 0;
        }

        const ms = body.getMotionState();
        if (!ms) { return false; }

        if (mesh.userData.isColliding) {
            mesh.userData.collisionAge = 0;
        } else {
            mesh.userData.collisionAge += dt;
        }

        const transform = new Ammo.btTransform();
        ms.getWorldTransform(transform);
        const p = transform.getOrigin();
        const q = transform.getRotation();

        if (mesh.userData.collisionAge > 0.2) {
            // Steer toward z = 0 using PD controller
            const vel = body.getLinearVelocity();
            const controlP = 1, controlD = 0.5;
            vel.setZ(vel.z() - (controlP * p.z() + controlD * vel.z()) * dt);
            body.setLinearVelocity(vel);
            Ammo.destroy(vel);
        }

        mesh.position.set(p.x(), p.y(), p.z());
        mesh.quaternion.set(q.x(), q.y(), q.z(), q.w());

        Ammo.destroy(transform);

        return true;
    }

    updateBasicMesh(mesh, dt) {
        mesh.position.addScaledVector(mesh.userData.velocity, dt);
        if (mesh.userData.collisionAge > 0.2) {
            // Steer toward z = 0 using PD controller
            const controlP = 1, controlD = 0.5;
            mesh.userData.velocity.z -= (controlP * mesh.position.z + controlD * mesh.userData.velocity.z) * dt;
        }
        applyRotation(mesh, dt);
    }

    handleCollisions() {
        const dispatcher  = this.ammoWorld.getDispatcher();
        const numManifolds = dispatcher.getNumManifolds();

        for (let i = 0; i < numManifolds; i++) {
            const manifold = dispatcher.getManifoldByIndexInternal(i);
            const numPoints = manifold.getNumContacts();

            if (numPoints > 0) {
                const objA = manifold.getBody0();
                const objB = manifold.getBody1();

                const ammoContactPoints = manifold.getContactPoint(0);
                const ammoContactPointA = ammoContactPoints.getPositionWorldOnA();
                const ammoContactPointB = ammoContactPoints.getPositionWorldOnB();
                const contactPointA = new THREE.Vector3(ammoContactPointA.x(), ammoContactPointA.y(), ammoContactPointA.z());
                const contactPointB = new THREE.Vector3(ammoContactPointB.x(), ammoContactPointB.y(), ammoContactPointB.z());
                // // pt.getDistance()

                const meshA = this.meshesByAmmoId.get(objA.ptr);
                const meshB = this.meshesByAmmoId.get(objB.ptr);
                meshA.userData.isColliding = true;
                meshB.userData.isColliding = true;

                const velA = meshA.userData.physicsBody.getLinearVelocity();
                const velB = meshB.userData.physicsBody.getLinearVelocity();
                const impulseA = new THREE.Vector3(velA.x() - meshA.userData.velocity.x, velA.y() - meshA.userData.velocity.y, velA.z() - meshA.userData.velocity.z);
                const impulseB = new THREE.Vector3(velB.x() - meshB.userData.velocity.x, velB.y() - meshB.userData.velocity.y, velB.z() - meshB.userData.velocity.z);

                if (meshA.userData.handleCollision) { meshA.userData.handleCollision(meshB, contactPointA, impulseA, impulseB); }
                if (meshB.userData.handleCollision) { meshB.userData.handleCollision(meshA, contactPointB, impulseB, impulseA); }
            }
        }
    }
}

function applyRotation(mesh, dt) {
    const angle = mesh.userData.rotationalVelocity.length() * dt;
    const axis = mesh.userData.rotationalVelocity.clone().normalize();
    const deltaQuat = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    mesh.quaternion.multiplyQuaternions(deltaQuat, mesh.quaternion);
}

/**
 * Generates an ammo.js shape from a THREE.js mesh.
 * @param {THREE.Mesh} mesh 
 * @returns {Ammo.btConvexHullShape}
 */
function shapeFromMesh(mesh) {
    const shape = new Ammo.btConvexHullShape();
    shape.setMargin(0);

    let vertex = null;
    for (const vector of iteratePoints(mesh)) {
        if (vertex) {
            // Add point but skip "recalculateLocalAabb"
            shape.addPoint(vertex, false);
        } else {
            vertex = new Ammo.btVector3();
        }
        vertex.setValue(vector.x, vector.y, vector.z);
    }

    // Add last point and do the heavy "recalculateLocalAabb" calculation finalize the shape
    shape.addPoint(vertex, true);
    Ammo.destroy(vertex);

    return shape;
}
