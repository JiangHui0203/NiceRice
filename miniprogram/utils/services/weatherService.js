const mock = require("../mock.js");
const privacyService = require("../privacyService.js");
const weatherEngine = require("./weatherEngine.js");
const weatherApiAdapter = require("./weatherApiAdapter.js");
const routeService = require("./routeService.js");
const weatherApiSettingsStore = require("./weatherApiSettingsStore.js");
const { hasCoordinates } = require("../locationUtils.js");
const { buildCoordinateCacheKey, createWeatherRemoteService } = require("./weatherRemoteService.js");
const config = require("../../config.js");

const WEATHER_KEY = "life_helper_weather_override";
const LIVE_WEATHER_CACHE_KEY = "life_helper_live_weather_cache";
const WEEKLY_WEATHER_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const CUSTOM_CONDITIONS = ["clear", "sunny", "cloudy", "overcast", "rain", "snow", "fog", "haze", "smog", "thunder", "thunderstorm", "wind", "windy"];
const CUSTOM_TIME_PHASES = ["dawn", "morning", "noon", "afternoon", "evening", "night", "lateNight"];
const CUSTOM_MODIFIERS = ["rainDrop", "snowFlake", "thunder", "windLine", "fogLayer", "starry", "moonGlow", "sunGlow", "iceEdge", "heatGlow", "cloud_light", "cloud_heavy", "rain_mix", "snow_mix", "fog", "wind", "ice", "sun_haze"];

function boundedText(value, maxLength) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength);
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizeCustomWeather(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const mainCondition = CUSTOM_CONDITIONS.includes(value.mainCondition) ? value.mainCondition : "clear";
  const timePhase = CUSTOM_TIME_PHASES.includes(value.timePhase) ? value.timePhase : "afternoon";
  const seenModifiers = new Set();
  const modifiers = (Array.isArray(value.modifiers) ? value.modifiers : []).reduce((result, item) => {
    const modifier = boundedText(item, 32);
    if (!CUSTOM_MODIFIERS.includes(modifier) || seenModifiers.has(modifier) || result.length >= 12) return result;
    seenModifiers.add(modifier);
    result.push(modifier);
    return result;
  }, []);
  return {
    isCustomV2: true,
    temperature: boundedNumber(value.temperature, 22, -100, 100),
    mainCondition,
    intensity: boundedNumber(value.intensity, 1, 0, 4),
    windLevel: boundedNumber(value.windLevel, 2, 0, 8),
    visibility: boundedNumber(value.visibility, 10, 0, 100),
    modifiers,
    timePhase,
    customTheme: boundedText(value.customTheme, 32),
    timeOfDay: ["night", "lateNight"].includes(timePhase) ? "night" : "day",
    title: boundedText(value.title, 64) || "自定义天气",
    condition: boundedText(value.condition, 64) || "自定义天气",
    desc: boundedText(value.desc, 200) || "手动组合的视觉天气",
    tips: (Array.isArray(value.tips) ? value.tips : [])
      .map((item) => boundedText(item, 32)).filter(Boolean).slice(0, 8),
    updatedAt: boundedText(value.updatedAt, 40),
  };
}

function isUsableLiveWeather(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const temperature = Number(value.temperature);
  return Number.isFinite(temperature) && temperature >= -100 && temperature <= 100
    && Boolean(boundedText(value.condition || value.title, 64))
    && Boolean(boundedText(value.mainCondition, 32));
}

const CATEGORIES = [
  { id: "sunny", name: "☀️ 晴朗" },
  { id: "cloudy", name: "☁️ 云层" },
  { id: "rainy", name: "🌧️ 降雨" },
  { id: "snowy", name: "❄️ 冰雪" },
  { id: "special", name: "🌫️ 特殊" }
];

const WEATHER_OPTIONS = [
  // 晴朗类 (sunny)
  { value: "sunny", label: "☀ 晴天", category: "sunny", title: "晴朗", descKicker: "阳光明媚", desc: "阳光温暖明媚，适合去户外公园野餐或轻户外散步。", temperature: "24-30°", tips: ["防晒", "适合户外", "多补水"], rain: 0, snow: 0, cloud: 10, wind: 5, brightness: 100, effect: "sun-glow", mainCondition: "sunny", intensity: 1, modifiers: [], thermalMood: "comfortable" },
  { value: "partly_cloudy_day", label: "⛅ 晴间多云", category: "sunny", title: "晴间多云", descKicker: "光照充足", desc: "云朵间洒下碎阳，空气流动舒适，适合大部分户外用券项目。", temperature: "22-28°", tips: ["防晒", "适合出行", "顺路优先"], rain: 0, snow: 0, cloud: 30, wind: 10, brightness: 85, effect: "sun-glow", mainCondition: "sunny", intensity: 1, modifiers: ["cloud_light"], thermalMood: "comfortable" },
  { value: "sunny_night", label: "🌙 晴夜", category: "sunny", title: "晴夜", descKicker: "晚风微凉", desc: "夜空明澈，晚风徐徐，最适合来一场惬意的饭后散步。", temperature: "16-22°", tips: ["繁星点点", "适合散步", "温度宜人"], rain: 0, snow: 0, cloud: 5, wind: 5, brightness: 20, effect: "star", mainCondition: "sunny", intensity: 1, modifiers: [], thermalMood: "comfortable" },
  { value: "hot", label: "🔥 炎热", category: "sunny", title: "炎热", descKicker: "暑气逼人", desc: "中午户外暴晒感强，适合寻找有强冷气的室内商超进行用券安排。", temperature: "30-35°", tips: ["避开正午", "冷饮解暑", "室内避暑"], rain: 0, snow: 0, cloud: 0, wind: 3, brightness: 100, effect: "heat-glow", mainCondition: "sunny", intensity: 2, modifiers: ["sun_haze"], thermalMood: "hot" },
  { value: "extreme_heat", label: "🥵 酷暑", category: "sunny", title: "酷暑", descKicker: "橙色高温", desc: "酷热难耐，建议留在室内，来杯冰凉爽口的茶饮是极好的降温选择。", temperature: "36-40°", tips: ["防暑防晒", "补盐补水", "减少外出"], rain: 0, snow: 0, cloud: 0, wind: 2, brightness: 100, effect: "heat-glow", mainCondition: "sunny", intensity: 4, modifiers: ["sun_haze"], thermalMood: "extreme_heat" },

  // 云层类 (cloudy)
  { value: "cloudy", label: "☁ 多云", category: "cloudy", title: "多云", descKicker: "体感舒适", desc: "云层较厚但无雨，气温合适，轻便出行体感稳定。", temperature: "20-26°", tips: ["宜通勤", "适合散步", "去户外走走"], rain: 0, snow: 0, cloud: 60, wind: 12, brightness: 75, effect: "none", mainCondition: "cloudy", intensity: 2, modifiers: ["cloud_light"], thermalMood: "comfortable" },
  { value: "overcast", label: "☁ 阴天", category: "cloudy", title: "阴天", descKicker: "阴云密布", desc: "天色阴沉，光线柔和，室内用餐或顺路出行更为稳妥。", temperature: "17-23°", tips: ["顺路优先", "室内优先", "防寒保暖"], rain: 0, snow: 0, cloud: 85, wind: 15, brightness: 50, effect: "none", mainCondition: "cloudy", intensity: 3, modifiers: ["cloud_heavy"], thermalMood: "cool" },
  { value: "dark_cloud", label: "⛈ 乌云", category: "cloudy", title: "乌云密布", descKicker: "山雨欲来", desc: "大片厚重黑云翻滚，请备齐雨具，并在室内安全区域活动。", temperature: "16-21°", tips: ["带齐雨具", "室内避风", "减少远行"], rain: 0, snow: 0, cloud: 100, wind: 20, brightness: 35, effect: "none", mainCondition: "cloudy", intensity: 4, modifiers: ["cloud_heavy"], thermalMood: "cool" },
  { value: "cold", label: "🥶 偏冷", category: "cloudy", title: "偏冷", descKicker: "体感清寒", desc: "气温骤降，体感较为寒冷，强烈推荐吃一顿热气腾腾的火锅。", temperature: "6-12°", tips: ["注意保暖", "适合火锅", "室内用餐"], rain: 0, snow: 0, cloud: 40, wind: 18, brightness: 60, effect: "cold-mist", mainCondition: "cloudy", intensity: 2, modifiers: [], thermalMood: "cold" },

  // 降雨类 (rainy)
  { value: "rain", label: "🌧 小雨", category: "rainy", title: "小雨", descKicker: "细雨斜斜", desc: "小雨斜飘，地面轻微湿滑，请带好雨伞，行程建议优先地铁沿线。", temperature: "18-24°", tips: ["带伞", "优先近地铁", "鞋袜防湿"], rain: 20, snow: 0, cloud: 75, wind: 10, brightness: 55, effect: "none", mainCondition: "rain", intensity: 1, modifiers: [], thermalMood: "cool" },
  { value: "moderate_rain", label: "🌧 中雨", category: "rainy", title: "中雨", descKicker: "细雨连绵", desc: "降雨连绵不断，出行建议打车或选择室内大楼，注意道路积水。", temperature: "17-22°", tips: ["中雨带伞", "注意路滑", "建议打车"], rain: 50, snow: 0, cloud: 85, wind: 15, brightness: 45, effect: "none", mainCondition: "rain", intensity: 2, modifiers: [], thermalMood: "cool" },
  { value: "heavy_rain", label: "🌧 大雨", category: "rainy", title: "大雨", descKicker: "雨势较急", desc: "大雨如注，路面积水较深，建议尽量待在室内，避免在低洼路段行走。", temperature: "16-22°", tips: ["大雨带伞", "减少出行", "防滑防水"], rain: 80, snow: 0, cloud: 95, wind: 22, brightness: 35, effect: "heavy-mist", mainCondition: "rain", intensity: 3, modifiers: ["cloud_heavy"], thermalMood: "cool" },
  { value: "storm_rain", label: "⛈ 暴雨", category: "rainy", title: "暴雨", descKicker: "红色预警", desc: "特大暴雨倾盆，路面可能严重积水，请勿外出并注意人身安全。", temperature: "14-18°", tips: ["红色暴雨", "切勿出门", "安全防范"], rain: 100, snow: 0, cloud: 100, brightness: 25, wind: 30, effect: "heavy-mist", mainCondition: "rain", intensity: 4, modifiers: ["cloud_heavy"], thermalMood: "cold" },
  { value: "shower_rain", label: "🌦 阵雨", category: "rainy", title: "阵雨", descKicker: "时雨时晴", desc: "雨来得急也去得快，可携带折叠伞，随时随地享受晴雨交织的用券空档。", temperature: "19-25°", tips: ["带折叠伞", "留意云层", "随用随买"], rain: 45, snow: 0, cloud: 70, brightness: 65, wind: 15, effect: "none", mainCondition: "rain", intensity: 2, modifiers: ["cloud_light"], thermalMood: "comfortable" },
  { value: "thunder_rain", label: "⛈ 雷阵雨", category: "rainy", title: "雷阵雨", descKicker: "雷电交加", desc: "暴风雨伴随阵阵雷鸣，户外雷击风险高，请务必在室内躲避。", temperature: "22-26°", tips: ["防雷防风", "避开低洼", "室内优先"], rain: 65, snow: 0, cloud: 98, brightness: 25, wind: 25, effect: "lightning", mainCondition: "thunder", intensity: 3, modifiers: ["cloud_heavy", "thunder"], thermalMood: "cool" },

  // 冰雪类 (snowy)
  { value: "snow", label: "❄ 小雪", category: "snowy", title: "小雪", descKicker: "雪花飘舞", desc: "轻柔的雪花缓缓飘落，空气清冷干净，最适合来一杯暖手咖啡。", temperature: "-2-3°", tips: ["防滑防摔", "注意保暖", "适合热饮"], rain: 0, snow: 25, cloud: 80, wind: 8, brightness: 70, effect: "cold-mist", mainCondition: "snow", intensity: 1, modifiers: [], thermalMood: "cold" },
  { value: "moderate_snow", label: "❄ 中雪", category: "snowy", title: "中雪", descKicker: "漫天飞雪", desc: "漫天大雪飘飘，道路有轻微积雪，保暖至上，出行请备好防滑鞋。", temperature: "-4-1°", tips: ["雪天防滑", "注意保暖", "室内赏雪"], rain: 0, snow: 60, cloud: 90, brightness: 60, wind: 12, effect: "cold-mist", mainCondition: "snow", intensity: 2, modifiers: [], thermalMood: "cold" },
  { value: "heavy_snow", label: "❄ 大雪", category: "snowy", title: "大雪", descKicker: "千山暮雪", desc: "鹅毛大雪狂飞，气温低路面冰冻，请尽量留在室内，喝汤暖胃。", temperature: "-7- -3°", tips: ["防冻防寒", "防滑出行", "喝汤暖胃"], rain: 0, snow: 95, cloud: 100, brightness: 50, wind: 20, effect: "cold-mist", mainCondition: "snow", intensity: 3, modifiers: ["cloud_heavy"], thermalMood: "freeze" },
  { value: "rain_snow", label: "🌨 雨夹雪", category: "snowy", title: "雨夹雪", descKicker: "道路结冰", desc: "雨水混杂着湿雪飘落，地面极易结冰结霜，行车或步行请务必注意安全。", temperature: "0-4°", tips: ["防潮防冻", "注意防滑", "出行安全"], rain: 25, snow: 35, cloud: 90, brightness: 45, wind: 15, effect: "cold-mist", mainCondition: "snow", intensity: 2, modifiers: ["rain_mix"], thermalMood: "freeze" },
  { value: "freeze", label: "🥶 冰冻", category: "snowy", title: "冰冻", descKicker: "凝霜结冰", desc: "寒潮来袭，道路及管网结冰结霜，体感极冷，穿上羽绒服吃火锅吧！", temperature: "-5-0°", tips: ["防滑结冰", "水管防冻", "厚保暖衣"], rain: 0, snow: 0, cloud: 50, brightness: 65, wind: 12, effect: "cold-mist", mainCondition: "snow", intensity: 3, modifiers: ["ice"], thermalMood: "freeze" },
  { value: "extreme_cold", label: "🥶 极冷", category: "snowy", title: "极冷", descKicker: "寒风刺骨", desc: "极端低温寒流侵袭，非必要不出门，室内开启暖气防寒取暖。", temperature: "-12- -6°", tips: ["超厚防寒", "减少外出", "热饮防冻"], rain: 0, snow: 0, cloud: 30, wind: 18, brightness: 65, effect: "cold-mist", mainCondition: "snow", intensity: 4, modifiers: ["ice"], thermalMood: "extreme_cold" },

  // 特殊类 (special)
  { value: "fog", label: "🌫 雾天", category: "special", title: "雾天", descKicker: "大雾弥漫", desc: "浓雾弥漫导致能见度极低，交通大受影响，行车或散步请放慢脚步。", temperature: "12-18°", tips: ["能见度低", "慢速出行", "注意车距"], rain: 0, snow: 0, cloud: 90, brightness: 55, wind: 3, effect: "fog-mist", mainCondition: "fog", intensity: 2, modifiers: ["fog"], thermalMood: "cool" },
  { value: "smog", label: "🌫 霾天", category: "special", title: "霾天", descKicker: "空气偏脏", desc: "空气质量较差，PM2.5指数高，非必要减少出门，出门请戴好防护口罩。", temperature: "13-19°", tips: ["佩戴口罩", "减少户外", "空气净化"], rain: 0, snow: 0, cloud: 90, brightness: 50, wind: 2, effect: "fog-mist", mainCondition: "smog", intensity: 2, modifiers: ["fog"], thermalMood: "cool" },
  { value: "windy", label: "🍃 大风", category: "special", title: "大风", descKicker: "狂风大作", desc: "强风呼啸，气温虽可，但请小心高空坠物和广告牌下行走。", temperature: "14-20°", tips: ["防风防坠", "收回阳台衣", "安全出行"], rain: 0, snow: 0, cloud: 45, brightness: 80, wind: 35, windLevel: 5, effect: "wind-line", mainCondition: "wind", intensity: 3, modifiers: ["wind"], thermalMood: "cool" }
];

const ICON_MAP = {
  sunny: "☀️",
  clear: "☀️",
  cloudy: "⛅",
  overcast: "☁️",
  rain: "🌧️",
  thunderstorm: "⛈️",
  snow: "❄️",
  fog: "🌫️",
  haze: "😷",
  smog: "😷",
  wind: "🍃",
  windy: "🍃",
};

function getWeatherIcon(mainCondition, timePhase = "day") {
  if ((mainCondition === "clear" || mainCondition === "sunny") && (timePhase === "night" || timePhase === "lateNight")) {
    return "🌙";
  }
  return ICON_MAP[mainCondition] || "🌤️";
}

function resolveTimePhase(hour) {
  if (hour >= 5 && hour < 8) return { defaultTime: "dawn", isNight: false };
  if (hour >= 8 && hour < 16) return { defaultTime: "day", isNight: false };
  if (hour >= 16 && hour < 19) return { defaultTime: "sunset", isNight: false };
  return { defaultTime: "night", isNight: true };
}

function valueOr(value, fallback) {
  return value === undefined || value === null || value === "" ? fallback : value;
}

function parseTemperatureCenter(value, fallback = 22) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "").trim();
  const range = text.match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
  if (range) return Math.round((Number(range[1]) + Number(range[2])) / 2);
  const single = text.match(/-?\d+(?:\.\d+)?/);
  return single ? Number(single[0]) : fallback;
}

function withMeta(weather, source) {
  const hour = new Date().getHours();
  const { defaultTime, isNight } = resolveTimePhase(hour);

  // Force night for sunny_night option
  const isSunnyNight = weather.value === "sunny_night" || weather.key === "sunny_night";
  const timeOfDay = isSunnyNight ? "night" : (weather.timeOfDay || defaultTime);
  const isNightFinal = isSunnyNight ? true : (timeOfDay === "night");

  // Construct rawWeather to process via WeatherEngine V2
  const temperatureValue = valueOr(weather.temperature, valueOr(weather.temperatureRange, "18-24°"));
  const tempVal = parseTemperatureCenter(temperatureValue, 22);
  const rawWeather = {
    locationName: weather.locationName || "当前位置",
    conditionCode: weather.key || weather.value || "cloudy",
    conditionText: weather.title || weather.condition || "晴天",
    temperature: tempVal,
    thermalMood: weather.thermalMood,
    windLevel: typeof weather.windLevel === "number" ? weather.windLevel : (typeof weather.wind === "number" ? (weather.wind >= 30 ? 5 : (weather.wind >= 20 ? 4 : (weather.wind >= 10 ? 3 : 2))) : 2),
    precipitation: valueOr(weather.rain, 0),
    visibility: valueOr(weather.visibility, 10),
    timestamp: Date.now(),
    mainCondition: weather.mainCondition,
    intensity: weather.intensity,
    modifiers: weather.modifiers,
    customTheme: weather.customTheme,
    timePhase: weather.timePhase || (timeOfDay === "day" ? "afternoon" : (timeOfDay === "sunset" ? "evening" : timeOfDay)),
  };
  const v2Scene = weatherEngine.generateWeatherScene(rawWeather);

  return Object.assign({}, weather, {
    key: weather.key || weather.value || "cloudy",
    condition: weather.title || weather.condition || "晴天",
    summary: weather.desc || weather.summary || "天气晴朗",
    temperatureRange: temperatureValue,
    mainCondition: weather.mainCondition || (v2Scene && v2Scene.semantic && rawWeather.mainCondition) || weatherEngine.getMainCondition(rawWeather.conditionCode, rawWeather.conditionText) || "cloudy",
    intensity: typeof weather.intensity === 'number' ? weather.intensity : 0,
    modifiers: weather.modifiers || [],
    thermalMood: weather.thermalMood || "comfortable",
    timePhase: weather.timePhase || (timeOfDay === "day" ? "afternoon" : (timeOfDay === "sunset" ? "evening" : timeOfDay)),
    timeOfDay,
    isNight: isNightFinal,
    source,
    updatedAt: source === "manual"
      ? weather.updatedAt || "手动设置"
      : (source === "api" ? weather.updatedAt || "" : weather.updatedAt || "本地样例"),
    icon: weather.icon || getWeatherIcon(weather.mainCondition || (v2Scene && v2Scene.semantic && rawWeather.mainCondition) || "cloudy", timeOfDay),
    v2Scene,
  });
}

function getWeatherOptions() {
  return WEATHER_OPTIONS.map((item) => Object.assign({ key: item.value }, item));
}

const WEEKLY_WEATHER_CACHE_KEY = "life_helper_weekly_weather_cache";

const remoteWeather = createWeatherRemoteService({
  config,
  liveWeatherCacheKey: LIVE_WEATHER_CACHE_KEY,
  privacyService,
  weatherApiSettingsStore,
  weatherApiAdapter,
  weatherEngine,
  weeklyWeatherCacheKey: WEEKLY_WEATHER_CACHE_KEY,
  withMeta,
});

function findWeatherOption(value) {
  return WEATHER_OPTIONS.find((item) => item.value === value);
}

function getActiveWeatherLocationKey() {
  try {
    const origin = routeService.getActiveRouteOrigin();
    if (!hasCoordinates(origin)) return "";
    return buildCoordinateCacheKey(origin);
  } catch (error) {
    return "";
  }
}

function isCacheForActiveOrigin(cache) {
  const activeLocationKey = getActiveWeatherLocationKey();
  return Boolean(activeLocationKey && cache && cache.locationKey === activeLocationKey);
}

function isWeeklyCacheFresh(cache, now = Date.now()) {
  const timestamp = Number(cache && cache.timestamp);
  return Number.isFinite(timestamp)
    && now >= timestamp
    && now - timestamp < WEEKLY_WEATHER_CACHE_TTL_MS;
}

function getWeather() {
  if (isWeatherOverrideActive()) {
    const stored = privacyService.readLocalData(WEATHER_KEY, null);
    if (stored) {
      if (stored.isCustomV2) {
        const normalizedCustom = normalizeCustomWeather(stored);
        if (normalizedCustom) return withMeta(normalizedCustom, "manual");
      }
      if (stored.value) {
        const option = findWeatherOption(stored.value);
        if (option) {
          return withMeta(Object.assign({ key: option.value }, option, stored, {
            tips: stored.tips || option.tips,
          }), "manual");
        }
      }
    }
  }

  // Check live API weather cache
  const key = remoteWeather.getEffectiveApiKey();
  if (key) {
    const liveCache = privacyService.readLocalData(LIVE_WEATHER_CACHE_KEY, null);
    const ttl = (config && config.WEATHER_CACHE_TTL_MS) || (30 * 60 * 1000);
    if (isCacheForActiveOrigin(liveCache)
      && liveCache.timestamp
      && Date.now() >= liveCache.timestamp
      && (Date.now() - liveCache.timestamp < ttl)
      && isUsableLiveWeather(liveCache.data)) {
      return withMeta(liveCache.data, "api");
    }
  }

  return withMeta(mock.weather, "local");
}

function saveCustomWeatherV2(customObj) {
  const normalized = normalizeCustomWeather(customObj);
  if (!normalized) return false;
  normalized.updatedAt = new Date().toISOString();
  return privacyService.writeLocalData(WEATHER_KEY, normalized);
}

function getWeeklyWeather(baseDate = new Date()) {
  const isMock = isWeatherOverrideActive();
  const pad = (n) => String(n).padStart(2, "0");

  // 1. 若非手动模拟且有和风预报缓存，优先使用真实的 7 天天气预报
  if (!isMock) {
    const cachedWeekly = privacyService.readLocalData(WEEKLY_WEATHER_CACHE_KEY, null);
    if (isCacheForActiveOrigin(cachedWeekly)
      && isWeeklyCacheFresh(cachedWeekly)
      && Array.isArray(cachedWeekly.data)
      && cachedWeekly.data.length > 0) {
      const liveList = cachedWeekly.data;
      const weekly = [];
      for (let i = 0; i < 7; i++) {
        const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + i);
        const dateStr = `${targetDate.getFullYear()}-${pad(targetDate.getMonth() + 1)}-${pad(targetDate.getDate())}`;
        const matched = liveList.find((item) => item.date === dateStr);
        if (matched) {
          weekly.push(matched);
        }
      }
      if (weekly.length === 7) {
        return weekly;
      }
    }
  }

  // 2. 模拟或本地拟真降级序列
  const today = getWeather();
  const weekly = [];
  const weatherPool = [
    { value: "partly_cloudy_day", tempOffset: 1, rain: 0 },
    { value: "sunny", tempOffset: 2, rain: 0 },
    { value: "rain", tempOffset: -2, rain: 70 },
    { value: "moderate_rain", tempOffset: -3, rain: 85 },
    { value: "cloudy", tempOffset: 0, rain: 10 },
    { value: "overcast", tempOffset: -1, rain: 20 },
    { value: "sunny", tempOffset: 3, rain: 0 },
  ];

  for (let i = 0; i < 7; i++) {
    const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + i);
    const dateStr = `${targetDate.getFullYear()}-${pad(targetDate.getMonth() + 1)}-${pad(targetDate.getDate())}`;
    
    if (i === 0) {
      weekly.push(Object.assign({}, today, {
        dayOffset: 0,
        date: dateStr,
        tempSimple: `${parseTemperatureCenter(today.temperature || today.temperatureRange, 22)}°`,
        icon: today.icon || (today.mainCondition === "rain" ? "🌧️" : today.mainCondition === "sunny" ? "☀️" : "⛅"),
      }));
    } else {
      const forecastConfig = weatherPool[(i + (today.mainCondition === "rain" ? 2 : 0)) % weatherPool.length];
      const option = findWeatherOption(forecastConfig.value) || findWeatherOption("cloudy");
      const baseTemp = parseTemperatureCenter(today.temperature || today.temperatureRange, 22);
      const forecastTemp = baseTemp + forecastConfig.tempOffset;
      const tempRange = `${forecastTemp - 3}-${forecastTemp + 3}°`;

      const dayWeather = withMeta(Object.assign({ key: option.value }, option, {
        dayOffset: i,
        date: dateStr,
        temperature: tempRange,
        temperatureRange: tempRange,
        tempSimple: `${forecastTemp}°`,
        rain: forecastConfig.rain,
      }), "forecast");

      weekly.push(dayWeather);
    }
  }
  return weekly;
}

function getWeatherForDate(dateStr) {
  if (!dateStr) return getWeather();
  const weekly = getWeeklyWeather();
  const matched = weekly.find((w) => w.date === dateStr);
  if (matched) return matched;
  
  // Calculate day offset
  const matchedDate = String(dateStr).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!matchedDate) return getWeather();
  const year = Number(matchedDate[1]);
  const month = Number(matchedDate[2]);
  const day = Number(matchedDate[3]);
  const targetDate = new Date(year, month - 1, day);
  if (targetDate.getFullYear() !== year || targetDate.getMonth() !== month - 1 || targetDate.getDate() !== day) {
    return getWeather();
  }
  const today = new Date();
  const todayZero = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const targetTime = targetDate.getTime();
  if (!Number.isNaN(targetTime)) {
    const diffDays = Math.round((targetTime - todayZero) / (24 * 60 * 60 * 1000));
    if (diffDays >= 0 && diffDays < weekly.length) {
      return weekly[diffDays];
    }
  }
  return getWeather();
}

function saveWeatherOverride(value) {
  const option = findWeatherOption(value);
  if (!option) return false;
  return privacyService.writeLocalData(WEATHER_KEY, Object.assign({}, option, {
    updatedAt: new Date().toISOString(),
  }));
}

function clearWeatherOverride() {
  return privacyService.writeLocalData(WEATHER_KEY, null);
}

function getWeatherCategories() {
  return CATEGORIES;
}

function isWeatherOverrideActive() {
  const stored = privacyService.readLocalData(WEATHER_KEY, null);
  if (!stored) return false;
  const updatedAt = stored.updatedAt ? new Date(stored.updatedAt) : null;
  const now = new Date();
  if (updatedAt && !isNaN(updatedAt.getTime()) && (now - updatedAt) > 24 * 60 * 60 * 1000) {
    clearWeatherOverride();
    return false;
  }
  return true;
}

function clearLiveWeatherCache() {
  const liveCleared = privacyService.writeLocalData(LIVE_WEATHER_CACHE_KEY, null);
  const weeklyCleared = privacyService.writeLocalData(WEEKLY_WEATHER_CACHE_KEY, null);
  return Boolean(liveCleared && weeklyCleared);
}

function getLiveWeatherCache() {
  return privacyService.readLocalData(LIVE_WEATHER_CACHE_KEY, null);
}

function parseLiveApiResponse(payload, provider) {
  return weatherApiAdapter.parseWeatherApiResponse(payload, provider);
}

function detectApiProvider(payload) {
  return weatherApiAdapter.detectApiProvider(payload);
}

module.exports = {
  clearWeatherOverride,
  isWeatherOverrideActive,
  clearLiveWeatherCache,
  getLiveWeatherCache,
  testQWeatherApiConnection: remoteWeather.testQWeatherApiConnection,
  fetchLiveWeather: remoteWeather.fetchLiveWeather,
  fetchWeeklyForecast: remoteWeather.fetchWeeklyForecast,
  getWeather,
  getWeatherOptions,
  saveWeatherOverride,
  saveCustomWeatherV2,
  getWeeklyWeather,
  getWeatherForDate,
  getWeatherCategories,
  getWeatherIcon,
  parseLiveApiResponse,
  detectApiProvider,
  lookupCity: remoteWeather.lookupCity,
  __test__: {
    WEEKLY_WEATHER_CACHE_TTL_MS,
    getActiveWeatherLocationKey,
    isCacheForActiveOrigin,
    isWeeklyCacheFresh,
  },
};
