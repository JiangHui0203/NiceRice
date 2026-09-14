const assert = require("assert");

global.wx = {
  getStorageSync() {
    return "";
  },
};

const service = require("./mapDistanceService.js");
const guards = service.__test__;

service.clearDistanceCache();
for (let index = 0; index < guards.MAX_DISTANCE_CACHE_ENTRIES + 40; index += 1) {
  service.resolveDistanceInfo({
    from: { latitude: 30 + index * 0.001, longitude: 120 },
    to: { latitude: 31, longitude: 121 },
  });
}
assert.ok(
  guards.getDistanceCacheSize() <= guards.MAX_DISTANCE_CACHE_ENTRIES,
  "distance cache must stay bounded",
);

service.clearDistanceCache();
guards.setDistanceCache("expired", { distanceMeters: 1 }, 1000);
assert.strictEqual(guards.getDistanceCache("expired", 1000 + guards.CACHE_TTL_MS), null);
assert.strictEqual(guards.getDistanceCacheSize(), 0);

const crossRegion = service.calculateLocalDistance(
  39.9928,
  116.4782,
  22.5412,
  113.9482,
  "transit",
);
assert.strictEqual(crossRegion.isCrossRegion, true);
assert.strictEqual(crossRegion.durationMinutes, null);
assert.strictEqual(crossRegion.travelTimeText, "异地商户");

console.log("map distance cache tests ok");
