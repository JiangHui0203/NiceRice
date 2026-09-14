/**
 * Weather Scorer & Category Affinity Engine
 * 气象亲和度算法与极端天气评估（展平多层分支）
 */

const { dateText, getCouponType } = require("./slotGenerator.js");
const weatherService = require("../services/weatherService.js");
const mock = require("../mock.js");

const INDOOR_TYPES = new Set([
  "火锅", "粉面", "展览", "咖啡甜品", "温泉", "洗浴", "足疗",
  "剧本杀", "密室", "轰趴", "室内乐园", "电影", "茶馆", "桌游",
]);

const OUTDOOR_TYPES = new Set([
  "公园", "游船", "露营", "骑行", "徒步", "户外烧烤", "水上乐园", "游乐园", "动物园",
]);

function getCategory(coupon) {
  return coupon.category || (mock.typeDefaults[getCouponType(coupon)] || mock.typeDefaults["其他"]).category;
}

function getSlotWeather(slot, context = {}) {
  let weather = null;
  if (slot && slot.date && Array.isArray(context.weeklyWeather)) {
    const todayStr = dateText(context.now || new Date());
    if (slot.date === todayStr && context.weather) {
      weather = context.weather;
    } else {
      weather = context.weeklyWeather.find((w) => w.date === slot.date);
    }
  }
  if (!weather) {
    weather = context.weather || weatherService.getWeather();
  }
  if (weather && !weather.v2Scene) {
    try {
      const weatherEngine = require("../services/weatherEngine.js");
      weather = Object.assign({}, weather, {
        v2Scene: weatherEngine.generateWeatherScene({
          conditionCode: weather.key || weather.value || "cloudy",
          conditionText: weather.title || weather.condition || "晴天",
          temperature: weather.temperature,
          thermalMood: weather.thermalMood,
          mainCondition: weather.mainCondition,
          intensity: weather.intensity,
          modifiers: weather.modifiers,
          timePhase: weather.timePhase || "afternoon",
        }),
      });
    } catch (e) {}
  }
  return weather;
}

function isFactualWeather(weather) {
  if (!weather || typeof weather !== "object") return false;
  if (["local", "forecast"].includes(weather.source)) return false;
  return Boolean(
    weather.v2Scene
    || weather.condition
    || weather.mainCondition
    || weather.temperature !== undefined
    || weather.temperatureRange !== undefined
  );
}

function isIndoorFriendly(coupon) {
  const type = getCouponType(coupon);
  const tags = coupon.tags || [];
  return INDOOR_TYPES.has(type) || tags.some((t) => ["室内", "雨天适合", "冬天适合"].includes(t));
}

function isOutdoor(coupon) {
  const category = getCategory(coupon);
  const type = getCouponType(coupon);
  const tags = coupon.tags || [];
  return category === "outdoor" || OUTDOOR_TYPES.has(type) || tags.some((t) => ["户外", "晴天适合"].includes(t));
}

function isHeavyMeal(coupon) {
  const tags = coupon.tags || [];
  return tags.includes("味道大") || tags.includes("需要洗澡洗头") || /火锅|烧烤|烤肉/.test(getCouponType(coupon));
}

function generateWeatherBadge(biz = {}, coupon, weather, cat, type) {
  if (biz.weatherRiskLevel >= 3) return { label: "⛈️ 恶劣气象", theme: "risk" };
  if (isOutdoor(coupon) && biz.outdoorScore >= 80) return { label: "☀️ 阳光出游", theme: "sun" };
  if (isIndoorFriendly(coupon) && (weather.mainCondition === "rain" || biz.indoorScore >= 75)) return { label: "🌧️ 雨天专选", theme: "rain" };
  if (["hotpot", "bbq"].includes(cat) || ["温泉", "洗浴"].includes(type)) {
    if (biz.hotFoodScore >= 75) return { label: "❄️ 暖汤热食", theme: "cold" };
  }
  if (["cafe", "drink", "icecream"].includes(cat) && biz.coldDrinkScore >= 75) return { label: "🧊 冰爽消暑", theme: "hot" };
  return null;
}

function scoreWeather(coupon, slot, context, reasons, warnings, blockers) {
  const weather = getSlotWeather(slot, context);

  if (!isFactualWeather(weather)) {
    reasons.push("天气数据待更新，本次未纳入天气加减分");
    return 8;
  }

  if (weather && weather.v2Scene && weather.v2Scene.business) {
    const biz = weather.v2Scene.business;
    let score = 8;

    // 1. Extreme weather risk level warning
    if (biz.weatherRiskLevel >= 3) {
      warnings.push("雷暴或极端天气警告，建议推迟所有出行安排，待在室内");
      score = Math.max(1, score - 8);
    }

    // 2. Outdoor vs Indoor friendly scoring
    if (isOutdoor(coupon)) {
      score = Math.round(biz.outdoorScore / 6.6);
      if (biz.outdoorScore < 30) {
        warnings.push(`当天天气对户外项目非常不友好 (${biz.outdoorScore}分)`);
        score = Math.max(1, score - 6);
      } else if (biz.outdoorScore >= 80) {
        reasons.push("阳光明媚/体感舒适，户外体验极佳");
      }
    } else if (isIndoorFriendly(coupon)) {
      score = Math.round(biz.indoorScore / 6.6);
      if (biz.indoorScore >= 75) {
        reasons.push("当天天气不佳或极端，推荐在舒适的室内娱乐用餐");
      }
    }

    // 3. Category based Food & Experience temperature boosts
    const cat = String(coupon.category || "").toLowerCase();
    const type = getCouponType(coupon);
    if (["hotpot", "bbq", "dinner"].includes(cat) || ["温泉", "洗浴", "火锅", "烤肉", "烧烤"].includes(type)) {
      if (biz.hotFoodScore >= 60 || weather.thermalMood === "cold" || weather.mainCondition === "snow") {
        score = Math.min(15, score + 4);
        reasons.push(["温泉", "洗浴"].includes(type) ? "天气寒冷偏凉/雨雪，最适合泡汤桑拿驱寒暖身！" : "天气寒冷偏凉/雨雪，最适合暖呼呼的火锅或大餐！");
      } else if (biz.hotFoodScore <= 20) {
        score = Math.max(1, score - 5);
        warnings.push("天气炎热，吃热腾腾的火锅或大餐体感较闷");
      }
    } else if (["cafe", "drink", "icecream"].includes(cat) || type === "水上乐园") {
      if (biz.coldDrinkScore >= 75) {
        score = Math.min(15, score + 4);
        reasons.push("酷暑炎热，来杯冰凉爽口的甜品冷饮防暑降温！");
      }
    } else if (["密室", "剧本杀", "轰趴", "展览"].includes(type) && biz.indoorScore >= 70) {
      score = Math.min(15, score + 3);
      reasons.push("室内空调与遮蔽环境良好，不受外界天气变化打扰");
    }

    // 4. Time-Scene & Weather Synergy
    const isHotCondition = ["hot", "extremeHot"].includes(weather.temperatureBand) || (typeof weather.temperature === "number" && weather.temperature >= 30);
    const isRainCondition = ["rain", "thunderstorm"].includes(weather.mainCondition)
      || Boolean(weather.v2Scene && weather.v2Scene.visual && weather.v2Scene.visual.particles && weather.v2Scene.visual.particles.rain && weather.v2Scene.visual.particles.rain.visible);

    if (isHotCondition) {
      if (slot.scene === "午餐" && isOutdoor(coupon)) {
        score = Math.max(1, score - 6);
        warnings.push("正午阳光强烈且气温偏高，不建议在此时段进行暴晒户外活动");
      } else if (["晚餐", "晚上"].includes(slot.scene) && (cat === "bbq" || isOutdoor(coupon))) {
        score = Math.min(15, score + 2);
        reasons.push("晚间日落后微风舒适，适合聚餐散步");
      }
    } else if (isRainCondition) {
      if (slot.scene === "午餐") {
        warnings.push("雨天午餐出行不便，建议选择就近或商场室内连廊门店");
      } else if (slot.scene === "下午" && isIndoorFriendly(coupon)) {
        reasons.push("雨天午后，在室内咖啡馆或休闲空间度过最惬意");
      } else if (["晚餐", "晚上"].includes(slot.scene) && (cat === "hotpot" || ["温泉", "洗浴"].includes(type))) {
        reasons.push("雨夜微凉，热气腾腾的晚餐与汤泉驱寒暖心");
      }
    }

    // 5. Dynamic warning propagation
    (biz.warnings || []).forEach((w) => {
      if (!warnings.includes(w)) warnings.push(w);
    });

    if (reasons.length === 0) {
      reasons.push("天气对该日程影响温和，适合前往");
    }

    slot.weatherBadge = generateWeatherBadge(biz, coupon, weather, cat, type);
    return score;
  }

  // Fallback
  const main = weather.mainCondition || "cloudy";
  const thermal = weather.thermalMood || "comfortable";
  const modifiers = weather.modifiers || [];
  const intensity = typeof weather.intensity === "number" ? weather.intensity : 0;

  const isRainy = ["rain", "thunder"].includes(main) || modifiers.includes("rain_mix");
  const isSnowy = main === "snow" || modifiers.includes("snow_mix");
  const isHeavyRain = isRainy && intensity >= 3;
  const isExtremeCold = ["extreme_cold", "freeze"].includes(thermal);
  const isHot = ["hot", "extreme_heat"].includes(thermal);

  if (isHeavyRain && isOutdoor(coupon)) warnings.push(`当天有${weather.title || "大雨"}，不建议安排户外项目`);
  if ((isExtremeCold || isSnowy) && isOutdoor(coupon)) warnings.push("天气寒冷雨雪，建议推迟户外安排");
  if (main === "smog" && isOutdoor(coupon)) warnings.push("空气中度污染，建议减少户外活动");

  if ((isRainy || isSnowy || ["cold", "freeze"].includes(thermal)) && isIndoorFriendly(coupon)) {
    reasons.push("天气寒冷雨雪，室内或热食安排更舒服");
    return 15;
  }
  if (!isRainy && !isSnowy && isOutdoor(coupon)) {
    reasons.push("天气适合户外项目，适合安排出行");
    return 15;
  }

  if (isHot && isOutdoor(coupon) && slot.scene === "午餐") {
    warnings.push("高温中午户外体感晒热，建议选择空调冷气项目");
    return 3;
  }
  if ((isRainy || isSnowy) && isOutdoor(coupon)) {
    warnings.push("当天有雨雪，户外体验可能受影响");
    return 5;
  }

  reasons.push("天气对这次安排没有明显负面影响");
  return 8;
}

module.exports = {
  getCategory,
  getSlotWeather,
  isFactualWeather,
  isIndoorFriendly,
  isOutdoor,
  isHeavyMeal,
  scoreWeather,
};
