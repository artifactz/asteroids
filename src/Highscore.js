export let highscoreData;

export function fetchHighscores() {
    highscoreData = null;
    fetch("https://asteroids-highscores-1068571013537.europe-west10.run.app")
        .then((response) => { return response.json(); })
        .then((data) => { highscoreData = data; })
        .catch((err) => { console.error('Fetch Error:', err) });
}

export function submitHighscore(name, score, okFunc = null, errFunc = null) {
    // Basic sanity checks
    if (typeof name !== 'string' || name.length == 0 || name.length > 20 || encodeURIComponent(name) != name) {
        if (okFunc) { errFunc("Invalid name"); }
        return;
    }
    if (typeof score !== 'number' || score <= 0 || score > 100000) { return; }

    fetch(`https://asteroids-highscores-1068571013537.europe-west10.run.app/submit?name=${name}&score=${score}`, { method: "POST" })
        .then((response) => { return response.json(); })
        .then((data) => { if (okFunc) { okFunc(data); } })
        .catch((err) => { if (errFunc) { errFunc(err); } });
}
