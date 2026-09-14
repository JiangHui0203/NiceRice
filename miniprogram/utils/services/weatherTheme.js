/**
 * Pure weather palette and visual theme composition helpers.
 */

const THEME_PRESETS = {
  // Day Presets
  "ocean-blue": "linear-gradient(180deg, #3A8DFF 0%, #86C5FF 100%)",
  "dawn-pink": "linear-gradient(180deg, #FF9E79 0%, #FFD3B6 100%)",
  "sunset-gold": "linear-gradient(180deg, #3b2d54 0%, #b13b5c 50%, #f19056 100%)",
  "extreme-heat": "linear-gradient(180deg, #E52D27 0%, #F7971E 100%)",
  "rainy-gray": "linear-gradient(180deg, #3A4B5C 0%, #68798A 100%)",
  "snow-white": "linear-gradient(180deg, #7C98B3 0%, #A2B5CD 100%)",
  "haze-yellow": "linear-gradient(180deg, #7C7A6B 0%, #A8A695 100%)",
  "thunder-purple": "linear-gradient(180deg, #1A102F 0%, #3B2A56 100%)",

  // Night Matrix Presets (True Time × Weather Integration)
  "deep-night": "linear-gradient(180deg, #0A1128 0%, #101F42 100%)", // 晴夜
  "night-cloudy": "linear-gradient(180deg, #0d1527 0%, #18263e 100%)", // 多云夜
  "night-rain": "linear-gradient(180deg, #08111e 0%, #132235 100%)", // 夜雨
  "night-snow": "linear-gradient(180deg, #0a1728 0%, #1a2d48 100%)", // 雪夜
  "night-fog": "linear-gradient(180deg, #070d18 0%, #141f2e 100%)", // 雾夜
  "night-thunder": "linear-gradient(180deg, #100a20 0%, #281b3c 100%)", // 雷夜

  // Evening / Sunset Matrix Presets
  "sunset-rain": "linear-gradient(180deg, #332d44 0%, #5d4960 50%, #876b77 100%)", // 暮雨
  "sunset-fog": "linear-gradient(180deg, #483a48 0%, #7d6568 50%, #b29388 100%)", // 暮雾
  "sunset-cloudy": "linear-gradient(180deg, #44324f 0%, #9c4b64 50%, #df8b64 100%)", // 暮云

  // Dawn Matrix Presets
  "dawn-rain": "linear-gradient(180deg, #6c6374 0%, #a497a8 100%)", // 晨雨
  "dawn-fog": "linear-gradient(180deg, #8a7c87 0%, #cfbfcb 100%)", // 晨雾
};

function getTemperatureBand(temp) {
  if (temp <= 0) return "freezing";
  if (temp >= 1 && temp <= 8) return "cold";
  if (temp >= 9 && temp <= 17) return "cool";
  if (temp >= 18 && temp <= 25) return "comfortable";
  if (temp >= 26 && temp <= 30) return "warm";
  if (temp >= 31 && temp <= 35) return "hot";
  return "extremeHot";
}

function getBackgroundGradient(timePhase, tempBand, mainCondition, customTheme) {
  if (customTheme && THEME_PRESETS[customTheme]) {
    return THEME_PRESETS[customTheme];
  }
  
  const isNight = timePhase === "night" || timePhase === "lateNight";
  const isEvening = timePhase === "evening";
  const isDawn = timePhase === "dawn";

  // 1. Night Compound Blend
  if (isNight) {
    if (mainCondition === "thunderstorm") return THEME_PRESETS["night-thunder"];
    if (mainCondition === "rain") return THEME_PRESETS["night-rain"];
    if (mainCondition === "snow") return THEME_PRESETS["night-snow"];
    if (mainCondition === "fog" || mainCondition === "haze") return THEME_PRESETS["night-fog"];
    if (mainCondition === "cloudy" || mainCondition === "overcast") return THEME_PRESETS["night-cloudy"];
    return THEME_PRESETS["deep-night"];
  }

  // 2. Evening / Sunset Compound Blend
  if (isEvening) {
    if (mainCondition === "rain" || mainCondition === "thunderstorm") return THEME_PRESETS["sunset-rain"];
    if (mainCondition === "fog" || mainCondition === "haze") return THEME_PRESETS["sunset-fog"];
    if (mainCondition === "cloudy" || mainCondition === "overcast") return THEME_PRESETS["sunset-cloudy"];
    return THEME_PRESETS["sunset-gold"];
  }

  // 3. Dawn Compound Blend
  if (isDawn) {
    if (mainCondition === "rain" || mainCondition === "thunderstorm") return THEME_PRESETS["dawn-rain"];
    if (mainCondition === "fog" || mainCondition === "haze") return THEME_PRESETS["dawn-fog"];
    return THEME_PRESETS["dawn-pink"];
  }

  // 4. Daytime Heat Blend
  if (tempBand === "extremeHot" || tempBand === "hot") {
    return THEME_PRESETS["extreme-heat"];
  }

  // 5. Daytime Weather Conditions
  if (mainCondition === "thunderstorm") return THEME_PRESETS["thunder-purple"];
  if (mainCondition === "rain") return THEME_PRESETS["rainy-gray"];
  if (mainCondition === "snow") return THEME_PRESETS["snow-white"];
  if (mainCondition === "fog" || mainCondition === "haze") return THEME_PRESETS["haze-yellow"];

  return THEME_PRESETS["ocean-blue"];
}

const AMBIENT_GLOW_PRESETS = {
  "ocean-blue": "rgba(58, 141, 255, 0.28)",
  "dawn-pink": "rgba(255, 158, 121, 0.26)",
  "sunset-gold": "rgba(241, 144, 86, 0.30)",
  "extreme-heat": "rgba(229, 45, 39, 0.28)",
  "rainy-gray": "rgba(58, 75, 92, 0.32)",
  "snow-white": "rgba(124, 152, 179, 0.26)",
  "haze-yellow": "rgba(124, 122, 107, 0.26)",
  "thunder-purple": "rgba(59, 42, 86, 0.38)",
  "deep-night": "rgba(16, 31, 66, 0.38)",
  "night-cloudy": "rgba(24, 38, 62, 0.36)",
  "night-rain": "rgba(19, 34, 53, 0.38)",
  "night-snow": "rgba(26, 45, 72, 0.34)",
  "night-fog": "rgba(20, 31, 46, 0.36)",
  "night-thunder": "rgba(40, 27, 60, 0.40)",
  "sunset-rain": "rgba(135, 107, 119, 0.30)",
  "sunset-fog": "rgba(178, 147, 136, 0.28)",
  "sunset-cloudy": "rgba(223, 139, 100, 0.30)",
  "dawn-rain": "rgba(164, 151, 168, 0.26)",
  "dawn-fog": "rgba(207, 191, 203, 0.26)",
};

function getAmbientGlow(timePhase, tempBand, mainCondition, customTheme) {
  if (customTheme && AMBIENT_GLOW_PRESETS[customTheme]) {
    return AMBIENT_GLOW_PRESETS[customTheme];
  }
  
  const isNight = timePhase === "night" || timePhase === "lateNight";
  const isEvening = timePhase === "evening";
  const isDawn = timePhase === "dawn";

  if (isNight) {
    if (mainCondition === "thunderstorm") return AMBIENT_GLOW_PRESETS["night-thunder"];
    if (mainCondition === "rain") return AMBIENT_GLOW_PRESETS["night-rain"];
    if (mainCondition === "snow") return AMBIENT_GLOW_PRESETS["night-snow"];
    if (mainCondition === "fog" || mainCondition === "haze") return AMBIENT_GLOW_PRESETS["night-fog"];
    if (mainCondition === "cloudy" || mainCondition === "overcast") return AMBIENT_GLOW_PRESETS["night-cloudy"];
    return AMBIENT_GLOW_PRESETS["deep-night"];
  }

  if (isEvening) {
    if (mainCondition === "rain" || mainCondition === "thunderstorm") return AMBIENT_GLOW_PRESETS["sunset-rain"];
    if (mainCondition === "fog" || mainCondition === "haze") return AMBIENT_GLOW_PRESETS["sunset-fog"];
    if (mainCondition === "cloudy" || mainCondition === "overcast") return AMBIENT_GLOW_PRESETS["sunset-cloudy"];
    return AMBIENT_GLOW_PRESETS["sunset-gold"];
  }

  if (isDawn) {
    if (mainCondition === "rain" || mainCondition === "thunderstorm") return AMBIENT_GLOW_PRESETS["dawn-rain"];
    if (mainCondition === "fog" || mainCondition === "haze") return AMBIENT_GLOW_PRESETS["dawn-fog"];
    return AMBIENT_GLOW_PRESETS["dawn-pink"];
  }

  if (tempBand === "extremeHot" || tempBand === "hot") {
    return AMBIENT_GLOW_PRESETS["extreme-heat"];
  }

  if (mainCondition === "thunderstorm") return AMBIENT_GLOW_PRESETS["thunder-purple"];
  if (mainCondition === "rain") return AMBIENT_GLOW_PRESETS["rainy-gray"];
  if (mainCondition === "snow") return AMBIENT_GLOW_PRESETS["snow-white"];
  if (mainCondition === "fog" || mainCondition === "haze") return AMBIENT_GLOW_PRESETS["haze-yellow"];

  return AMBIENT_GLOW_PRESETS["ocean-blue"];
}

const FROSTED_GLASS_PRESETS = {
  "ocean-blue": "linear-gradient(135deg, rgba(255, 255, 255, 0.28) 0%, rgba(255, 255, 255, 0.12) 100%)",
  "dawn-pink": "linear-gradient(135deg, rgba(255, 240, 235, 0.32) 0%, rgba(255, 215, 195, 0.14) 100%)",
  "sunset-gold": "linear-gradient(135deg, rgba(75, 45, 70, 0.45) 0%, rgba(180, 80, 70, 0.22) 100%)",
  "extreme-heat": "linear-gradient(135deg, rgba(200, 40, 30, 0.35) 0%, rgba(240, 130, 30, 0.18) 100%)",
  "rainy-gray": "linear-gradient(135deg, rgba(40, 52, 65, 0.45) 0%, rgba(75, 90, 105, 0.25) 100%)",
  "snow-white": "linear-gradient(135deg, rgba(255, 255, 255, 0.35) 0%, rgba(160, 185, 210, 0.18) 100%)",
  "haze-yellow": "linear-gradient(135deg, rgba(90, 88, 75, 0.40) 0%, rgba(140, 138, 120, 0.22) 100%)",
  "thunder-purple": "linear-gradient(135deg, rgba(30, 18, 50, 0.50) 0%, rgba(60, 40, 85, 0.28) 100%)",
  "deep-night": "linear-gradient(135deg, rgba(10, 17, 40, 0.50) 0%, rgba(20, 35, 70, 0.28) 100%)",
  "night-cloudy": "linear-gradient(135deg, rgba(13, 21, 39, 0.48) 0%, rgba(25, 40, 65, 0.26) 100%)",
  "night-rain": "linear-gradient(135deg, rgba(8, 17, 30, 0.52) 0%, rgba(20, 38, 60, 0.28) 100%)",
  "night-snow": "linear-gradient(135deg, rgba(10, 23, 40, 0.48) 0%, rgba(30, 50, 80, 0.25) 100%)",
  "night-fog": "linear-gradient(135deg, rgba(7, 13, 24, 0.52) 0%, rgba(22, 35, 52, 0.28) 100%)",
  "night-thunder": "linear-gradient(135deg, rgba(18, 10, 35, 0.55) 0%, rgba(45, 30, 70, 0.30) 100%)",
  "sunset-rain": "linear-gradient(135deg, rgba(50, 42, 65, 0.45) 0%, rgba(110, 85, 98, 0.22) 100%)",
  "sunset-fog": "linear-gradient(135deg, rgba(65, 52, 65, 0.42) 0%, rgba(140, 115, 110, 0.22) 100%)",
  "sunset-cloudy": "linear-gradient(135deg, rgba(60, 45, 75, 0.45) 0%, rgba(175, 95, 80, 0.22) 100%)",
  "dawn-rain": "linear-gradient(135deg, rgba(90, 82, 98, 0.40) 0%, rgba(150, 138, 155, 0.20) 100%)",
  "dawn-fog": "linear-gradient(135deg, rgba(120, 108, 118, 0.38) 0%, rgba(185, 170, 182, 0.20) 100%)",
};

function getFrostedGlassBg(timePhase, tempBand, mainCondition, customTheme) {
  if (customTheme && FROSTED_GLASS_PRESETS[customTheme]) {
    return FROSTED_GLASS_PRESETS[customTheme];
  }
  
  const isNight = timePhase === "night" || timePhase === "lateNight";
  const isEvening = timePhase === "evening";
  const isDawn = timePhase === "dawn";

  if (isNight) {
    if (mainCondition === "thunderstorm") return FROSTED_GLASS_PRESETS["night-thunder"];
    if (mainCondition === "rain") return FROSTED_GLASS_PRESETS["night-rain"];
    if (mainCondition === "snow") return FROSTED_GLASS_PRESETS["night-snow"];
    if (mainCondition === "fog" || mainCondition === "haze") return FROSTED_GLASS_PRESETS["night-fog"];
    if (mainCondition === "cloudy" || mainCondition === "overcast") return FROSTED_GLASS_PRESETS["night-cloudy"];
    return FROSTED_GLASS_PRESETS["deep-night"];
  }

  if (isEvening) {
    if (mainCondition === "rain" || mainCondition === "thunderstorm") return FROSTED_GLASS_PRESETS["sunset-rain"];
    if (mainCondition === "fog" || mainCondition === "haze") return FROSTED_GLASS_PRESETS["sunset-fog"];
    if (mainCondition === "cloudy" || mainCondition === "overcast") return FROSTED_GLASS_PRESETS["sunset-cloudy"];
    return FROSTED_GLASS_PRESETS["sunset-gold"];
  }

  if (isDawn) {
    if (mainCondition === "rain" || mainCondition === "thunderstorm") return FROSTED_GLASS_PRESETS["dawn-rain"];
    if (mainCondition === "fog" || mainCondition === "haze") return FROSTED_GLASS_PRESETS["dawn-fog"];
    return FROSTED_GLASS_PRESETS["dawn-pink"];
  }

  if (tempBand === "extremeHot" || tempBand === "hot") {
    return FROSTED_GLASS_PRESETS["extreme-heat"];
  }

  if (mainCondition === "thunderstorm") return FROSTED_GLASS_PRESETS["thunder-purple"];
  if (mainCondition === "rain") return FROSTED_GLASS_PRESETS["rainy-gray"];
  if (mainCondition === "snow") return FROSTED_GLASS_PRESETS["snow-white"];
  if (mainCondition === "fog" || mainCondition === "haze") return FROSTED_GLASS_PRESETS["haze-yellow"];

  return FROSTED_GLASS_PRESETS["ocean-blue"];
}

function blendColors(c1, c2, weight) {
  const getRGB = (hex) => {
    let clean = hex.replace("#", "");
    if (clean.length === 3) {
      clean = clean.split("").map((c) => c + c).join("");
    }
    const val = parseInt(clean, 16);
    return {
      r: (val >> 16) & 255,
      g: (val >> 8) & 255,
      b: val & 255,
    };
  };
  const rgb1 = getRGB(c1);
  const rgb2 = getRGB(c2);
  const r = Math.round(rgb1.r * (1 - weight) + rgb2.r * weight);
  const g = Math.round(rgb1.g * (1 - weight) + rgb2.g * weight);
  const b = Math.round(rgb1.b * (1 - weight) + rgb2.b * weight);
  const pad = (v) => v.toString(16).padStart(2, "0");
  return `#${pad(r)}${pad(g)}${pad(b)}`;
}

module.exports = {
  THEME_PRESETS,
  blendColors,
  getAmbientGlow,
  getBackgroundGradient,
  getFrostedGlassBg,
  getTemperatureBand,
};
