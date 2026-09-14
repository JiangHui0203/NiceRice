const assert = require("assert");
const { normalizePlan } = require("./planNormalizer.js");

const plan = normalizePlan({
  id: "zero-coordinate-plan",
  title: "本初子午线计划",
  location: { lat: 0, lng: 0 },
});
assert.strictEqual(plan.location.latitude, 0);
assert.strictEqual(plan.location.longitude, 0);

assert.doesNotThrow(() => normalizePlan({ id: "legacy-number-date", date: 20260830, time: 1830 }));

console.log("plan normalizer tests ok");
