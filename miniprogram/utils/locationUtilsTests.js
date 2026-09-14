const assert = require("assert");
const { hasCoordinates, normalizeCoordinate } = require("./locationUtils.js");

assert.strictEqual(normalizeCoordinate("22.5"), 22.5);
assert.strictEqual(normalizeCoordinate(""), null);
assert.strictEqual(normalizeCoordinate("not-a-number"), null);
assert.strictEqual(hasCoordinates({ latitude: 0, longitude: 0 }), true);
assert.strictEqual(hasCoordinates({ lat: 22.5, lng: 113.9 }), true);
assert.strictEqual(hasCoordinates({ latitude: 22.5 }), false);
assert.strictEqual(hasCoordinates({ latitude: 91, longitude: 0 }), false);
assert.strictEqual(hasCoordinates({ latitude: 0, longitude: 181 }), false);

console.log("location utils tests ok");
