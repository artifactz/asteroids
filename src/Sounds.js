import * as THREE from 'three';

export class Sounds {
    constructor() {
        this.time = 0;
        this.audioLoader = new THREE.AudioLoader();
        this.listener = new THREE.AudioListener();
        this.listener.setMasterVolume(0.5);
        this.audio = {
            ambient: this.loadAudio("media/asteroids02.ogg", 1.0, true),
            laser: this.loadAudio("media/pew.ogg", 0.2),
            laserAsteroidImpact: this.loadAudio("media/impact.ogg", 0.2),
            asteroidExplosion: this.loadAudio("media/kill.ogg", 0.1),
            asteroidCollision: this.loadAudio("media/crash4.ogg", 0.3),
            asteroidSplit: this.loadAudio("media/chomp.ogg", 0.2),
            playerCollision: this.loadAudio("media/crash.ogg", 1.0),
            suck: this.loadAudio("media/suck.ogg", 0.6),
            take: this.loadAudio("media/take.ogg", 0.6),
        }
    }

    loadAudio(url, volume) {
        const audio = { volume, lastPlayed: null };
        this.audioLoader.load(url, (buffer) => {
            audio.buffer = buffer;
        });
        return audio;
    }

    play(identifier, { volume = 1, pitch = 1, pan = 0, loop = false } = {}, maxInterval = 0) {
        const audio = this.audio[identifier];

        if (maxInterval && audio.lastPlayed && this.time < audio.lastPlayed + maxInterval) {
            return;
        }

        const sound = new THREE.Audio(this.listener);
        sound.setBuffer(audio.buffer);
        sound.gain.gain.value = audio.volume * volume;
        sound.playbackRate = pitch;

        if (pan) {
            const panner = this.listener.context.createStereoPanner();
            sound.gain.disconnect();
            sound.gain.connect(panner);
            panner.connect(this.listener.context.destination);
            panner.pan.value = pan;
        }

        if (loop) {
            sound.setLoop(true);
        }

        sound.play();
        audio.lastPlayed = this.time;
    }

    updateTime(time) {
        this.time = time;
    }
}
