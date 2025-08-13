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
        this.asteroidSpawnDistance = 10;
        this.asteroidSpawnProbabilityGainPerSecond = 0.02;
        this.asteroidSpawnProbability = 1.0;

        // Prepare start screen
        showGameStart();
        this.startScreenPlayerSpeed = startScreenPlayerSpeed;
        this.originalPlayerMaxSpeed = world.player.userData.maxSpeed;
        world.player.userData.maxSpeed = startScreenPlayerSpeed;
        world.player.userData.speed = startScreenPlayerSpeed;
        world.player.rotation.z = 0.125 * Math.PI;
    }

    update(keys, mouse, dt) {
        if (this.state == GameState.StartScreen && mouse[0]) {
            this.state = GameState.Playing;
            this.isEaseInStage = true;
            showHud();

        } else if (this.state == GameState.Playing) {
            if (mouse.positionWorld) { rotateTowards(this.world.player, mouse.positionWorld, dt); }

            if (this.isEaseInStage) {
                const decay = Math.pow(0.5, dt)
                this.world.player.userData.speed *= decay;
                if (this.world.player.userData.speed <= this.originalPlayerMaxSpeed) {
                    if (this.world.player.userData.speed <= 0.5 * this.originalPlayerMaxSpeed) {
                        this.world.player.userData.speed = 0.5 * this.originalPlayerMaxSpeed;
                        this.world.player.userData.maxSpeed = this.originalPlayerMaxSpeed;
                        this.isEaseInStage = false;
                    }
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

            if (!this.world.player.userData.isAlive) {
                this.state = GameState.EndScreen;
            }
        }

        this.world.updatePlayer(dt);

        if (this.state == GameState.Playing) {
            if (mouse.positionWorld) { moveCamera(this.world, mouse.positionWorld, dt); }

            if (!this.isEaseInStage) {
                this.asteroidSpawnProbability += this.asteroidSpawnProbabilityGainPerSecond * dt;
                if (Math.random() < this.asteroidSpawnProbability * dt) {
                    this.world.spawnAsteroid();
                    this.asteroidSpawnProbability = 0;
                }
            }
        } else if (this.state == GameState.StartScreen) {
            fixCameraOnPlayer(this.world, 0, -2.5);
        }

        // Shoot
        if (this.state == GameState.Playing && mouse[0] && this.world.player.userData.laserHeat <= 0) {
            const noiseRad = (2 * Math.random() - 1) * this.world.player.userData.laserSpreadRad;
            this.world.createLaser(this.world.player.position, this.world.player.rotation.z + noiseRad, this.world.player.userData.laserSpeed + this.world.player.userData.speed);
            this.world.player.userData.laserHeat = this.world.player.userData.laserCooldownPeriod;
        }

        // Move lasers
        this.world.updateLasers(dt);

        // Advance physics
        this.world.physics.stepSimulation(dt, 10);

        // Move asteroids
        this.world.updateAsteroids(dt);

        this.world.updateUniverse();

        // Collide lasers with asteroids
        this.world.lasers.forEach(laser => {
            if (!laser.isRemoved) {
                const hit = checkLaserHit(laser, this.world.asteroids);
                if (hit) {
                    this.world.handleLaserHit(laser, hit, dt);
                }
            }
        });

        this.world.removeLasers();

        this.world.particles.update(dt);

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
}
