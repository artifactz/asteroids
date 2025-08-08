const NUM_SEGMENTS = 8;
const segments = [];
const container = document.getElementById('thrust-bar-container');


export function initHud() {
    // Create segments
    for (let i = 0; i < NUM_SEGMENTS; i++) {
        const segment = document.createElement('div');
        segment.classList.add('thrust-segment');

        // Scale width based on segment index (larger at the top)
        const scale = 0.6 + (i / NUM_SEGMENTS) * 0.4; // Range from 60% to 100%
        segment.style.width = `${scale * 100}%`;

        container.appendChild(segment);
        segments.push(segment);
    }
}

export function updateThrustBar(value) {
    const activeCount = Math.round(value * NUM_SEGMENTS);
    segments.forEach((segment, index) => {
        segment.classList.toggle('active', index < activeCount);
    });
}
