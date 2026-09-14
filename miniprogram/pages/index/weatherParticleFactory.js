/**
 * 首页天气动画的纯数据工厂。
 *
 * 注意：粒子动画依赖随机数的调用次数与顺序。调整本文件时不要合并、提前或
 * 重排 random() 调用，否则即使字段公式不变，也会改变整组粒子的视觉分布。
 */

const CLOUD_DEPTHS = [
  { baseSpeed: 45, baseOpacity: 0.14, minWidth: 160, maxWidth: 200, height: 50, topMin: 5, topMax: 16 },
  { baseSpeed: 30, baseOpacity: 0.28, minWidth: 220, maxWidth: 260, height: 70, topMin: 16, topMax: 30 },
  { baseSpeed: 20, baseOpacity: 0.45, minWidth: 280, maxWidth: 340, height: 90, topMin: 30, topMax: 46 },
  { baseSpeed: 36, baseOpacity: 0.22, minWidth: 190, maxWidth: 230, height: 60, topMin: 10, topMax: 24 },
];

const PARTICLE_LIMITS = {
  density: { min: 0, max: 1 },
  windLevel: { min: 0, max: 8 },
  rainSpeed: { min: 0.5, max: 40 },
  rainAngle: { min: -75, max: 75 },
  rainThickness: { min: 0.25, max: 4 },
  snowSpeed: { min: 0.2, max: 8 },
  snowSize: { min: 0.5, max: 8 },
  canvasSize: { min: 1, max: 4096 },
  cloudSpeed: { min: 0.1, max: 4 },
};

function finiteWithin(value, fallback, limits) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(limits.min, Math.min(limits.max, value));
}

function generateRandomClouds(speedMultiplier = 1.0, random = Math.random) {
  speedMultiplier = speedMultiplier <= 0
    ? 1.0
    : finiteWithin(speedMultiplier, 1.0, PARTICLE_LIMITS.cloudSpeed);

  return CLOUD_DEPTHS.map((d, i) => {
    const width = Math.floor(d.minWidth + random() * (d.maxWidth - d.minWidth));
    const top = Math.floor(d.topMin + random() * (d.topMax - d.topMin));

    let bSize, aSize;
    let bLeft, aRight;

    if (i % 2 === 0) {
      bSize = Math.floor(d.height * (0.85 + random() * 0.20));
      aSize = Math.floor(d.height * (0.75 + random() * 0.15));
      bLeft = Math.floor(width * 0.24 + random() * (width * 0.10));
      aRight = Math.floor(width * 0.22 + random() * (width * 0.10));
    } else {
      bSize = Math.floor(d.height * (1.15 + random() * 0.20));
      aSize = Math.floor(d.height * (0.60 + random() * 0.15));
      bLeft = Math.floor(width * 0.35 + random() * (width * 0.10));
      aRight = Math.floor(width * 0.14 + random() * (width * 0.08));
    }

    return {
      id: i,
      width,
      height: d.height,
      top,
      opacity: d.baseOpacity,
      duration: Math.max(8, Math.floor((d.baseSpeed * (0.8 + random() * 0.4)) / speedMultiplier)),
      delay: -(random() * 40),

      bSize,
      bTop: -Math.floor(bSize * 0.5),
      bLeft,

      aSize,
      aTop: -Math.floor(aSize * 0.45),
      aRight,
    };
  });
}

function resolveParticleConfig(weather, width, height) {
  weather = weather || {};
  const v2Scene = weather.v2Scene || {};
  const v2Visual = v2Scene.visual || {};
  const v2Particles = v2Visual.particles || {};
  const intensity = finiteWithin(weather.intensity, 1, { min: 0, max: 4 });
  const legacyRainDensity = typeof weather.rain !== "undefined"
    ? finiteWithin(weather.rain, 0, { min: 0, max: 100 }) / 100
    : (weather.mainCondition === "rain" ? intensity / 4 : 0);
  const legacySnowDensity = typeof weather.snow !== "undefined"
    ? finiteWithin(weather.snow, 0, { min: 0, max: 100 }) / 100
    : (weather.mainCondition === "snow" ? intensity / 4 : 0);

  const hasRain = v2Particles.rain ? v2Particles.rain.visible : (weather.mainCondition === "rain" || typeof weather.rain !== "undefined" && weather.rain > 0);
  const rainDensity = v2Particles.rain
    ? finiteWithin(v2Particles.rain.density, 0, PARTICLE_LIMITS.density)
    : legacyRainDensity;
  const rainSpeed = finiteWithin(v2Particles.rain ? v2Particles.rain.speed : 12, 12, PARTICLE_LIMITS.rainSpeed);
  const rainAngle = finiteWithin(v2Particles.rain ? v2Particles.rain.angle : 15, 15, PARTICLE_LIMITS.rainAngle);

  const hasSnow = v2Particles.snow ? v2Particles.snow.visible : (weather.mainCondition === "snow" || typeof weather.snow !== "undefined" && weather.snow > 0);
  const snowDensity = v2Particles.snow
    ? finiteWithin(v2Particles.snow.density, 0, PARTICLE_LIMITS.density)
    : legacySnowDensity;
  const snowSpeed = finiteWithin(v2Particles.snow ? v2Particles.snow.speed : 1.5, 1.5, PARTICLE_LIMITS.snowSpeed);

  const defaultWindLevel = weather.mainCondition === "wind" ? 4 : 2;
  const rawWindLevel = (v2Particles.wind && typeof v2Particles.wind.level === "number")
    ? v2Particles.wind.level
    : (typeof weather.windLevel === "number" ? weather.windLevel : defaultWindLevel);
  const windLevel = Math.round(finiteWithin(rawWindLevel, defaultWindLevel, PARTICLE_LIMITS.windLevel));
  const hasWind = (v2Particles.wind && v2Particles.wind.visible) || weather.mainCondition === "wind" || windLevel >= 2;

  return {
    weather,
    intensity,
    v2Scene,
    v2Particles,
    hasRain,
    rainDensity,
    rainSpeed,
    rainAngle,
    hasSnow,
    snowDensity,
    snowSpeed,
    windLevel,
    hasWind,
    width: finiteWithin(width || 375, 375, PARTICLE_LIMITS.canvasSize),
    height: finiteWithin(height || 200, 200, PARTICLE_LIMITS.canvasSize),
  };
}

function createWeatherParticles({ weather, width, height, random = Math.random } = {}) {
  const config = resolveParticleConfig(weather, width, height);
  const {
    v2Scene,
    v2Particles,
    hasRain,
    rainDensity,
    rainSpeed,
    rainAngle,
    hasSnow,
    snowDensity,
    snowSpeed,
    windLevel,
    hasWind,
  } = config;
  width = config.width;
  height = config.height;
  const particles = [];

  if (hasRain && rainDensity > 0) {
    const count = Math.floor(rainDensity * 60);
    const baseSpeed = rainSpeed;
    const baseThickness = finiteWithin(
      v2Particles.rain ? v2Particles.rain.thickness : 1.2,
      1.2,
      PARTICLE_LIMITS.rainThickness
    );
    const rad = (rainAngle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    for (let i = 0; i < count; i++) {
      const rand = random();
      let layer = 2;
      let opacity = 0.35;
      let speedScale = 1.0;
      let lenScale = 1.0;
      let thickScale = 1.0;

      if (rand < 0.5) {
        layer = 1;
        opacity = 0.10 + random() * 0.05;
        speedScale = 0.6;
        lenScale = 0.65;
        thickScale = 0.65;
      } else if (rand > 0.85) {
        layer = 3;
        opacity = 0.50 + random() * 0.1;
        speedScale = 1.35;
        lenScale = 1.45;
        thickScale = 1.45;
      }

      const speed = (baseSpeed + random() * 2) * speedScale;
      const lengthVal = (20 + rainDensity * 20) * lenScale;
      const vyVal = speed * cos;

      particles.push({
        x: random() * width * 1.4 - width * 0.2,
        y: random() * height - height,
        vx: speed * sin,
        vy: vyVal,
        baseVy: vyVal,
        length: lengthVal,
        baseLength: lengthVal,
        thickness: baseThickness * thickScale,
        opacity: opacity,
        type: "rain",
        layer: layer
      });
    }
  }
  if (hasSnow && snowDensity > 0) {
    const count = Math.floor(snowDensity * 40);
    const baseSpeed = snowSpeed;
    const baseRadius = finiteWithin(
      v2Particles.snow ? v2Particles.snow.size : 2.0,
      2.0,
      PARTICLE_LIMITS.snowSize
    );

    for (let i = 0; i < count; i++) {
      const rand = random();
      let opacity = 0.4;
      let speedScale = 1.0;
      let radiusScale = 1.0;
      let layer = 2;

      if (rand < 0.5) {
        layer = 1;
        opacity = 0.18 + random() * 0.05;
        speedScale = 0.65;
        radiusScale = 0.65;
      } else if (rand > 0.85) {
        layer = 3;
        opacity = 0.60 + random() * 0.1;
        speedScale = 1.25;
        radiusScale = 1.5;
      }

      particles.push({
        x: random() * width,
        y: random() * height - height,
        vx: (random() * 0.4 - 0.2 + (windLevel * 0.1)) * speedScale,
        vy: (baseSpeed + random() * 0.4) * speedScale,
        radius: baseRadius * radiusScale,
        opacity: opacity,
        swingSpeed: 0.02 + random() * 0.02,
        swingRange: 0.4 + random() * 0.6,
        swingOffset: random() * 10,
        type: "snow",
        layer: layer
      });
    }
  }

  if (hasWind && windLevel >= 1) {
    const isEveningTime = v2Scene.normalized && v2Scene.normalized.timePhase === "evening";

    const leafCount = windLevel <= 1 ? 3 : (windLevel === 2 ? 4 : (windLevel === 3 ? 6 : (windLevel === 4 ? 8 : 12)));
    for (let i = 0; i < leafCount; i++) {
      let shape = "oval";
      let leafColor = "rgba(110, 231, 183, 0.90)";
      let veinColor = "rgba(52, 211, 153, 0.95)";

      if (isEveningTime) {
        if (i % 2 === 0) {
          shape = "ginkgo";
          leafColor = "rgba(253, 224, 71, 0.92)";
          veinColor = "rgba(245, 158, 11, 0.95)";
        } else {
          shape = "oval";
          leafColor = "rgba(251, 146, 60, 0.90)";
          veinColor = "rgba(234, 88, 12, 0.95)";
        }
      } else if (i % 2 === 1) {
        shape = "petal";
        leafColor = "rgba(251, 207, 232, 0.92)";
        veinColor = "rgba(244, 114, 182, 0.95)";
      } else if (i % 3 === 2) {
        shape = "oval";
        leafColor = "rgba(74, 222, 128, 0.88)";
        veinColor = "rgba(22, 163, 74, 0.95)";
      }

      const baseSpeed = windLevel <= 2
        ? (0.32 + (windLevel - 1) * 0.10)
        : (0.55 + (windLevel - 2) * 0.45);

      particles.push({
        x: random() * (width + 80) - 40,
        y: random() * height,
        vx: baseSpeed + random() * 0.18,
        vy: 0.08 + random() * 0.12,
        size: 5.5 + random() * 3.5,
        shape: shape,
        angle: random() * Math.PI * 2,
        rotSpeed: (random() - 0.5) * 0.012,
        tumbleAngle: random() * Math.PI * 2,
        tumbleSpeed: 0.010 + random() * 0.015,
        phase: random() * Math.PI * 2,
        color: leafColor,
        veinColor: veinColor,
        type: "leaf",
      });
    }

    const ribbonCount = windLevel <= 1 ? 1 : (windLevel === 2 ? 2 : (windLevel <= 4 ? 3 : 5));
    for (let i = 0; i < ribbonCount; i++) {
      const speed = windLevel <= 2
        ? (0.46 + (windLevel - 1) * 0.16 + random() * 0.20)
        : (0.85 + (windLevel - 2) * 0.55 + random() * 0.35);
      const length = 38 + (windLevel - 1) * 12 + random() * 20;
      const opacity = windLevel <= 2 ? 0.15 : (windLevel <= 4 ? 0.26 : 0.40);
      particles.push({
        x: random() * width - 40,
        y: random() * height,
        vx: speed,
        vy: (random() - 0.5) * 0.15,
        baseVx: speed,
        length,
        thickness: 0.8 + random() * 0.5,
        opacity,
        gustFactor: 0.15 + (windLevel - 1) * 0.08,
        waveAmp: 1.8 + random() * 2.0,
        phase: random() * Math.PI * 2,
        type: "silkWind",
      });
    }

    const moteCount = windLevel <= 2 ? 4 : 8;
    for (let i = 0; i < moteCount; i++) {
      particles.push({
        x: random() * width,
        y: random() * height,
        vx: 0.22 + (windLevel - 1) * 0.15 + random() * 0.12,
        vy: (random() - 0.5) * 0.12,
        radius: 0.8 + random() * 1.0,
        opacity: 0.18 + random() * 0.25,
        phase: random() * Math.PI * 2,
        type: "airMote",
      });
    }
  }
  return particles;
}

module.exports = {
  generateRandomClouds,
  resolveParticleConfig,
  createWeatherParticles,
};
