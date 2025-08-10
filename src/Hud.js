const THRUST_NUM_SEGMENTS = 8;
const thrustSegments = [];
const thrustContainer = document.getElementById('thrust-bar-container');


export function initHud() {
    // Create segments
    for (let i = 0; i < THRUST_NUM_SEGMENTS; i++) {
        const segment = document.createElement('div');
        segment.classList.add('thrust-segment');

        // Scale width based on segment index (larger at the top)
        const scale = 0.6 + (i / THRUST_NUM_SEGMENTS) * 0.4; // Range from 60% to 100%
        segment.style.width = `${scale * 100}%`;

        thrustContainer.appendChild(segment);
        thrustSegments.push(segment);
    }
}

export function updateThrustBar(value) {
    const activeCount = Math.round(value * THRUST_NUM_SEGMENTS);
    thrustSegments.forEach((segment, index) => {
        segment.classList.toggle('active', index < activeCount);
    });
}


const gameOverContainer = document.getElementById('game-over-container');

export function showGameOver() {
    gameOverContainer.style.display = "block";
}


const materialText = document.getElementById('material-text');

export function updateMaterial(value) {
    materialText.innerHTML = value.toFixed(1);
}
