import { splitAsteroid } from "../geometry/AsteroidSplitter.js";

onmessage = async (message) => {
    const { asteroid, impact } = message.data;
    const result = splitAsteroid(asteroid, impact);
    // await new Promise(r => setTimeout(r, 1000));
    postMessage(result);
};
