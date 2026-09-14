const assert = require("assert");
const { getLunarMoonPhase } = require("./weatherAstronomy.js");
const { generateWeatherScene } = require("./weatherEngine.js");

// USNO primary phases for August 2026 (UTC): new moon Aug 12 17:37,
// first quarter Aug 20 02:46, full moon Aug 28 04:18.
const fullMoonDate = new Date("2026-08-28T04:18:00Z");
const earlyMorningAfterFullDate = new Date("2026-08-30T01:00:00+08:00");
const newMoon = getLunarMoonPhase(new Date("2026-08-12T17:37:00Z"));
const firstQuarter = getLunarMoonPhase(new Date("2026-08-20T02:46:00Z"));
const fullMoon = getLunarMoonPhase(fullMoonDate);
const earlyMorningAfterFull = getLunarMoonPhase(earlyMorningAfterFullDate);

assert.strictEqual(newMoon.phase, "new");
assert.ok(newMoon.illumination < 0.01);
assert.ok(newMoon.phaseProgress < 0.02 || newMoon.phaseProgress > 0.98);
assert.strictEqual(firstQuarter.phase, "first-quarter");
assert.ok(firstQuarter.illumination > 0.4 && firstQuarter.illumination < 0.6);
assert.strictEqual(firstQuarter.waxing, true);
assert.strictEqual(fullMoon.phase, "full");
assert.ok(fullMoon.illumination > 0.99);
assert.strictEqual(earlyMorningAfterFull.phase, "full", "满月后约 1.5 天不应因丢失时分而提前变成月牙");
assert.ok(earlyMorningAfterFull.illumination > 0.96);
assert.strictEqual(earlyMorningAfterFull.waxing, false);

const scene = generateWeatherScene({
  timestamp: new Date("2026-08-30T01:00:00+08:00").getTime(),
  timePhase: "lateNight",
  mainCondition: "clear",
});
assert.strictEqual(scene.visual.celestial.moon.phase, "full");
assert.ok(scene.visual.celestial.moon.shadowWidthPercent <= 4);
assert.strictEqual(scene.visual.celestial.moon.lightSide, "left");
assert.strictEqual(scene.visual.celestial.moon.terminatorTone, "light");
assert.ok(scene.visual.celestial.moon.terminatorScale > 0.9);
assert.strictEqual(scene.visual.celestial.moon.showRabbit, false, "兔子只应在非常接近满月时出现");

const customScene = generateWeatherScene({
  timestamp: new Date("2026-08-12T17:37:00Z").getTime(),
  timePhase: "night",
  mainCondition: "clear",
  customMoonPhase: "full",
});
assert.strictEqual(customScene.visual.celestial.moon.phase, "full");
assert.strictEqual(customScene.visual.celestial.moon.phaseLabel, "满月");
assert.strictEqual(customScene.visual.celestial.moon.illumination, 1);
assert.strictEqual(customScene.visual.celestial.moon.terminatorTone, "light");
assert.strictEqual(customScene.visual.celestial.moon.terminatorScale, 1);
assert.strictEqual(customScene.visual.celestial.moon.showRabbit, true);

const newMoonScene = generateWeatherScene({
  timestamp: new Date("2026-08-12T17:37:00Z").getTime(),
  timePhase: "night",
  mainCondition: "clear",
});
assert.strictEqual(newMoonScene.visual.celestial.moon.phase, "new", "scene must preserve the requested timestamp");
assert.strictEqual(newMoonScene.visual.celestial.moon.terminatorTone, "dark");
assert.ok(newMoonScene.visual.celestial.moon.terminatorScale > 0.98);

const gibbousScene = generateWeatherScene({
  timestamp: new Date("2026-08-30T21:00:00+08:00").getTime(),
  timePhase: "night",
  mainCondition: "clear",
});
assert.strictEqual(gibbousScene.visual.celestial.moon.phase, "waning-gibbous");
assert.ok(gibbousScene.visual.celestial.moon.shadowWidthPercent < 15, "near-full gibbous moon should only have a narrow shadow");
assert.strictEqual(gibbousScene.visual.celestial.moon.lightSide, "left");
assert.strictEqual(gibbousScene.visual.celestial.moon.terminatorTone, "light");
assert.ok(gibbousScene.visual.celestial.moon.terminatorScale > 0.8);

const customPhases = [
  ["new", "right", "dark", 1],
  ["waxing-crescent", "right", "dark", 0.5],
  ["first-quarter", "right", "light", 0],
  ["waxing-gibbous", "right", "light", 0.5],
  ["full", "left", "light", 1],
  ["waning-gibbous", "left", "light", 0.5],
  ["last-quarter", "left", "light", 0],
  ["waning-crescent", "left", "dark", 0.5],
];

customPhases.forEach(([customMoonPhase, lightSide, terminatorTone, terminatorScale]) => {
  const moon = generateWeatherScene({
    timestamp: fullMoonDate.getTime(),
    timePhase: "night",
    mainCondition: "clear",
    customMoonPhase,
  }).visual.celestial.moon;
  assert.strictEqual(moon.lightSide, lightSide, `${customMoonPhase} light side`);
  assert.strictEqual(moon.terminatorTone, terminatorTone, `${customMoonPhase} terminator tone`);
  assert.strictEqual(moon.terminatorScale, terminatorScale, `${customMoonPhase} terminator scale`);
});

const fogMoon = generateWeatherScene({
  timestamp: earlyMorningAfterFullDate.getTime(),
  timePhase: "lateNight",
  mainCondition: "fog",
}).visual.celestial.moon;
assert.strictEqual(fogMoon.size, 64);
assert.strictEqual(fogMoon.haloSize, 160);
assert.ok(fogMoon.opacity >= 0.5, "雾天月面不应被月晕完全洗掉");
assert.ok(fogMoon.glow <= 0.72, "雾天月晕强度应受限");

console.log("weather astronomy tests ok");
