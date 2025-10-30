import * as THREE from 'three';
import { hidePause, showGameOver, showHighscores, showHud, showPause, showTutorial, updateMaterial, updateThrustBar } from './ui/Hud.js';
import { hidePingArrow, showPingArrow, updatePingArrow } from './ui/Ping.js';
import { fixCameraOnPlayer, moveCamera, rotateTowards, worldToScreen } from './Targeting.js';
import { World } from './world/World.js';
import * as Highscore from './Highscore.js';
import { GameControllerParameters } from './Parameters.js'


const GameState = {
    StartScreen: 1,
    Playing: 2,
    GameOverScreen: 3,
    HighscoresScreen: 4,
    Paused: 5,
};

export class GameController {
    /**
     * @param {World} world 
     */
    constructor(world) {
        this.world = world;
        this.prevState = null;
        this.state = GameState.StartScreen;
        this.isEaseInStage = false; // transition between StartScreen and Playing
        this.isStartAsteroidStage = false; // initial game stage in which to spawn an asteroid cluster
        this.startAsteroidAngles = []; // directions of already spawned asteroid clusters
        this.startAsteroidHeat = 0;
        this.asteroidSpawnProbability = 10.0; // resets to 0 at every spawn
        this.gameOverTimestamp = null; // avoids accidentally skipping Game Over screen when clicking furiously
        this.hasClickedGameOver = false; // handles delaying transition until receiving highscores
        this.pingController = new PingController(this);

        // Prepare start screen
        this.originalPlayerMaxSpeed = world.player.userData.maxSpeed;
        this.originalPlayerMaxRotationalSpeed = world.player.userData.maxRotationalSpeed;
        world.player.userData.maxSpeed = GameControllerParameters.startScreenPlayerSpeed;
        world.player.userData.speed = GameControllerParameters.startScreenPlayerSpeed;
        this.world.player.userData.maxRotationalSpeed = 0;
        world.player.rotation.z = -0.125 * Math.PI;
        this.playerRotation = 0;
        this.playerRotationChange = 0;
        this.playerRotationChangeHeat = -9000;
        this.world.player.userData.thrustOverride = 0.25;
    }

    update(keys, mouse, dt) {
        if (this.state == GameState.StartScreen && mouse[0]) {
            this.state = GameState.Playing;
            this.isEaseInStage = true;
            showHud();
            showTutorial();
            this.world.sounds.play("ambient", { loop: true });

        } else if (this.state == GameState.StartScreen) {
            // Title screen random steering
            if (this.playerRotationChangeHeat < -3) {
                this.playerRotationChangeHeat = 3 + 3 * Math.random();
                this.playerRotation = this.world.player.rotation.z;
                this.playerRotationChange = (0.5 + Math.random()) * (Math.random() < 0.5) ? 1 : -1;
            } else if (this.playerRotationChangeHeat >= -3 && this.playerRotationChangeHeat <= 0) {
                let t = -this.playerRotationChangeHeat / 3;
                t = 0.5 * Math.sin((t - 0.5) * Math.PI) + 0.5;
                this.world.player.rotation.z = this.playerRotation + this.playerRotationChange * t;
                this.world.player.userData.rotationalVelocity.z = 10.0 * this.playerRotationChange * Math.cos((t - 0.5) * Math.PI);
            }
            this.playerRotationChangeHeat -= dt;

        } else if (this.state == GameState.Playing && keys["escape"]) {
            keys["escape"] = false;
            this.state = GameState.Paused;
            showPause();

        } else if (this.state == GameState.Paused && keys["escape"]) {
            keys["escape"] = false;
            this.state = GameState.Playing;
            hidePause();

        } else if (this.state == GameState.Playing && !this.world.player.userData.isAlive) {
            this.state = GameState.GameOverScreen;
            this.gameOverTimestamp = this.world.time;
            Highscore.fetchHighscores();

        } else if (
            this.state == GameState.GameOverScreen && mouse[0] &&
            this.world.time > this.gameOverTimestamp + GameControllerParameters.gameOverDuration
        ) {
            this.hasClickedGameOver = true;

        } else if (
            this.state == GameState.GameOverScreen && this.hasClickedGameOver &&
            (Highscore.highscoreData || this.world.time > this.gameOverTimestamp + GameControllerParameters.highscoresTimeout)
        ) {
            this.state = GameState.HighscoresScreen;
            showHighscores(Highscore.highscoreData, this.world.player.userData.material);

        } else if (this.state == GameState.Playing) {
            if (mouse.positionWorld) { rotateTowards(this.world.player, mouse.positionWorld, dt); }

            if (this.isEaseInStage) {
                const decay = Math.pow(0.5, dt)
                this.world.player.userData.speed *= decay;

                const alpha = (this.world.player.userData.speed - this.originalPlayerMaxSpeed) / (GameControllerParameters.startScreenPlayerSpeed - this.originalPlayerMaxSpeed);
                this.world.player.userData.maxRotationalSpeed = (1 - alpha) * this.originalPlayerMaxRotationalSpeed;

                if (this.world.player.userData.speed <= this.originalPlayerMaxSpeed) {
                    this.world.player.userData.maxSpeed = this.originalPlayerMaxSpeed;
                    this.world.player.userData.thrustOverride = null;
                    this.isEaseInStage = false;
                    this.isStartAsteroidStage = true;
                }

            } else {
                if (keys['w']) {
                    this.world.player.userData.accel = this.world.player.userData.maxAccel;
                } else if (keys['s']) {
                    this.world.player.userData.accel = -this.world.player.userData.maxAccel;
                } else {
                    // Decelerate at half power
                    const delta = 0.5 * this.world.player.userData.maxAccel * dt;
                    if (Math.abs(this.world.player.userData.speed) < delta) {
                        this.world.player.userData.speed = 0;
                    } else {
                        this.world.player.userData.speed -= Math.sign(this.world.player.userData.speed) * delta;
                    }
                    this.world.player.userData.accel = 0;
                }
            }
        }

        this.world.updateTime(dt);
        if (this.state == GameState.Playing) {
            this.world.stations.update(this.world, dt);
        }

        this.maybeSpawnAsteroid(dt);
        this.steerAsteroids(dt);

        // Shoot
        if (this.state == GameState.Playing && mouse[0] && this.world.player.userData.laserHeat <= 0) {
            const noiseRad = (2 * Math.random() - 1) * this.world.player.userData.laserSpreadRad;
            this.world.createLaser(this.world.player.position, this.world.player.rotation.z + noiseRad, this.world.player.userData.laserSpeed + this.world.player.userData.speed);
            this.world.player.userData.laserHeat = this.world.player.userData.laserCooldownPeriod;
        }

        if (this.state != GameState.Paused) {
            this.world.physics.update(dt);
            this.world.updatePlayer(dt);
            this.world.updateAsteroids(dt);
            this.world.updateLasers(dt);
            this.world.updateDebris(dt);
            this.world.particles.update(dt);
            this.world.trail.update(this.world.time, dt);
            this.updateCamera(mouse, this.world.time, dt);
            this.world.updateUniverse();
            this.world.lights.update(dt);
        }

        // Update UI
        if (this.state == GameState.Playing) {
            const thrust = (this.isEaseInStage) ? 1 : this.world.player.userData.speed / this.world.player.userData.maxSpeed;
            updateThrustBar(thrust);
            updateMaterial(this.world.player.userData.material);
        }
        if (this.state == GameState.GameOverScreen && this.prevState == GameState.Playing) {
            showGameOver();
        }

        this.prevState = this.state;
    }

    /** Updates world-relative UI. */
    postRenderUpdate(keys) {
        this.pingController.update(keys);
    }

    updateCamera(mouse, time, dt) {
        if (this.state == GameState.Playing && mouse.positionWorld) {
            moveCamera(this.world, mouse.positionWorld, dt);
        } else if (this.state == GameState.StartScreen) {
            const dx = 1.337 * Math.cos(0.6 * time);
            const dy = Math.sin(0.52 * time) - 4;
            fixCameraOnPlayer(this.world, dx, dy);
        }
    }

    maybeSpawnAsteroid(dt) {
        if (this.state != GameState.Playing || this.isEaseInStage) { return; }

        if (this.isStartAsteroidStage) {
            // TODO might get surrounded this way...
            const angle = this.world.player.rotation.z;
            if (this.startAsteroidHeat <= 0 && this.isStartAsteroidAngleAvailable(angle)) {
                for (const deltaAngle of linspace(-0.1 * Math.PI, 0.1 * Math.PI, GameControllerParameters.numStartAsteroids)) {
                    const position = this.world.player.position.clone().add(new THREE.Vector3(
                        GameControllerParameters.asteroidSpawnDistance * Math.cos(angle + deltaAngle),
                        GameControllerParameters.asteroidSpawnDistance * Math.sin(angle + deltaAngle),
                        0
                    ));
                    const velocity = this.world.player.position.clone().sub(position).normalize().multiplyScalar(4);
                    this.world.spawnAsteroid(position, velocity);
                }
                this.startAsteroidAngles.push(angle);
                this.startAsteroidHeat = GameControllerParameters.startAsteroidCooldown;
            }

            const disableStartAsteroidsDistance = GameControllerParameters.asteroidSpawnDistance / 2;
            for (const asteroid of this.world.asteroids) {
                if (asteroid.position.clone().sub(this.world.player.position).lengthSq() < disableStartAsteroidsDistance * disableStartAsteroidsDistance) {
                    this.isStartAsteroidStage = false;
                    break;
                }
            }

            this.startAsteroidHeat -= dt;

            // Don't spawn random asteroids
            return;
        }

        this.asteroidSpawnProbability += GameControllerParameters.asteroidSpawnProbabilityGainPerSecond * dt;
        if (this.world.asteroids.length < GameControllerParameters.maxAsteroids && Math.random() < this.asteroidSpawnProbability * dt) {
            const { position, velocity } = getOrthogonalCollisionTrajectory(this.world.player, GameControllerParameters.asteroidSpawnDistance, 1);
            this.world.spawnAsteroid(position, velocity);
            this.asteroidSpawnProbability = 0;
        }
    }

    isStartAsteroidAngleAvailable(angle) {
        for (const existingAngle of this.startAsteroidAngles) {
            if (Math.abs(angleDifference(existingAngle, angle)) < 0.25 * Math.PI) { return false; }
        }
        return true;
    }

    steerAsteroids(dt) {
        if (this.state != GameState.Playing) { return; }

        for (const asteroid of this.world.asteroids) {
            if (!asteroid.userData.behavior && asteroid.userData.volume > 2.0) {
                asteroid.userData.behavior = (Math.random() < 0.2)
                    ? new CrashPlayerBehavior(asteroid, this.world)
                    : new ApproachPlayerBehavior(asteroid, this.world);
                    // : new CrashAsteroidBehavior(asteroid, this.world);
                    // : new Behavior();
                // asteroid.userData.behavior = new ApproachPlayerBehavior(asteroid, this.world)
            }
            if (asteroid.userData.behavior) { asteroid.userData.behavior.act(dt) };
        }
    }
}

class PingController {
    constructor(gameController) {
        this.gameController = gameController;
        this.timestamp = -9000;
        this.isActive = false;
        this.isFadeout = false;
    }

    update(keys) {
        if (this.gameController.state != GameState.Playing) { return; }

        const world = this.gameController.world;

        if (!this.isActive && !this.isFadeout && keys[" "] && !world.stations.empty()) {
            this.timestamp = world.time;
            this.isActive = true;
            showPingArrow();
        }

        if (this.isActive && !this.isFadeout && world.time > this.timestamp + GameControllerParameters.pingDuration) {
            this.isActive = false;
            this.isFadeout = true;
            hidePingArrow();
        }

        if (this.isActive || this.isFadeout) {
            const center = worldToScreen(world.camera, world.player.position);
            const stationPosition = world.stations.closest(world.player.position).scene.position;
            const angle = Math.atan2(stationPosition.y - world.player.position.y, stationPosition.x - world.player.position.x);
            updatePingArrow(center, -angle);
        }

        if (world.time > this.timestamp + GameControllerParameters.pingDuration + GameControllerParameters.pingFadeoutDuration) {
            this.isFadeout = false;
        }
    }
}

class Behavior {
    act(dt) {}
}

class ApproachPlayerBehavior /*extends Behavior*/ {
    constructor(asteroid, world, speed = 1) {
        this.asteroid = asteroid;
        this.world = world;
        this.speed = speed;
        this.suspended = false;
    }

    act(dt) {
        if (this.suspended) {
            return;
        }

        const target = this.world.player;
        let point = target.position.clone();

        // Don't modify velocity at all when close to player
        if (this.asteroid.position.clone().sub(point).lengthSq() < 36) { return; }

        // Crude player movement estimation, TODO: estimate collision point
        let distance, seconds;
        for (let i = 0; i < 10; i++) {
            distance = point.clone().sub(this.asteroid.position).length();
            seconds = distance / this.speed;
            point = target.position.clone().addScaledVector(target.userData.velocity, seconds);
        }

        // // Render point for testing
        // if (!this.asteroid.userData.collisionPoint) {
        //     const geometry = new THREE.BufferGeometry();
        //     geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
        //     this.asteroid.userData.collisionPoint = new THREE.Points(
        //         geometry,
        //         new THREE.PointsMaterial({ color: 0xff0000, size: 1 })
        //     );
        //     this.world.scene.add(this.asteroid.userData.collisionPoint);
        // }
        // this.asteroid.userData.collisionPoint.position.copy(point);

        const vel = point.sub(this.asteroid.position).normalize().multiplyScalar(this.speed);
        const playerDistance = target.position.clone().sub(this.asteroid.position).length();
        const alpha = (1 - Math.pow(0.001, dt)) * sigmoid(0.333 * (playerDistance - 24));
        vel.multiplyScalar(alpha).addScaledVector(this.asteroid.userData.velocity, 1 - alpha);
        this.world.physics.setVelocity(this.asteroid, vel);
    }
}

class CrashPlayerBehavior /*extends Behavior*/ {
    /**
     * @param {THREE.Mesh} asteroid 
     * @param {World} world 
     */
    constructor(asteroid, world) {
        this.asteroid = asteroid;
        this.world = world;
        this.suspended = false;
    }

    act(dt) {
        if (this.suspended) {
            return;
        }

        const target = this.world.player;
        if (target.position.clone().sub(this.asteroid.position).lengthSq() < 20 * 20) {
            // Don't act
            return;
        }
        const controlP = 0.02, controlD = 0.5;
        const offset = target.position.clone().sub(this.asteroid.position);
        const impulse = offset.multiplyScalar(controlP * dt).addScaledVector(target.userData.velocity.clone().sub(this.asteroid.userData.velocity), controlD * dt);
        this.world.physics.applyImpulse(this.asteroid, impulse);
        // const vel = target.position.clone().addScaledVector(target.userData.velocity, 5).sub(this.asteroid.position).normalize().multiplyScalar(1.5);
        // this.world.physics.setVelocity(this.asteroid, vel);
    }
}

class CrashAsteroidBehavior /*extends Behavior*/ {
    /**
     * @param {THREE.Mesh} asteroid 
     * @param {World} world 
     */
    constructor(asteroid, world) {
        this.asteroid = asteroid;
        this.world = world;
        this.chooseTarget();
    }

    act(dt) {
        if (this.target.userData.isRemoved) { this.chooseTarget(); }

        const controlP = 0.02, controlD = 0.5;
        const offset = this.target.position.clone().sub(this.asteroid.position);
        const impulse = offset.multiplyScalar(controlP * dt).addScaledVector(this.target.userData.velocity.clone().sub(this.asteroid.userData.velocity), controlD * dt);
        this.world.physics.applyImpulse(this.asteroid, impulse);
    }

    chooseTarget() {
        this.target = this.world.asteroids[Math.floor(Math.random() * this.world.asteroids.length)];
    }
}

/**
 * Calculates a position and velocity such that it collides with the player, assuming constant movement.
 */
function getOrthogonalCollisionTrajectory(player, distance, speed) {
    // position_asteroid + t * velocity_asteroid == position_player + t * velocity_player

    // in 2D
    // (1) a + t * c == p + t * x
    // (2) b + t * d == q + t * y

    // known: p, q, x, y
    // (a - p)^2 + (b - q)^2 == r^2 == distance^2
    // c^2 + d^2 == s^2 == speed^2

    // Construct right triangle with a = asteroid_movement, b = player_movement, c = distance.
    // Point C is the collision point. This means the asteroid always hits from the side.
    // (t * c)^2 + (t * d)^2 + (t * x)^2 + (t * y)^2 == r^2

    // Rearrange
    // t^2 * (c^2 + x^2 + y^2 + d^2) == r^2

    // Insert asteroid speed
    // t^2 * (x^2 + y^2 + s^2) == r^2

    // Rearrange
    // t^2 == r^2 / (x^2 + y^2 + s^2)
    // => t == sqrt(r^2 / (x^2 + y^2 + s^2))

    const v = player.userData.velocity;

    // Just spawn in any direction when player doesn't move
    if (v.lengthSq() < 0.1) {
        const angle = Math.random() * 2 * Math.PI;
        const direction = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
        return {
            position: player.position.clone().addScaledVector(direction, distance),
            velocity: direction.clone().multiplyScalar(-speed)
        }
    }

    // We can calculate the collision time
    const t = Math.sqrt(distance * distance / (v.x * v.x + v.y * v.y + speed * speed));

    // And thus the collision point
    const vector = player.position.clone().addScaledVector(player.userData.velocity, t);

    // The asteroid position is on a circle with r=distance around the player
    // And on a circle with r=speed*t around the collision point
    const [[x1, y1], [x2, y2]] = intersectTwoCircles(
        player.position.x, player.position.y, distance,
        vector.x, vector.y, speed * t
    );
    // Both intersections are equally far from the player, choose one randomly
    const [x, y] = Math.random() < 0.5 ? [x1, y1] : [x2, y2];

    const position = { x, y, z: 0 };

    // Steer towards collision point
    vector.sub(position).normalize().multiplyScalar(speed);

    return { position, velocity: vector };
}

/**
 * Calculates the two intersection points of two circles. Based on:
 * https://gist.github.com/jupdike/bfe5eb23d1c395d8a0a1a4ddd94882ac
 * http://math.stackexchange.com/a/1367732
 * @returns Two coordinate pairs if there is at least one intersection, same coordinates twice if the circles touch,
 *          empty list if there is no intersection.
 */
function intersectTwoCircles(x1, y1, r1, x2, y2, r2) {
    const dx = x1 - x2;
    const dy = y1 - y2;

    const rSq = dx * dx + dy * dy;
    var r = Math.sqrt(rSq);
    if (!(Math.abs(r1 - r2) <= r && r <= r1 + r2)) {
        // No intersection
        return [];
    }

    // Intersection(s) exist
    const a = (r1 * r1 - r2 * r2);
    const b = a / (2 * rSq);
    const c = Math.sqrt(2 * (r1 * r1 + r2 * r2) / rSq - (a * a) / (rSq * rSq) - 1);

    var fx = (x1 + x2) / 2 + b * (x2 - x1);
    var gx = c * (y2 - y1) / 2;
    var ix1 = fx + gx;
    var ix2 = fx - gx;

    var fy = (y1 + y2) / 2 + b * (y2 - y1);
    var gy = c * (x1 - x2) / 2;
    var iy1 = fy + gy;
    var iy2 = fy - gy;

    return [[ix1, iy1], [ix2, iy2]];
}

function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

function linspace(start, stop, num, endpoint = true) {
    const div = endpoint ? (num - 1) : num;
    const step = (stop - start) / div;
    return Array.from({length: num}, (_, i) => start + step * i);
}

function angleDifference(a, b) {
    let c = a - b + Math.PI;
    if (c < 0) { c += Math.ceil(Math.abs(c) / 2 * Math.PI) * 2 * Math.PI}
    return c % (2 * Math.PI) - Math.PI;
}
