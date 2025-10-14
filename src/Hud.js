import { submitHighscore } from "./Highscore.js";

const THRUST_NUM_SEGMENTS = 8;
const thrustSegments = [];
const canvas = document.getElementById('three-canvas');
const thrustContainer = document.getElementById('thrust-bar-container');
const gameStartContainer = document.getElementById('game-start-container');
const pauseContainer = document.getElementById('pause-container');
const pauseText = document.getElementById('pause-text');
const antialiasingText = document.getElementById('antialiasing-text');
const gameOverContainer = document.getElementById('game-over-container');
const highscoresContainer = document.getElementById('highscores-container');
const highscoresTable = document.getElementById('highscores-table');
const materialContainer = document.getElementById('material-container');
const materialText = document.getElementById('material-text');
const fpsText = document.getElementById('fps-text');


/**
 * Initializes HUD elements and event handling at startup.
 * @param {function(string)} onChangedAA Callback when antialiasing mode is changed, parameter is either "MSAA" or "SSAA".
 */
export function initHud(onChangedAA) {
    // Create thrust segments
    for (let i = 0; i < THRUST_NUM_SEGMENTS; i++) {
        const segment = document.createElement('div');
        segment.classList.add('thrust-segment');

        // Scale width based on segment index (larger at the top)
        const scale = 0.6 + (i / THRUST_NUM_SEGMENTS) * 0.4; // Range from 60% to 100%
        segment.style.width = `${scale * 100}%`;

        thrustContainer.appendChild(segment);
        thrustSegments.push(segment);
    }

    // Antialiasing toggle
    antialiasingText.innerHTML = "Antialiasing: MSAA";
    antialiasingText.addEventListener("click", e => {
        const newAA = antialiasingText.innerHTML.endsWith("MSAA") ? "SSAA" : "MSAA";
        antialiasingText.innerHTML = `Antialiasing: ${newAA}`;
        onChangedAA(newAA);
    });
}

let lastThrustSegments = null;

export function updateThrustBar(value) {
    const absValue = Math.abs(value);
    const activeCount = Math.round(absValue * THRUST_NUM_SEGMENTS);
    if (activeCount != lastThrustSegments) {
        thrustSegments.forEach((segment, index) => {
            segment.classList.toggle('fulldrive', activeCount == THRUST_NUM_SEGMENTS && value > 0);
            segment.classList.toggle('fullreverse', activeCount == THRUST_NUM_SEGMENTS && value < 0);
            if (index < activeCount) {
                segment.classList.toggle((value > 0) ? 'drive' : 'reverse', true);
            } else {
                segment.classList.toggle('drive', false);
                segment.classList.toggle('reverse', false);

            }
        });
        lastThrustSegments = activeCount;
    }
}


let lastMaterialValue = null;

export function updateMaterial(value) {
    const materialValue = value.toFixed(1);
    if (materialValue != lastMaterialValue) {
        materialText.innerHTML = materialValue;
        lastMaterialValue = materialValue;
    }
}

export function updateFps(value) {
    fpsText.innerHTML = value.toFixed(1);
}

export function showGameStart() {
    gameStartContainer.style.display = "block";
    gameStartContainer.classList.add("visible");
    thrustContainer.style.display = "none";
    materialContainer.style.display = "none";
}

export function showHud() {
    gameStartContainer.classList.remove("visible");
    hideOnFadeout(gameStartContainer);
    thrustContainer.style.display = "flex";
    materialContainer.style.display = "flex";
}

export function showPause() {
    pauseContainer.style.display = "block";
    pauseContainer.classList.add("visible");
    pauseText.classList.add("visible");
}

export function hidePause() {
    pauseContainer.classList.remove("visible");
    hideOnFadeout(pauseContainer);
}

export function showGameOver() {
    gameOverContainer.style.display = "block";
    gameOverContainer.classList.add("visible");
}

export function showHighscores(data, playerScore) {
    const roundedPlayerScore = Math.round(playerScore * 10) / 10;
    updateHighscores(data, roundedPlayerScore);
    gameOverContainer.classList.remove("visible");
    hideOnFadeout(gameOverContainer);
    highscoresContainer.style.display = "block";
    highscoresContainer.classList.add("visible");
    thrustContainer.style.display = "none";
    materialContainer.style.display = "none";
    canvas.classList.add("desaturated");
}

/**
 * Updates the highscores table with the given data.
 * @param {Array} data Highscore data array.
 * @param {number} playerScore Optional player score to allow submission if eligible.
 */
function updateHighscores(data, playerScore = null) {
    if (!data) {
        highscoresTable.innerHTML = '<tr><td class="highscores-error">Server unreachable.</td></tr>';
        return;
    }

    let tableContent = "";
    let isEligible = false
    let rowNumber = 0;
    for (const row of data) {
        if (playerScore && !isEligible && row.score <= playerScore) {
            tableContent += `<tr><td class="highscores-position">${rowNumber + 1}.</td><td class="highscores-name"><input type="text" id="highscores-name-input" maxlength="20"></td><td class="highscores-score">${playerScore}<input id="highscores-name-submit" type="button" value="Submit"></td></tr>`;
            isEligible = true;
            rowNumber++;
            if (rowNumber > 9) { break; }
        }
        let nameClasses;
        if (rowNumber == 0) {
            nameClasses = "highscores-name highscores-name-1st";
        } else if (rowNumber == 1) {
            nameClasses = "highscores-name highscores-name-2nd";
        } else if (rowNumber == 2) {
            nameClasses = "highscores-name highscores-name-3rd";
        } else {
            nameClasses = "highscores-name";
        }
        tableContent += `<tr><td class="highscores-position">${rowNumber + 1}.</td><td class="${nameClasses}">${row.name}</td><td class="highscores-score">${row.score}</td></tr>`;
        rowNumber++;
        if (rowNumber > 9) { break; }
    }
    highscoresTable.innerHTML = tableContent;

    if (isEligible) {
        // Inputs were added, so add event handling
        addHighscoresEventHandling(playerScore);
    }
}

/**
 * Adds event handling to the highscore name input and submit button.
 * @param {number} playerScore The player's score to submit.
 */
function addHighscoresEventHandling(playerScore) {
    const nameInput = document.getElementById('highscores-name-input');
    const submitButton = document.getElementById('highscores-name-submit');
    for (const element of [nameInput, submitButton]) {
        for (const eventName of ["mousedown", "mouseup", "click", "contextmenu"]) {

            if (element === submitButton && eventName == "click") {
                element.addEventListener(eventName, (e) => {
                    submitHighscore(
                        nameInput.value,
                        playerScore,
                        (data_) => { updateHighscores(data_); },
                        (err) => {
                            if (err == "Invalid name") {
                                nameInput.classList.add("highscores-name-input-invalid");
                                setTimeout(() => { nameInput.classList.remove("highscores-name-input-invalid"); }, 1000);
                            }
                        }
                    );
                    e.stopPropagation();
                }, true);

            } else {
                // Capture mouse events and do default action
                element.addEventListener(eventName, e => { e.stopPropagation(); }, true);
            }
        }
    }

    nameInput.addEventListener("keypress", (e) => { if (e.key === "Enter") { submitButton.click(); } });
}

/**
 * Hides the element (display: none) after fade-out transition ends.
 * @param {HTMLElement} element
 */
function hideOnFadeout(element) {
    element.addEventListener(
        'transitionend',
        (e) => {
            if (e.propertyName === "opacity") {
                element.style.display = "none";
            }
        },
        { once: true }
    );
}
