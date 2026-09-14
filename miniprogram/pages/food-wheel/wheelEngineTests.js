const assert = require("assert");

const wheelEngine = require("./wheelEngine.js");
const wheelPhysics = require("./engine/wheelPhysics.js");
const confettiEngine = require("./engine/confettiEngine.js");
const wheelCandidateHelper = require("./engine/wheelCandidateHelper.js");
const wheelShareHelper = require("./engine/wheelShareHelper.js");

assert.deepStrictEqual(Object.keys(wheelEngine), [
  "morandiPresets",
  "calculateWheelSlices",
  "computeTargetAngle",
  "createConfettiParticles",
  "updateAndRenderConfetti",
  "buildCategoryFilters",
  "filterWheelCandidates",
  "buildFilterSummary",
  "SCENARIO_PACKS",
  "buildWheelShareData",
]);
assert.strictEqual(wheelEngine.calculateWheelSlices, wheelPhysics.calculateWheelSlices);
assert.strictEqual(wheelEngine.createConfettiParticles, confettiEngine.createConfettiParticles);
assert.strictEqual(wheelEngine.filterWheelCandidates, wheelCandidateHelper.filterWheelCandidates);
assert.strictEqual(wheelEngine.buildWheelShareData, wheelShareHelper.buildWheelShareData);

const emptyWheel = wheelEngine.calculateWheelSlices([], "random", 200, 32);
assert.deepStrictEqual(emptyWheel, {
  conicGradientStyle: "conic-gradient(#fbfaf7 0% 100%)",
  wheelSlices: [],
});

const activeItems = [
  { id: "first", title: "拉面", source: "custom", weight: 1, score: 60 },
  { id: "second", title: "火锅", source: "coupon", weight: 3, score: 85 },
];
const randomWheel = wheelEngine.calculateWheelSlices(activeItems, "random", 200, 32);
assert.deepStrictEqual(randomWheel.wheelSlices.map((slice) => slice.midAngle), [90, 270]);
assert.strictEqual(randomWheel.wheelSlices[1].title, "✨火锅");

const weightedWheel = wheelEngine.calculateWheelSlices(activeItems, "weighted", 200, 32);
assert.deepStrictEqual(weightedWheel.wheelSlices.map((slice) => slice.midAngle), [45, 225]);
assert.strictEqual(wheelEngine.computeTargetAngle(activeItems, 1, "weighted", 0), 1935);
assert.strictEqual(wheelEngine.computeTargetAngle(activeItems, 1, "weighted", 361), 2655);

const candidates = [
  { id: "coupon_food", source: "coupon", categoryLabel: "美食", enabled: true, blocked: false },
  { id: "custom_drink", source: "custom", categoryLabel: "饮品", enabled: false, blocked: false },
  { id: "blocked_food", source: "coupon", categoryLabel: "美食", enabled: false, blocked: true },
  { id: "custom_other", source: "custom", enabled: true, blocked: false },
];
assert.deepStrictEqual(wheelEngine.buildCategoryFilters(candidates), [
  { label: "美食", count: 2 },
  { label: "饮品", count: 1 },
  { label: "其他", count: 1 },
]);

const filtered = wheelEngine.filterWheelCandidates(candidates, "coupon", "美食");
assert.strictEqual(filtered.candidates.length, 2);
assert.strictEqual(filtered.enabledCount, 1);
assert.strictEqual(filtered.couponCount, 2);
assert.strictEqual(filtered.customCount, 0);
assert.strictEqual(filtered.allEnabled, true, "blocked candidates should not prevent all selectable candidates being enabled");

const allBlocked = wheelEngine.filterWheelCandidates([
  { id: "blocked", source: "coupon", categoryLabel: "美食", enabled: false, blocked: true },
], "all", "all");
assert.strictEqual(allBlocked.enabledCount, 0);
assert.strictEqual(allBlocked.allEnabled, false, "a result containing only blocked candidates is not all-enabled");
assert.strictEqual(wheelEngine.filterWheelCandidates([], "all", "all").allEnabled, false);

const sourceFilters = [
  { label: "全部", value: "all" },
  { label: "待用券", value: "coupon" },
];
assert.strictEqual(wheelEngine.buildFilterSummary("all", "all", sourceFilters), "全部候选");
assert.strictEqual(wheelEngine.buildFilterSummary("coupon", "美食", sourceFilters), "待用券 · 美食");
assert.ok(wheelEngine.SCENARIO_PACKS.workday.includes("麻辣烫"));

const shared = wheelEngine.buildWheelShareData({ title: "火锅 & 烧烤" });
assert.strictEqual(shared.path, `/pages/food-wheel/index?add=${encodeURIComponent("火锅 & 烧烤")}`);
assert.ok(shared.title.includes("火锅 & 烧烤"));
assert.deepStrictEqual(wheelEngine.buildWheelShareData(null), {
  title: "🎲 今天吃啥转盘：解决你的选择困难症！",
  path: "/pages/food-wheel/index",
});

const originalRandom = Math.random;
try {
  Math.random = () => 0.5;
  const particles = wheelEngine.createConfettiParticles(10, 20, ["#fff"], 2);
  assert.strictEqual(particles.length, 2);
  assert.deepStrictEqual({
    x: particles[0].x,
    y: particles[0].y,
    vx: particles[0].vx,
    vy: particles[0].vy,
    size: particles[0].size,
    color: particles[0].color,
    rotation: particles[0].rotation,
    rotationSpeed: particles[0].rotationSpeed,
  }, {
    x: 10,
    y: 20,
    vx: 8,
    vy: -5,
    size: 7.5,
    color: "#fff",
    rotation: 180,
    rotationSpeed: 0,
  });
} finally {
  Math.random = originalRandom;
}

const drawCalls = [];
const ctx = {
  clearRect(...args) { drawCalls.push(["clearRect", ...args]); },
  save() { drawCalls.push(["save"]); },
  translate(...args) { drawCalls.push(["translate", ...args]); },
  rotate(...args) { drawCalls.push(["rotate", ...args]); },
  fillRect(...args) { drawCalls.push(["fillRect", ...args]); },
  restore() { drawCalls.push(["restore"]); },
  globalAlpha: 1,
  fillStyle: "",
};
const particle = {
  x: 0,
  y: 0,
  vx: 2,
  vy: -1,
  size: 4,
  color: "#fff",
  rotation: 10,
  rotationSpeed: 5,
  opacity: 1,
  gravity: 0.28,
  drag: 0.5,
};
assert.strictEqual(wheelEngine.updateAndRenderConfetti(ctx, 100, 80, [particle]), 1);
assert.strictEqual(particle.x, 1);
assert.ok(Math.abs(particle.y - (-0.22)) < Number.EPSILON);
assert.strictEqual(particle.opacity, 0.985);
assert.ok(drawCalls.some((call) => call[0] === "fillRect"));

drawCalls.length = 0;
assert.strictEqual(wheelEngine.updateAndRenderConfetti(ctx, 100, 80, [{ opacity: 0 }]), 0);
assert.strictEqual(drawCalls.filter((call) => call[0] === "clearRect").length, 2);

console.log("food wheel engine tests ok");
