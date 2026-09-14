/**
 * Weather Engine V2 - Element-based Composable Weather Expression Engine
 * 气象表现与决策引擎完整自包含模块
 */

const {
  getLunarMoonPhase,
  getTimePhase,
} = require("./weatherAstronomy.js");

const CUSTOM_MOON_PHASES = {
  new: { phaseLabel: "新月", illumination: 0, phaseProgress: 0, waxing: true },
  "waxing-crescent": { phaseLabel: "峨眉月", illumination: 0.25, phaseProgress: 0.125, waxing: true },
  "first-quarter": { phaseLabel: "上弦月", illumination: 0.5, phaseProgress: 0.25, waxing: true },
  "waxing-gibbous": { phaseLabel: "盈凸月", illumination: 0.75, phaseProgress: 0.375, waxing: true },
  full: { phaseLabel: "满月", illumination: 1, phaseProgress: 0.5, waxing: false },
  "waning-gibbous": { phaseLabel: "亏凸月", illumination: 0.75, phaseProgress: 0.625, waxing: false },
  "last-quarter": { phaseLabel: "下弦月", illumination: 0.5, phaseProgress: 0.75, waxing: false },
  "waning-crescent": { phaseLabel: "残月", illumination: 0.25, phaseProgress: 0.875, waxing: false },
};
const {
  THEME_PRESETS,
  blendColors,
  getAmbientGlow,
  getBackgroundGradient,
  getFrostedGlassBg,
  getTemperatureBand,
} = require("./weatherTheme.js");

// ==================== 3. 语义归一化 (Semantic Normalizer) ====================



const MAIN_CONDITION_RULES = [
  { test: (text, code) => /雷|闪电|暴风雨|thunder/.test(text) || code === "thunder_rain" || code === "thunderstorm", cond: "thunderstorm" },
  { test: (text, code) => /雨|shower|rain/.test(text) || code === "rain" || code.indexOf("rain") > -1, cond: "rain" },
  { test: (text, code) => /雪|冰雹|snow/.test(text) || code === "snow" || code.indexOf("snow") > -1 || code === "rain_snow", cond: "snow" },
  { test: (text, code) => /雾|fog/.test(text) || code === "fog", cond: "fog" },
  { test: (text, code) => /霾|haze|smog/.test(text) || code === "smog" || code === "haze", cond: "haze" },
  { test: (text, code) => /风|吹风|wind/.test(text) || code === "windy", cond: "wind" },
  { test: (text, code) => /阴|overcast/.test(text) || code === "overcast", cond: "overcast" },
  { test: (text, code) => /云|阴天|cloud/.test(text) || code === "cloudy" || code.indexOf("cloud") > -1, cond: "cloudy" },
];

function getMainCondition(conditionCode, conditionText) {
  const code = String(conditionCode || "").toLowerCase();
  const text = String(conditionText || "");
  const match = MAIN_CONDITION_RULES.find((r) => r.test(text, code));
  return match ? match.cond : "clear";
}

function buildModifiers(mainCondition, intensity, tempBand, timePhase) {
  const list = [];
  if (mainCondition === "clear" || mainCondition === "sunny") {
    if (timePhase === "night" || timePhase === "lateNight") {
      list.push("starry");
      list.push("moonGlow");
    } else {
      list.push("sunGlow");
    }
  }
  
  if (mainCondition === "cloudy") {
    if (intensity <= 1) list.push("lightCloud");
    else list.push("whiteCloud");
  } else if (mainCondition === "overcast") {
    list.push("grayCloud");
  } else if (mainCondition === "thunderstorm") {
    list.push("darkCloud");
    list.push("thunder");
    list.push("rainDrop");
  } else if (mainCondition === "rain") {
    list.push("rainDrop");
    if (intensity >= 3) list.push("darkCloud");
    else list.push("grayCloud");
  } else if (mainCondition === "snow") {
    list.push("snowFlake");
    if (intensity >= 3) list.push("darkCloud");
    else list.push("grayCloud");
  }
  
  if (tempBand === "freezing" || tempBand === "cold") {
    list.push("iceEdge");
  }
  if (tempBand === "hot" || tempBand === "extremeHot") {
    list.push("heatGlow");
  }
  
  if (mainCondition === "fog") list.push("fogLayer");
  if (mainCondition === "haze") list.push("hazeLayer");
  if (mainCondition === "wind") list.push("windLine");
  
  return list;
}

function normalizeWeather(raw) {
  const requestedDate = raw.timestamp ? new Date(raw.timestamp) : new Date();
  const date = Number.isNaN(requestedDate.getTime()) ? new Date() : requestedDate;
  const timePhase = raw.timePhase || getTimePhase(date.getHours());
  let temperature = 22;
  if (typeof raw.temperature === "number") {
    temperature = raw.temperature;
  } else if (raw.temperature !== undefined && raw.temperature !== null) {
    const matched = String(raw.temperature).match(/-?\d+/);
    if (matched) temperature = parseInt(matched[0], 10);
  }
  const temperatureBand = raw.thermalMood === "freeze" || raw.thermalMood === "cold" ? (raw.thermalMood === "freeze" ? "freezing" : "cold") : getTemperatureBand(temperature);
  
  let cond = raw.mainCondition || getMainCondition(raw.conditionCode, raw.conditionText);
  if (cond === "sunny") cond = "clear";
  if (cond === "windy") cond = "wind";
  const mainCondition = cond;
  const intensity = typeof raw.intensity === "number" ? raw.intensity : 1;
  const modifiers = raw.modifiers || buildModifiers(mainCondition, intensity, temperatureBand, timePhase);

  let windLevel = 2;
  if (typeof raw.windLevel === "number") {
    windLevel = raw.windLevel;
  } else if (typeof raw.wind === "number") {
    windLevel = raw.wind >= 30 ? 5 : (raw.wind >= 20 ? 4 : (raw.wind >= 10 ? 3 : 2));
  } else if (mainCondition === "wind") {
    windLevel = 5;
  }
  const visibility = Number(raw.visibility);
  
  return {
    locationName: raw.locationName || "当前位置",
    timestamp: date.getTime(),
    customMoonPhase: raw.customMoonPhase || "",
    timePhase,
    temperatureBand,
    mainCondition,
    intensity,
    modifiers,
    temperature,
    temperatureMin: (raw.temperatureMin !== undefined && raw.temperatureMin !== null) ? Number(raw.temperatureMin) : (temperature - 3),
    temperatureMax: (raw.temperatureMax !== undefined && raw.temperatureMax !== null) ? Number(raw.temperatureMax) : (temperature + 3),
    windLevel,
    visibilityLevel: raw.visibility !== "" && raw.visibility !== null && raw.visibility !== undefined && Number.isFinite(visibility)
      ? visibility
      : 10,
  };
}

function generateSemantic(normalized, raw) {
  const isNight = normalized.timePhase === "night" || normalized.timePhase === "lateNight";
  const isEvening = normalized.timePhase === "evening";
  const isDawn = normalized.timePhase === "dawn";
  const isStrongWind = normalized.windLevel >= 5 || normalized.mainCondition === "wind";
  const isModerateWind = normalized.windLevel >= 3 && normalized.windLevel < 5;

  let displayTitle = "多云";
  if (normalized.mainCondition === "clear") {
    if (isStrongWind) {
      displayTitle = isNight ? "晴夜强风" : "晴朗大风";
    } else {
      displayTitle = isNight ? "晴夜" : isEvening ? "晚霞晴空" : isDawn ? "晨曦初晴" : "晴朗";
    }
  } else if (normalized.mainCondition === "cloudy") {
    if (isStrongWind) {
      displayTitle = isNight ? "多云大风" : "多云大风";
    } else {
      displayTitle = isNight ? "多云夜间" : isEvening ? "暮色云天" : isDawn ? "晨云" : "多云";
    }
  } else if (normalized.mainCondition === "overcast") {
    displayTitle = isNight ? (isStrongWind ? "阴夜强风" : "阴夜") : (isStrongWind ? "阴天大风" : isEvening ? "暮色阴天" : "阴天");
  } else if (normalized.mainCondition === "rain") {
    const rainLevel = normalized.intensity >= 3 ? "大雨" : normalized.intensity === 2 ? "中雨" : "小雨";
    displayTitle = isNight ? (normalized.intensity >= 3 ? "夜间暴雨" : "夜雨") : isEvening ? `暮色${rainLevel}` : isDawn ? `晨雨` : rainLevel;
  } else if (normalized.mainCondition === "snow") {
    const snowLevel = normalized.intensity >= 3 ? "大雪" : normalized.intensity === 2 ? "中雪" : "小雪";
    displayTitle = isNight ? (normalized.intensity >= 3 ? "夜间暴雪" : "雪夜") : isEvening ? `暮雪` : isDawn ? `晨雪` : snowLevel;
  } else if (normalized.mainCondition === "fog") {
    displayTitle = isNight ? "夜雾" : isEvening ? "暮雾" : isDawn ? "晨雾" : "雾天";
  } else if (normalized.mainCondition === "haze") {
    displayTitle = isNight ? "夜间雾霾" : "霾天";
  } else if (normalized.mainCondition === "wind") {
    displayTitle = isNight ? (normalized.windLevel >= 6 ? "夜间狂风" : "夜间大风") : (normalized.windLevel >= 6 ? "狂风大作" : "大风呼啸");
  } else if (normalized.mainCondition === "thunderstorm") {
    displayTitle = isNight ? "夜间雷暴" : "雷暴";
  }

  let displaySubtitle = "适合外出活动";
  const chips = [];
  
  const isExtremeRain = normalized.mainCondition === "rain" && normalized.intensity >= 3;
  const isExtremeSnow = normalized.mainCondition === "snow" && normalized.intensity >= 3;
  const isThunderstorm = normalized.mainCondition === "thunderstorm";
  const isExtremeHot = normalized.temperatureBand === "extremeHot";
  const isExtremeCold = normalized.temperatureBand === "freezing";

  if (isExtremeRain || isExtremeSnow || isThunderstorm) {
    displaySubtitle = "⚠️ 恶劣风雨雷暴大作，安全第一，建议留在室内！";
  } else if (normalized.windLevel >= 6) {
    displaySubtitle = "⚠️ 狂风大作，小心高空坠物与广告牌，非必要减少外出！";
  } else if (isStrongWind) {
    displaySubtitle = "强风呼啸，风力强劲，出行注意防风防坠物";
  } else if (isExtremeHot) {
    displaySubtitle = "⚠️ 烈日当空酷暑难耐，安全第一，注意防暑避暑！";
  } else if (isExtremeCold) {
    displaySubtitle = "⚠️ 道路结冰寒风刺骨，安全第一，谨防路滑保暖！";
  } else if (normalized.mainCondition === "clear") {
    if (isNight) {
      displaySubtitle = isModerateWind ? "夜空明澈，晚风徐徐，适合散步" : "繁星点点，夜色宁静舒适";
    } else {
      displaySubtitle = normalized.temperatureBand === "hot" ? "烈日高照，避免中暑" : (isModerateWind ? "阳光温暖，清风徐徐" : "阳光明媚，微风不燥");
    }
  } else if (normalized.mainCondition === "rain") {
    displaySubtitle = "出门记得带伞，注意路面湿滑";
  } else if (normalized.mainCondition === "snow") {
    displaySubtitle = "银装素裹，出行注意防滑防冻";
  } else if (normalized.mainCondition === "fog" || normalized.mainCondition === "haze") {
    displaySubtitle = "能见度较低，出行请注意安全";
  } else if (normalized.mainCondition === "wind") {
    displaySubtitle = "大风呼啸，注意防风及高空坠物";
  } else {
    displaySubtitle = "体感凉爽，适合散步和探店";
  }

  switch (normalized.temperatureBand) {
    case "freezing":
      chips.push("防寒防冻", "注意防滑");
      break;
    case "cold":
      chips.push("注意保暖", "适合热锅");
      break;
    case "cool":
      chips.push("天气偏凉", "多穿外套");
      break;
    case "comfortable":
      chips.push("舒适出行", "温和宜人");
      break;
    case "warm":
      chips.push("体感微热", "清爽出行");
      break;
    case "hot":
      chips.push("烈日防晒", "多喝凉水");
      break;
    case "extremeHot":
      chips.push("避开暴晒", "极度高温");
      break;
  }

  if (normalized.mainCondition === "rain" || normalized.mainCondition === "thunderstorm") {
    chips.push(raw && raw.precip > 0 ? `雨量 ${raw.precip}mm` : "记得带伞");
  } else if (normalized.mainCondition === "snow") {
    chips.push("鞋袜防滑");
  } else if (normalized.mainCondition === "haze") {
    chips.push("佩戴口罩");
  }

  // 若实况体感温差明显（>= 2度），补充真实体感标签
  if (raw && typeof raw.feelsLike === "number" && Math.abs(raw.feelsLike - normalized.temperature) >= 2) {
    chips.push(`体感 ${raw.feelsLike}°`);
  }

  // 若风力明显（>= 3级），补充真实风向风力标签
  if (raw && raw.windLevel >= 3 && raw.windDir) {
    chips.push(`${raw.windDir} ${raw.windLevel}级`);
  }

  // AQI 不能由天气现象推导；接口未返回时保持空值，避免展示伪造数字。
  const aqiObj = raw && raw.aqi ? raw.aqi : null;

  return {
    displayTitle,
    displaySubtitle,
    temperatureText: `${normalized.temperature}°`,
    chips: chips.slice(0, 4),
    aqi: aqiObj,
  };
}



// ==================== 4. 视觉配置与业务信号 (Visual & Business Signals) ====================



function generateVisualConfig(normalized, customTheme) {
  const isNight = normalized.timePhase === "night" || normalized.timePhase === "lateNight";
  const hasClouds = ["cloudy", "overcast", "rain", "snow", "thunderstorm", "fog", "haze"].indexOf(normalized.mainCondition) > -1;
  const intensity = normalized.intensity;

  const hasModifier = (m) => (normalized.modifiers || []).indexOf(m) > -1;
  
  const hasSunGlowModifier = hasModifier('sunGlow');
  const hasMoonGlowModifier = hasModifier('moonGlow');
  const hasHeatModifier = hasModifier('heatGlow');
  const hasStarryModifier = hasModifier('starry');
  const hasRainModifier = hasModifier('rainDrop');
  const hasSnowModifier = hasModifier('snowFlake');
  const hasWindModifier = hasModifier('windLine');
  const hasThunderModifier = hasModifier('thunder');
  const hasFogModifier = hasModifier('fogLayer');
  const hasIceModifier = hasModifier('iceEdge');

  let sunVisible = !isNight && ["thunderstorm", "overcast"].indexOf(normalized.mainCondition) === -1;
  if (!isNight && (normalized.mainCondition === "rain" || normalized.mainCondition === "snow") && intensity >= 3) {
    sunVisible = false;
  }

  let moonVisible = isNight && (normalized.mainCondition !== "thunderstorm" && (normalized.mainCondition !== "rain" || intensity < 3));
  let starsVisible = isNight && (["rain", "snow", "thunderstorm", "overcast", "fog", "haze"].indexOf(normalized.mainCondition) === -1 || hasStarryModifier);

  const sun = {
    visible: sunVisible,
    opacity: sunVisible ? (
      normalized.mainCondition === "fog" ? 0.45 :
      normalized.mainCondition === "rain" ? 0.35 :
      normalized.mainCondition === "cloudy" ? 0.85 : 1.0
    ) : 0,
    size: normalized.timePhase === "evening" ? 110 : 84,
    x: normalized.timePhase === "evening" ? 62 : (normalized.timePhase === "afternoon" ? 65 : 68),
    y: normalized.timePhase === "evening" ? 65 : 30,
    glow: normalized.temperatureBand === "extremeHot" || normalized.temperatureBand === "hot" || hasSunGlowModifier ? 1.0 : 0.75,
    tint: normalized.timePhase === "evening" ? "orange" : (normalized.timePhase === "dawn" ? "gold" : "white"),
    occludedByCloud: normalized.mainCondition === "cloudy" ? 0.6 : 0,
  };

  const calculatedLunar = getLunarMoonPhase(normalized.timestamp ? new Date(normalized.timestamp) : new Date());
  const customMoon = CUSTOM_MOON_PHASES[normalized.customMoonPhase] || null;
  const moonPhase = customMoon ? normalized.customMoonPhase : calculatedLunar.phase;
  const moonPhaseLabel = customMoon ? customMoon.phaseLabel : calculatedLunar.phaseLabel;
  const moonIllumination = customMoon ? customMoon.illumination : calculatedLunar.illumination;
  const moonPhaseProgress = customMoon ? customMoon.phaseProgress : calculatedLunar.phaseProgress;
  const moonWaxing = customMoon ? customMoon.waxing : calculatedLunar.waxing;
  const terminatorScale = Math.round(Math.abs(moonIllumination * 2 - 1) * 1000) / 1000;
  const moonSize = normalized.mainCondition === "fog" || normalized.mainCondition === "rain" ? 64 : 70;
  const naturalMoonGlow = Math.round((0.35 + moonIllumination * 0.55) * 100) / 100;
  const moonGlow = hasMoonGlowModifier
    ? 1
    : (normalized.mainCondition === "fog"
      ? Math.min(0.72, naturalMoonGlow)
      : (normalized.mainCondition === "snow" ? Math.max(0.75, naturalMoonGlow) : naturalMoonGlow));

  const moon = {
    visible: moonVisible,
    opacity: moonVisible ? (
      normalized.mainCondition === "fog" ? 0.52 :
      normalized.mainCondition === "rain" ? 0.35 :
      normalized.mainCondition === "snow" ? 0.6 :
      normalized.mainCondition === "cloudy" ? 0.65 : 0.95
    ) : 0,
    size: moonSize,
    haloSize: Math.round(moonSize * 2.5),
    orbitSize: moonSize + 6,
    x: 65,
    y: 35,
    phase: moonPhase,
    phaseLabel: moonPhaseLabel,
    moonAge: calculatedLunar.moonAge,
    illumination: moonIllumination,
    phaseProgress: moonPhaseProgress,
    phaseAngle: customMoon ? customMoon.phaseProgress * 360 : calculatedLunar.phaseAngle,
    waxing: moonWaxing,
    lightSide: moonWaxing ? "right" : "left",
    terminatorTone: moonIllumination >= 0.5 ? "light" : "dark",
    terminatorScale,
    shadowWidthPercent: Math.round((1 - moonIllumination) * 100),
    showRabbit: moonPhase === "full" && moonIllumination >= 0.985,
    glow: moonGlow,
    occludedByCloud: normalized.mainCondition === "cloudy" ? 0.5 : 0,
  };

  const stars = {
    visible: starsVisible,
    density: starsVisible ? (normalized.timePhase === "lateNight" ? 0.8 : 0.5) : 0,
    opacity: starsVisible ? 0.8 : 0,
    twinkle: starsVisible,
  };

  const clouds = {
    visible: hasClouds,
    whiteCloudDensity: normalized.mainCondition === "cloudy" ? 0.7 : (normalized.mainCondition === "clear" ? 0.1 : 0),
    grayCloudDensity: ["overcast", "rain", "snow", "fog", "haze"].indexOf(normalized.mainCondition) > -1 ? 0.8 : 0,
    darkCloudDensity: normalized.mainCondition === "thunderstorm" ? 0.9 : (normalized.mainCondition === "rain" && intensity >= 3 ? 0.6 : 0),
    opacity: hasClouds ? 0.9 : 0,
    scale: normalized.mainCondition === "overcast" || normalized.mainCondition === "thunderstorm" ? 1.3 : 1.0,
    speed: normalized.mainCondition === "wind" ? 3.0 : 1.0,
    coverage: normalized.mainCondition === "overcast" || normalized.mainCondition === "thunderstorm" ? 0.95 : (normalized.mainCondition === "cloudy" ? 0.6 : 0.1),
    occludeCelestial: normalized.mainCondition === "overcast" || normalized.mainCondition === "thunderstorm" ? 1.0 : 0.4,
  };

  const particles = {
    rain: {
      visible: normalized.mainCondition === "rain" || normalized.mainCondition === "thunderstorm" || hasRainModifier,
      density: (normalized.mainCondition === "rain" || normalized.mainCondition === "thunderstorm" || hasRainModifier) ? Math.max(0.35, intensity / 4) : 0,
      speed: 10 + intensity * 4,
      angle: 10 + (normalized.windLevel || 2) * 3,
      thickness: intensity <= 1 ? 0.65 : (intensity === 2 ? 1.1 : (intensity === 3 ? 1.6 : 2.4)),
      opacity: (normalized.mainCondition === "rain" || normalized.mainCondition === "thunderstorm" || hasRainModifier) ? 0.5 + intensity * 0.1 : 0,
    },
    snow: {
      visible: normalized.mainCondition === "snow" || hasSnowModifier,
      density: (normalized.mainCondition === "snow" || hasSnowModifier) ? Math.max(0.35, intensity / 4) : 0,
      speed: 1.2 + intensity * 0.4,
      size: intensity <= 1 ? 1.4 : (intensity === 2 ? 2.2 : (intensity === 3 ? 3.4 : 4.6)),
      drift: (normalized.windLevel || 2) * 0.5,
      opacity: (normalized.mainCondition === "snow" || hasSnowModifier) ? 0.6 + intensity * 0.1 : 0,
    },
    wind: {
      visible: normalized.mainCondition === "wind" || (normalized.windLevel && normalized.windLevel >= 2) || hasWindModifier,
      level: typeof normalized.windLevel === "number" ? normalized.windLevel : 2,
      strength: Math.min(1.0, (normalized.windLevel || 2) / 6),
      lineOpacity: normalized.windLevel >= 5 ? 0.35 : (normalized.windLevel >= 3 ? 0.20 : 0.10),
      cloudSpeedMultiplier: 1 + (normalized.windLevel || 2) * 0.15,
      particleAngleOffset: (normalized.windLevel || 2) * 1.5,
    },
    thunder: {
      visible: normalized.mainCondition === "thunderstorm" || hasThunderModifier,
      frequency: normalized.mainCondition === "thunderstorm" || hasThunderModifier ? 0.05 : 0,
      brightness: 0.8,
      duration: 150,
      backgroundFlash: true,
    },
  };

  const atmosphere = {
    fog: {
      visible: normalized.mainCondition === "fog" || hasFogModifier,
      opacity: (normalized.mainCondition === "fog" || hasFogModifier) ? Math.max(0.4, 0.6 + intensity * 0.1) : 0,
      blur: 15,
      coverage: 0.9,
      driftSpeed: 0.5,
    },
    haze: {
      visible: normalized.mainCondition === "haze",
      opacity: normalized.mainCondition === "haze" ? 0.55 : 0,
      tint: normalized.timePhase === "evening" ? "yellowGray" : "gray",
      contrastReduction: 0.4,
    },
    ice: {
      visible: normalized.temperatureBand === "freezing" || normalized.temperatureBand === "cold" || hasIceModifier,
      edgeOpacity: (normalized.temperatureBand === "freezing" || hasIceModifier) ? 0.45 : 0.2,
      frostPattern: normalized.temperatureBand === "freezing" || hasIceModifier,
    },
    heat: {
      visible: normalized.temperatureBand === "extremeHot" || normalized.temperatureBand === "hot" || hasHeatModifier,
      glowStrength: (normalized.temperatureBand === "extremeHot" || hasHeatModifier) ? 0.7 : 0.35,
      shimmer: (normalized.temperatureBand === "extremeHot" || hasHeatModifier) ? 1.0 : 0.5,
    },
  };

  return {
    background: {
      gradient: getBackgroundGradient(normalized.timePhase, normalized.temperatureBand, normalized.mainCondition, customTheme),
      isNight,
    },
    frostedGlassBg: getFrostedGlassBg(normalized.timePhase, normalized.temperatureBand, normalized.mainCondition, customTheme),
    ambientGlow: getAmbientGlow(normalized.timePhase, normalized.temperatureBand, normalized.mainCondition, customTheme),
    celestial: { sun, moon, stars },
    clouds,
    particles,
    atmosphere,
  };
}

function generateBusinessSignal(normalized) {
  let outdoorScore = 85;
  let hotFoodScore = 50;
  let coldDrinkScore = 30;
  let travelPenalty = 0.0;
  let weatherRiskLevel = 0;
  const recommendedTags = [];
  const warnings = [];

  const main = normalized.mainCondition;
  const intensity = normalized.intensity;
  const temp = normalized.temperatureBand;

  if (temp === "freezing") {
    outdoorScore -= 45;
    hotFoodScore = 100;
    coldDrinkScore = 0;
    travelPenalty += 0.3;
    weatherRiskLevel = Math.max(weatherRiskLevel, normalized.temperature <= -15 ? 3 : 2);
    recommendedTags.push("避寒保暖", "吃锅取暖");
    warnings.push("天寒地冻道路结冰，请尽量避免非必要出行，防寒防滑安全第一！");
  } else if (temp === "cold") {
    outdoorScore -= 20;
    hotFoodScore = 90;
    coldDrinkScore = 5;
    travelPenalty += 0.1;
    recommendedTags.push("适合热食", "适合火锅");
  } else if (temp === "cool") {
    outdoorScore -= 5;
    hotFoodScore = 75;
    coldDrinkScore = 15;
    recommendedTags.push("吃碗暖汤", "吃个粉面");
  } else if (temp === "comfortable") {
    outdoorScore += 10;
    hotFoodScore = 40;
    coldDrinkScore = 35;
    recommendedTags.push("温和舒适", "适合散步");
  } else if (temp === "warm") {
    outdoorScore += 5;
    hotFoodScore = 20;
    coldDrinkScore = 65;
    recommendedTags.push("避暑纳凉", "咖啡甜品");
  } else if (temp === "hot") {
    outdoorScore -= 30;
    hotFoodScore = 10;
    coldDrinkScore = 90;
    travelPenalty += 0.15;
    recommendedTags.push("商超避暑", "来杯冷饮");
    warnings.push("天气炎热烈日高照，中暑风险增加，建议避暑并注意补水！");
  } else if (temp === "extremeHot") {
    outdoorScore -= 70;
    hotFoodScore = 0;
    coldDrinkScore = 100;
    travelPenalty += 0.4;
    weatherRiskLevel = Math.max(weatherRiskLevel, normalized.temperature >= 42 ? 3 : 2);
    recommendedTags.push("绝对室内", "极度避暑");
    warnings.push("酷暑暴晒热浪滚滚，请尽可能留在空调房内，减少户外活动，防暑第一！");
  }

  if (main === "rain") {
    outdoorScore -= (intensity * 22);
    hotFoodScore += 15;
    travelPenalty += (intensity * 0.20);
    weatherRiskLevel = Math.max(weatherRiskLevel, intensity >= 4 ? 3 : (intensity >= 3 ? 2 : 1));
    recommendedTags.push("室内大餐");
    warnings.push(intensity >= 3 ? "当前正下着倾盆大雨，路面积水湿滑，建议非必要不出行，注意安全！" : "出门备好雨具，注意道路湿滑");
  } else if (main === "snow") {
    outdoorScore -= (intensity * 25);
    hotFoodScore += 20;
    travelPenalty += (intensity * 0.25);
    weatherRiskLevel = Math.max(weatherRiskLevel, intensity >= 4 ? 3 : (intensity >= 3 ? 2 : 1));
    recommendedTags.push("热锅聚餐");
    warnings.push(intensity >= 3 ? "当前风雪交加道路严重结冰积雪，视线受阻易摔伤，建议留在室内避寒！" : "注意地面积雪防滑");
  } else if (main === "thunderstorm") {
    outdoorScore = 5;
    hotFoodScore = 60;
    travelPenalty = 0.9;
    weatherRiskLevel = 3;
    recommendedTags.push("建议不要外出");
    warnings.push("雷暴预警，紧闭门窗", "避免出门");
  } else if (main === "fog") {
    outdoorScore -= 25;
    travelPenalty += 0.25;
    recommendedTags.push("近距离探店");
    warnings.push("能见度低安全行车");
  } else if (main === "haze") {
    outdoorScore -= 40;
    travelPenalty += 0.15;
    recommendedTags.push("室内看展", "商圈聚餐");
    warnings.push("PM2.5偏高注意口罩");
  } else if (main === "wind") {
    outdoorScore -= (intensity * 10);
    travelPenalty += (intensity * 0.1);
    warnings.push("小心大风坠物");
  }

  outdoorScore = Math.max(0, Math.min(100, outdoorScore));
  const indoorScore = Math.max(0, Math.min(100, 100 - outdoorScore + (main !== "clear" ? 15 : 0)));
  const walkingScore = Math.max(0, Math.min(100, outdoorScore - (travelPenalty * 30)));
  
  let lightFoodScore = 100 - hotFoodScore;
  if (temp === "comfortable" || temp === "warm") {
    lightFoodScore = 80;
  }

  return {
    outdoorScore,
    indoorScore,
    walkingScore,
    hotFoodScore,
    lightFoodScore,
    coldDrinkScore: Math.min(100, coldDrinkScore),
    travelPenalty: Math.max(0, Math.min(1.0, travelPenalty)),
    weatherRiskLevel,
    recommendedTags: recommendedTags.slice(0, 3),
    warnings: warnings.slice(0, 2),
  };
}



// ==================== 5. 组合主场景入口 (Composition Scene Engine) ====================
function generateWeatherScene(raw) {
  const normalized = normalizeWeather(raw);
  return {
    normalized,
    semantic: generateSemantic(normalized, raw),
    visual: generateVisualConfig(normalized, raw.customTheme),
    business: generateBusinessSignal(normalized),
  };
}



module.exports = {
  getTimePhase,
  getTemperatureBand,
  getMainCondition,
  getLunarMoonPhase,
  normalizeWeather,
  generateWeatherScene,
  getBackgroundGradient,
  blendColors,
  THEME_PRESETS,
};
