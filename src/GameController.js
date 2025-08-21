import { initHud, showGameOver, showGameStart, showHud, updateMaterial, updateThrustBar } from './Hud';
import { fixCameraOnPlayer, moveCamera, rotateTowards } from './Targeting';
import { checkLaserHit } from './GameObjects.js';

export const GameState = {
    StartScreen: 'StartScreen',
    Playing: 'Playing',
    EndScreen: 'EndScreen',
};

export class GameController {
    constructor(world, startScreenPlayerSpeed = 40) {
        this.world = world;
        this.prevState = null;
        this.state = GameState.StartScreen;
        this.isEaseInStage = false; // transition between StartScreen and Playing
        this.asteroidSpawnDistance = 32;
        this.asteroidSpawnProbability = 10.0; // resets to 0 at every spawn
        this.asteroidSpawnProbabilityGainPerSecond = 0.2;

        // Prepare start screen
        showGameStart();
        this.startScreenPlayerSpeed = startScreenPlayerSpeed;
        this.originalPlayerMaxSpeed = world.player.userData.maxSpeed;
        this.originalPlayerMaxRotationalSpeed = world.player.userData.maxRotationalSpeed;
        world.player.userData.maxSpeed = startScreenPlayerSpeed;
        world.player.userData.speed = startScreenPlayerSpeed;
        this.world.player.userData.maxRotationalSpeed = 0;
        world.player.rotation.z = 0.125 * Math.PI;
    }

    update(keys, mouse, dt) {
        if (this.state == GameState.StartScreen && mouse[0]) {
            this.state = GameState.Playing;
            this.isEaseInStage = true;
            showHud();

        } else if (this.state == GameState.Playing && !this.world.player.userData.isAlive) {
            this.state = GameState.EndScreen;

        } else if (this.state == GameState.Playing) {
            if (mouse.positionWorld) { rotateTowards(this.world.player, mouse.positionWorld, dt); }

            if (this.isEaseInStage) {
                const decay = Math.pow(0.5, dt)
                this.world.player.userData.speed *= decay;

                const easeInEndSpeed = 0.5 * this.originalPlayerMaxSpeed;
                const alpha = (this.world.player.userData.speed - easeInEndSpeed) / (this.startScreenPlayerSpeed - easeInEndSpeed);
                this.world.player.userData.maxRotationalSpeed = (1 - alpha) * this.originalPlayerMaxRotationalSpeed;

                if (this.world.player.userData.speed <= 0.5 * this.originalPlayerMaxSpeed) {
                    this.world.player.userData.speed = 0.5 * this.originalPlayerMaxSpeed;
                    this.world.player.userData.maxSpeed = this.originalPlayerMaxSpeed;
                    this.isEaseInStage = false;
                }

            } else {
                if (keys['w']) {
                    this.world.player.userData.accel = this.world.player.userData.maxAccel;
                } else if (keys['s']) {
                    this.world.player.userData.accel = -this.world.player.userData.maxAccel;
                } else {
                    this.world.player.userData.accel = 0;
                }
            }
        }

        this.world.updatePlayer(dt);

        this.maybeSpawnAsteroid(dt);

        // Shoot
        if (this.state == GameState.Playing && mouse[0] && this.world.player.userData.laserHeat <= 0) {
            const noiseRad = (2 * Math.random() - 1) * this.world.player.userData.laserSpreadRad;
            this.world.createLaser(this.world.player.position, this.world.player.rotation.z + noiseRad, this.world.player.userData.laserSpeed + this.world.player.userData.speed);
            this.world.player.userData.laserHeat = this.world.player.userData.laserCooldownPeriod;
        }

        this.world.physics.update(dt);
        this.world.updateAsteroids(dt);
        this.world.updateLasers(dt);
        this.world.particles.update(dt);
        this.updateCamera(mouse, dt);
        this.world.updateUniverse();

        // Update UI
        if (this.state == GameState.Playing) {
            const thrust = (this.isEaseInStage)
                ? 0.5 + 0.5 * this.world.player.userData.speed / this.world.player.userData.maxSpeed
                : Math.abs(this.world.player.userData.speed) / this.world.player.userData.maxSpeed;
            updateThrustBar(thrust);
            updateMaterial(this.world.player.userData.material);
        }
        if (this.state == GameState.EndScreen && this.prevState == GameState.Playing) {
            showGameOver();
        }

        this.prevState = this.state;
    }

    updateCamera(mouse, dt) {
        if (this.state == GameState.Playing && mouse.positionWorld) {
            moveCamera(this.world, mouse.positionWorld, dt);
        } else if (this.state == GameState.StartScreen) {
            fixCameraOnPlayer(this.world, 0, -2.5);
        }
    }

    maybeSpawnAsteroid(dt) {
        if (this.state == GameState.Playing && !this.isEaseInStage) {
            this.asteroidSpawnProbability += this.asteroidSpawnProbabilityGainPerSecond * dt;
            if (Math.random() < this.asteroidSpawnProbability * dt) {
                this.world.spawnAsteroid(this.asteroidSpawnDistance);
                this.asteroidSpawnProbability = 0;
            }
        }
    }
}
