/**
 * Universal Weather API Adapter (全协议气象API智能适配器)
 * Supports automatic format detection & normalization for:
 * 1. QWeather (和风天气 API v7)
 * 2. Amap (高德地图天气 API)
 * 3. Caiyun (彩云天气 API v2.5/v2.6)
 * 4. OpenWeatherMap (OWM API 2.5/3.0)
 * 5. Standard Unified JSON Schema
 */

const weatherEngine = require("./weatherEngine.js");

function numberOr(value, fallback) {
  if (value === "" || value === null || value === undefined) return fallback;
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  if (typeof value === "string" && !value.trim()) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readTemperature(value) {
  const parsed = numberOr(value, null);
  return Number.isFinite(parsed) && parsed >= -100 && parsed <= 100 ? parsed : null;
}

function readFiniteNumber(value) {
  const parsed = numberOr(value, null);
  return Number.isFinite(parsed) ? parsed : null;
}

function readText(value, maxLength = 64) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().slice(0, maxLength);
}

// QWeather condition code mapping (和风天气官方全量代码映射表)
const QWEATHER_CODE_MAP = {
  // 晴类
  "100": { condition: "clear", intensity: 1 }, // 晴 (白天)
  "150": { condition: "clear", intensity: 1 }, // 晴 (夜间)
  // 多云 / 阴类
  "101": { condition: "cloudy", intensity: 1 }, // 多云 (白天)
  "102": { condition: "cloudy", intensity: 1 }, // 少云 (白天)
  "103": { condition: "cloudy", intensity: 2 }, // 晴间多云 (白天)
  "104": { condition: "overcast", intensity: 3 }, // 阴
  "151": { condition: "cloudy", intensity: 1 }, // 多云 (夜间)
  "152": { condition: "cloudy", intensity: 1 }, // 少云 (夜间)
  "153": { condition: "cloudy", intensity: 2 }, // 晴间多云 (夜间)
  // 降雨类
  "300": { condition: "rain", intensity: 2 }, // 阵雨 (白天)
  "301": { condition: "rain", intensity: 3 }, // 强阵雨 (白天)
  "302": { condition: "thunderstorm", intensity: 3 }, // 雷阵雨
  "303": { condition: "thunderstorm", intensity: 4 }, // 强雷阵雨
  "304": { condition: "thunderstorm", intensity: 4 }, // 雷阵雨伴有冰雹
  "305": { condition: "rain", intensity: 1 }, // 小雨
  "306": { condition: "rain", intensity: 2 }, // 中雨
  "307": { condition: "rain", intensity: 3 }, // 大雨
  "308": { condition: "rain", intensity: 4 }, // 极端降雨
  "309": { condition: "rain", intensity: 1 }, // 毛毛雨/细雨
  "310": { condition: "rain", intensity: 4 }, // 暴雨
  "311": { condition: "rain", intensity: 4 }, // 大暴雨
  "312": { condition: "rain", intensity: 4 }, // 特大暴雨
  "313": { condition: "rain", intensity: 2 }, // 冻雨
  "314": { condition: "rain", intensity: 1 }, // 小到中雨
  "315": { condition: "rain", intensity: 2 }, // 中到大雨
  "316": { condition: "rain", intensity: 3 }, // 大到暴雨
  "317": { condition: "rain", intensity: 4 }, // 暴雨到大暴雨
  "318": { condition: "rain", intensity: 4 }, // 大暴雨到特大暴雨
  "350": { condition: "rain", intensity: 2 }, // 阵雨 (夜间)
  "351": { condition: "rain", intensity: 3 }, // 强阵雨 (夜间)
  "399": { condition: "rain", intensity: 2 }, // 雨
  // 降雪类
  "400": { condition: "snow", intensity: 1 }, // 小雪
  "401": { condition: "snow", intensity: 2 }, // 中雪
  "402": { condition: "snow", intensity: 3 }, // 大雪
  "403": { condition: "snow", intensity: 4 }, // 暴雪
  "404": { condition: "snow", intensity: 2 }, // 雨夹雪
  "405": { condition: "snow", intensity: 2 }, // 雨雪天气
  "406": { condition: "snow", intensity: 2 }, // 阵雨夹雪 (白天)
  "407": { condition: "snow", intensity: 2 }, // 阵雪 (白天)
  "408": { condition: "snow", intensity: 2 }, // 小到中雪
  "409": { condition: "snow", intensity: 3 }, // 中到大雪
  "410": { condition: "snow", intensity: 4 }, // 大到暴雪
  "456": { condition: "snow", intensity: 2 }, // 阵雨夹雪 (夜间)
  "457": { condition: "snow", intensity: 2 }, // 阵雪 (夜间)
  "499": { condition: "snow", intensity: 2 }, // 雪
  // 雾霾 / 沙尘类
  "500": { condition: "fog", intensity: 1 }, // 薄雾
  "501": { condition: "fog", intensity: 2 }, // 雾
  "502": { condition: "haze", intensity: 2 }, // 霾
  "503": { condition: "haze", intensity: 2 }, // 扬沙
  "504": { condition: "haze", intensity: 3 }, // 浮尘
  "507": { condition: "haze", intensity: 4 }, // 沙尘暴
  "508": { condition: "haze", intensity: 4 }, // 强沙尘暴
  "509": { condition: "fog", intensity: 3 }, // 浓雾
  "510": { condition: "fog", intensity: 4 }, // 强浓雾
  "511": { condition: "haze", intensity: 3 }, // 中度霾
  "512": { condition: "haze", intensity: 4 }, // 重度霾
  "513": { condition: "haze", intensity: 4 }, // 严重霾
  "514": { condition: "fog", intensity: 4 }, // 大雾
  "515": { condition: "fog", intensity: 4 }, // 特强浓雾
  // 特殊 / 极端
  "900": { condition: "clear", intensity: 1 }, // 热
  "901": { condition: "clear", intensity: 1 }, // 冷
};

function matchQWeatherCode(iconCode, text = "") {
  const code = String(iconCode || "").trim();
  if (QWEATHER_CODE_MAP[code]) {
    return QWEATHER_CODE_MAP[code];
  }
  // 智能容错：若返回未收录的新代码，按官方文字描述模糊匹配
  if (text.includes("雷")) return { condition: "thunderstorm", intensity: 3 };
  if (text.includes("雪")) return { condition: "snow", intensity: text.includes("暴") ? 4 : text.includes("大") ? 3 : 2 };
  if (text.includes("雨")) return { condition: "rain", intensity: text.includes("暴") ? 4 : text.includes("大") ? 3 : 2 };
  if (text.includes("雾")) return { condition: "fog", intensity: 2 };
  if (text.includes("霾") || text.includes("沙") || text.includes("尘")) return { condition: "haze", intensity: 3 };
  if (text.includes("阴")) return { condition: "overcast", intensity: 3 };
  if (text.includes("云")) return { condition: "cloudy", intensity: 1 };
  if (text.includes("晴")) return { condition: "clear", intensity: 1 };
  return null;
}

// Caiyun Skycon code mapping (彩云天气代码映射)
const CAIYUN_SKYCON_MAP = {
  CLEAR_DAY: { condition: "clear", timePhase: "afternoon", intensity: 1 },
  CLEAR_NIGHT: { condition: "clear", timePhase: "night", intensity: 1 },
  PARTLY_CLOUDY_DAY: { condition: "cloudy", timePhase: "afternoon", intensity: 1 },
  PARTLY_CLOUDY_NIGHT: { condition: "cloudy", timePhase: "night", intensity: 1 },
  CLOUDY: { condition: "cloudy", intensity: 2 },
  LIGHT_HAZE: { condition: "haze", intensity: 1 },
  MODERATE_HAZE: { condition: "haze", intensity: 2 },
  HEAVY_HAZE: { condition: "haze", intensity: 3 },
  LIGHT_RAIN: { condition: "rain", intensity: 1 },
  MODERATE_RAIN: { condition: "rain", intensity: 2 },
  HEAVY_RAIN: { condition: "rain", intensity: 3 },
  STORM_RAIN: { condition: "rain", intensity: 4 },
  FOG: { condition: "fog", intensity: 2 },
  LIGHT_SNOW: { condition: "snow", intensity: 1 },
  MODERATE_SNOW: { condition: "snow", intensity: 2 },
  HEAVY_SNOW: { condition: "snow", intensity: 3 },
  STORM_SNOW: { condition: "snow", intensity: 4 },
  DUST: { condition: "haze", intensity: 2 },
  SAND: { condition: "haze", intensity: 3 },
  WIND: { condition: "wind", intensity: 3 },
};

/**
 * Detects the source/provider of raw weather API JSON payload
 */
function detectApiProvider(payload) {
  if (!payload || typeof payload !== "object") return "unknown";
  if (payload.now && payload.code === "200") return "qweather";
  if (payload.lives && Array.isArray(payload.lives) && payload.info === "OK") return "amap";
  if (payload.result && payload.result.realtime && payload.server_time) return "caiyun";
  if (payload.weather && Array.isArray(payload.weather) && payload.main) return "openweathermap";
  return "standard";
}

/**
 * Universal Parser: converts any raw API payload into Normalized Weather V2 Scene
 */
function parseWeatherApiResponse(payload, providerOverride) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const provider = providerOverride || detectApiProvider(payload);
  if (["qweather", "amap", "caiyun", "openweathermap", "standard"].indexOf(provider) < 0) {
    return null;
  }
  const now = new Date();
  const hour = now.getHours();
  let timePhase = weatherEngine.getTimePhase(hour);

  let raw = {
    locationName: "当前位置",
    timePhase,
    timestamp: Date.now(),
  };

  if (provider === "qweather") {
    // 和风天气 API v7 完整字段解析
    const nowData = payload.now && typeof payload.now === "object" ? payload.now : null;
    if (!nowData) return null;
    const temperature = readTemperature(nowData.temp);
    const iconCode = readText(nowData.icon, 16);
    const text = readText(nowData.text);
    const matched = matchQWeatherCode(iconCode, text);
    if (temperature === null || !matched || !iconCode || !text) return null;

    raw.temperature = temperature;
    raw.conditionCode = iconCode;
    raw.conditionText = text;
    raw.mainCondition = matched.condition;
    raw.intensity = matched.intensity;

    // 风力、风向与风速解析
    const windScale = parseInt(String(nowData.windScale || "").split("-")[0], 10);
    const windSpeed = readFiniteNumber(nowData.windSpeed);
    if (!isNaN(windScale)) raw.windLevel = Math.max(0, Math.min(6, windScale));
    else if (windSpeed !== null) raw.windLevel = Math.max(0, Math.min(6, Math.floor(windSpeed / 10)));
    const windDir = readText(nowData.windDir);
    if (windDir) raw.windDir = windDir;
    if (windSpeed !== null) raw.windSpeed = windSpeed;
    const wind360 = readFiniteNumber(nowData.wind360);
    if (wind360 !== null) raw.wind360 = wind360;

    // 体感温度
    const feelsLike = readTemperature(nowData.feelsLike);
    if (feelsLike !== null) raw.feelsLike = feelsLike;

    // 湿度、降水、气压、能见度、云量与露点
    const humidity = readFiniteNumber(nowData.humidity);
    const precip = readFiniteNumber(nowData.precip);
    const pressure = readFiniteNumber(nowData.pressure);
    const visibility = readFiniteNumber(nowData.vis);
    const cloud = readFiniteNumber(nowData.cloud);
    const dew = readTemperature(nowData.dew);
    if (humidity !== null) raw.humidity = humidity;
    if (precip !== null) {
      raw.precip = precip;
      raw.rain = precip > 0 ? Math.min(100, Math.round(precip * 10)) : (raw.mainCondition === "rain" ? 40 : 0);
    }
    if (pressure !== null) raw.pressure = pressure;
    if (visibility !== null) raw.visibility = visibility;
    if (cloud !== null) raw.cloud = cloud;
    if (dew !== null) raw.dew = dew;

    const locationName = readText(payload.locationName, 64);
    const aqi = readFiniteNumber(payload.aqi);
    if (locationName) raw.locationName = locationName;
    if (aqi !== null) raw.aqi = { text: `AQI ${aqi}`, class: aqi <= 50 ? "excellent" : "good" };

    // 更新时间解析
    const updateTimeStr = payload.updateTime || nowData.obsTime;
    if (updateTimeStr) {
      const d = new Date(updateTimeStr);
      if (!isNaN(d.getTime())) {
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        raw.updatedAt = `${hh}:${mm} 实况`;
      }
    }
  } else if (provider === "amap") {
    // 高德地图天气 API payload
    const live = Array.isArray(payload.lives) && payload.lives[0] && typeof payload.lives[0] === "object"
      ? payload.lives[0]
      : null;
    if (!live) return null;
    const weatherText = readText(live.weather);
    const temp = readTemperature(live.temperature);
    if (temp === null || !weatherText) return null;
    const windPowerMatched = String(live.windpower === undefined ? "" : live.windpower).match(/\d+/);
    const parsedWindPower = windPowerMatched ? Number(windPowerMatched[0]) : null;

    raw.locationName = readText(live.city || live.province, 64) || "当前位置";
    raw.temperature = temp;
    raw.conditionText = weatherText;
    raw.conditionCode = weatherText;
    if (Number.isFinite(parsedWindPower)) raw.windLevel = Math.max(0, Math.min(6, parsedWindPower));
    const humidity = readFiniteNumber(live.humidity);
    if (humidity !== null) raw.humidity = humidity;
  } else if (provider === "caiyun") {
    // 彩云天气 API payload
    const realtime = payload.result && payload.result.realtime && typeof payload.result.realtime === "object"
      ? payload.result.realtime
      : null;
    if (!realtime) return null;
    const temperature = readTemperature(realtime.temperature);
    const skycon = readText(realtime.skycon, 40).toUpperCase();
    const matched = CAIYUN_SKYCON_MAP[skycon];
    if (temperature === null || !matched) return null;

    raw.temperature = Math.round(temperature);
    raw.conditionCode = skycon;
    raw.conditionText = skycon.replace(/_/g, " ");
    raw.mainCondition = matched.condition;
    raw.intensity = matched.intensity;
    if (matched.timePhase) raw.timePhase = matched.timePhase;
    const humidity = readFiniteNumber(realtime.humidity);
    const visibility = readFiniteNumber(realtime.visibility);
    if (humidity !== null && humidity >= 0 && humidity <= 1) raw.humidity = Math.round(humidity * 100);
    if (visibility !== null) raw.visibility = visibility;
    if (realtime.air_quality && realtime.air_quality.aqi) {
      const aqiVal = readFiniteNumber(realtime.air_quality.aqi.chn);
      if (aqiVal !== null) {
        raw.aqi = {
          text: `AQI ${aqiVal} ${aqiVal <= 50 ? "优" : aqiVal <= 100 ? "良" : "轻度污染"}`,
          class: aqiVal <= 50 ? "excellent" : aqiVal <= 100 ? "good" : "poor",
        };
      }
    }
  } else if (provider === "openweathermap") {
    // OpenWeatherMap API payload
    const wObj = Array.isArray(payload.weather) && payload.weather[0] && typeof payload.weather[0] === "object"
      ? payload.weather[0]
      : null;
    const main = payload.main && typeof payload.main === "object" ? payload.main : null;
    const wind = payload.wind || {};
    if (!wObj || !main) return null;
    const temperature = readTemperature(main.temp);
    const conditionText = readText(wObj.description || wObj.main);
    const conditionCode = readText(wObj.id, 16);
    if (temperature === null || (!conditionText && !conditionCode)) return null;

    raw.locationName = readText(payload.name, 64) || "当前位置";
    raw.temperature = Math.round(temperature);
    const temperatureMin = readTemperature(main.temp_min);
    const temperatureMax = readTemperature(main.temp_max);
    if (temperatureMin !== null && temperatureMax !== null && temperatureMin <= temperatureMax) {
      raw.temperatureMin = Math.round(temperatureMin);
      raw.temperatureMax = Math.round(temperatureMax);
    } else {
      if (temperatureMin !== null && temperatureMax === null) raw.temperatureMin = Math.round(temperatureMin);
      if (temperatureMax !== null && temperatureMin === null) raw.temperatureMax = Math.round(temperatureMax);
    }
    raw.conditionText = conditionText || conditionCode;
    raw.conditionCode = conditionCode || conditionText;
    const humidity = readFiniteNumber(main.humidity);
    const windSpeed = readFiniteNumber(wind.speed);
    if (humidity !== null) raw.humidity = humidity;
    if (windSpeed !== null) raw.windLevel = Math.max(0, Math.min(6, Math.floor(windSpeed / 3)));
  } else {
    // Standard Object schema
    const temperature = readTemperature(payload.temperature);
    const conditionEvidence = readText(
      payload.mainCondition || payload.conditionText || payload.conditionCode || payload.condition
    );
    if (temperature === null || !conditionEvidence) return null;
    Object.assign(raw, payload);
    raw.temperature = temperature;
  }

  // Generate complete V2 Scene
  const v2Scene = weatherEngine.generateWeatherScene(raw);
  return {
    provider,
    raw,
    v2Scene,
    temperature: raw.temperature,
    temperatureText: `${raw.temperature}°`,
    temperatureMin: raw.temperatureMin,
    temperatureMax: raw.temperatureMax,
    condition: v2Scene.semantic.displayTitle,
    summary: v2Scene.semantic.displaySubtitle,
    tips: v2Scene.semantic.chips,
    mainCondition: v2Scene.normalized.mainCondition,
    intensity: v2Scene.normalized.intensity,
    timePhase: v2Scene.normalized.timePhase,
  };
}

module.exports = {
  detectApiProvider,
  matchQWeatherCode,
  parseWeatherApiResponse,
  QWEATHER_CODE_MAP,
  CAIYUN_SKYCON_MAP,
};
