export class Tiles2D {
    constructor() {
        this.tiles = new Map();
    }

    id(x, y) {
        return `${x},${y}`;
    }

    get(x, y) {
        return this.tiles.get(this.id(x, y));
    }

    has(x, y) {
        return this.tiles.has(this.id(x, y));
    }

    set(x, y, value) {
        this.tiles.set(this.id(x, y), value);
    }

    values() {
        return this.tiles.values();
    }

    static *iterRect(x0, x1, y0, y1) {
        for (let x = x0; x < x1 + 1; x++) {
            for (let y = y0; y < y1 + 1; y++) {
                yield [x, y];
            }
        }
    }
}
