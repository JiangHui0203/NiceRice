const assert = require("assert");
const {
  generateRandomClouds,
  resolveParticleConfig,
  createWeatherParticles,
} = require("./weatherParticleFactory.js");
const baseline = require("./weatherParticleBaseline.json");

const FIXED_VALUES = baseline.fixedValues;

function createFixedRandom() {
  let calls = 0;
  const random = () => {
    const value = FIXED_VALUES[calls % FIXED_VALUES.length];
    calls += 1;
    return value;
  };
  random.getCallCount = () => calls;
  return random;
}

function withMathRandom(random, callback) {
  const originalRandom = Math.random;
  Math.random = random;
  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
}

function countByType(particles) {
  return particles.reduce((counts, particle) => {
    counts[particle.type] = (counts[particle.type] || 0) + 1;
    return counts;
  }, {});
}

function assertCloudParity() {
  const factoryRandom = createFixedRandom();
  const defaultRandom = createFixedRandom();

  const factoryClouds = generateRandomClouds(baseline.cloud.speedMultiplier, factoryRandom);
  const defaultClouds = withMathRandom(defaultRandom, () => generateRandomClouds(baseline.cloud.speedMultiplier));

  assert.deepStrictEqual(factoryClouds, baseline.cloud.expected);
  assert.deepStrictEqual(defaultClouds, baseline.cloud.expected);
  assert.strictEqual(factoryRandom.getCallCount(), baseline.cloud.randomCalls);
  assert.strictEqual(defaultRandom.getCallCount(), baseline.cloud.randomCalls);

  const invalidSpeedRandom = createFixedRandom();
  const normalSpeedRandom = createFixedRandom();
  assert.deepStrictEqual(
    generateRandomClouds(0, invalidSpeedRandom),
    generateRandomClouds(1, normalSpeedRandom)
  );
}

function assertResolvedConfig() {
  const v2Config = resolveParticleConfig({
    mainCondition: "rain",
    rain: 90,
    snow: 80,
    windLevel: 5,
    v2Scene: {
      normalized: { timePhase: "evening" },
      visual: {
        particles: {
          rain: { visible: false, density: 0, speed: 7, angle: 9, thickness: 1.8 },
          snow: { visible: true, density: 0.25, speed: 2.2, size: 3.1 },
          wind: { visible: false, level: 1 },
        },
      },
    },
  }, 414, 236);

  assert.strictEqual(v2Config.hasRain, false);
  assert.strictEqual(v2Config.rainDensity, 0);
  assert.strictEqual(v2Config.rainSpeed, 7);
  assert.strictEqual(v2Config.rainAngle, 9);
  assert.strictEqual(v2Config.hasSnow, true);
  assert.strictEqual(v2Config.snowDensity, 0.25);
  assert.strictEqual(v2Config.snowSpeed, 2.2);
  assert.strictEqual(v2Config.windLevel, 1);
  assert.strictEqual(v2Config.hasWind, false);
  assert.strictEqual(v2Config.width, 414);
  assert.strictEqual(v2Config.height, 236);

  const legacyConfig = resolveParticleConfig({
    mainCondition: "snow",
    rain: 20,
    snow: 35,
  }, 0, null);
  assert.strictEqual(legacyConfig.hasRain, true);
  assert.strictEqual(legacyConfig.rainDensity, 0.2);
  assert.strictEqual(legacyConfig.hasSnow, true);
  assert.strictEqual(legacyConfig.snowDensity, 0.35);
  assert.strictEqual(legacyConfig.windLevel, 2);
  assert.strictEqual(legacyConfig.hasWind, true);
  assert.strictEqual(legacyConfig.width, 375);
  assert.strictEqual(legacyConfig.height, 200);
}

function assertParticleParity() {
  const { weather, width, height } = baseline.v2;
  const factoryRandom = createFixedRandom();
  const defaultRandom = createFixedRandom();

  const factoryParticles = createWeatherParticles({ weather, width, height, random: factoryRandom });
  const defaultParticles = withMathRandom(defaultRandom, () => (
    createWeatherParticles({ weather, width, height })
  ));

  assert.deepStrictEqual(factoryParticles, baseline.v2.expected);
  assert.deepStrictEqual(defaultParticles, baseline.v2.expected);
  assert.strictEqual(factoryRandom.getCallCount(), baseline.v2.randomCalls);
  assert.strictEqual(defaultRandom.getCallCount(), baseline.v2.randomCalls);
  assert.deepStrictEqual(countByType(factoryParticles), {
    rain: 7,
    snow: 6,
    leaf: 8,
    silkWind: 3,
    airMote: 8,
  });

  const firstRain = factoryParticles.find((particle) => particle.type === "rain");
  assert.deepStrictEqual(Object.keys(firstRain), [
    "x", "y", "vx", "vy", "baseVy", "length", "baseLength",
    "thickness", "opacity", "type", "layer",
  ]);
  assert.strictEqual(firstRain.x, 290.03399999999993);
  assert.strictEqual(firstRain.y, -114.4);
  assert.strictEqual(firstRain.opacity, 0.14550000000000002);
  assert.strictEqual(firstRain.layer, 1);
  const eveningLeaves = factoryParticles.filter((particle) => particle.type === "leaf");
  assert.strictEqual(eveningLeaves[0].shape, "ginkgo");
  assert.strictEqual(eveningLeaves[1].shape, "oval");
}

function assertLegacyFallbackParity() {
  const { weather, width, height } = baseline.legacy;
  const factoryRandom = createFixedRandom();

  const particles = createWeatherParticles({
    weather,
    width,
    height,
    random: factoryRandom,
  });

  assert.deepStrictEqual(particles, baseline.legacy.expected);
  assert.strictEqual(factoryRandom.getCallCount(), baseline.legacy.randomCalls);
  assert.deepStrictEqual(countByType(particles), {
    rain: 9,
    snow: 8,
    leaf: 6,
    silkWind: 3,
    airMote: 8,
  });
}

function assertUnsafeInputsAreBounded() {
  const hostileWeather = {
    mainCondition: "rain",
    intensity: Number.POSITIVE_INFINITY,
    v2Scene: {
      visual: {
        particles: {
          rain: {
            visible: true,
            density: Number.MAX_VALUE,
            speed: Number.MAX_VALUE,
            angle: Number.MAX_VALUE,
            thickness: Number.MAX_VALUE,
          },
          snow: {
            visible: true,
            density: Number.MAX_VALUE,
            speed: Number.MAX_VALUE,
            size: Number.MAX_VALUE,
          },
          wind: { visible: true, level: Number.MAX_VALUE },
        },
      },
    },
  };

  const config = resolveParticleConfig(hostileWeather, Number.POSITIVE_INFINITY, -200);
  assert.strictEqual(config.rainDensity, 1);
  assert.strictEqual(config.snowDensity, 1);
  assert.strictEqual(config.intensity, 1, "non-finite intensity should fall back to a safe default");
  assert.strictEqual(config.rainSpeed, 40);
  assert.strictEqual(config.rainAngle, 75);
  assert.strictEqual(config.snowSpeed, 8);
  assert.strictEqual(config.windLevel, 8);
  assert.strictEqual(config.width, 375);
  assert.strictEqual(config.height, 1);

  const particles = createWeatherParticles({
    weather: hostileWeather,
    width: Number.POSITIVE_INFINITY,
    height: -200,
    random: () => 0.5,
  });
  assert.strictEqual(particles.length, 125, "hostile densities must stay inside the fixed particle budget");
  assert.deepStrictEqual(countByType(particles), {
    rain: 60,
    snow: 40,
    leaf: 12,
    silkWind: 5,
    airMote: 8,
  });
  particles.forEach((particle) => {
    Object.values(particle).forEach((value) => {
      if (typeof value === "number") assert.ok(Number.isFinite(value), "particle fields must stay finite");
    });
  });

  const nonFinite = resolveParticleConfig({
    mainCondition: "rain",
    v2Scene: {
      visual: {
        particles: {
          rain: { visible: true, density: Number.POSITIVE_INFINITY, speed: Number.NaN, angle: Number.NaN },
          snow: { visible: true, density: Number.NaN, speed: Number.NEGATIVE_INFINITY },
          wind: { visible: true, level: Number.POSITIVE_INFINITY },
        },
      },
    },
  });
  assert.strictEqual(nonFinite.rainDensity, 0);
  assert.strictEqual(nonFinite.snowDensity, 0);
  assert.strictEqual(nonFinite.intensity, 1);
  assert.strictEqual(nonFinite.rainSpeed, 12);
  assert.strictEqual(nonFinite.rainAngle, 15);
  assert.strictEqual(nonFinite.snowSpeed, 1.5);
  assert.strictEqual(nonFinite.windLevel, 2);

  const finiteIntensity = resolveParticleConfig({ mainCondition: "rain", intensity: Number.MAX_VALUE });
  assert.strictEqual(finiteIntensity.intensity, 4);
  assert.strictEqual(finiteIntensity.rainDensity, 1, "bounded intensity should provide a bounded legacy density");
}

assertCloudParity();
assertResolvedConfig();
assertParticleParity();
assertLegacyFallbackParity();
assertUnsafeInputsAreBounded();

console.log("weatherParticleFactoryTests passed");
