/**
 * dashboardBuilder.js
 * 首页仪表盘与气象状态视图模型构建器（纯函数 & 查表扁平化）
 */

const recommendation = require("../../utils/recommendation.js");
const weatherService = require("../../utils/services/weatherService.js");
const weatherEngine = require("../../utils/services/weatherEngine.js");
const locationService = require("../../utils/services/locationService.js");
const { normalizeCoordinate } = require("../../utils/locationUtils.js");
const { isActivePlanStatus } = require("../../utils/plan/planStatus.js");
const { getExactDateTimestamp } = require("../../utils/coupon/couponNormalizer.js");

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const NIGHT_MAIN_MAP = {
  sunny: "晴夜",
  rain: "夜雨",
  thunder: "夜雨",
  cloudy: "多云夜间",
  snow: "雪夜",
};

const FEELING_SUFFIX_MAP = [
  { match: (m) => ["rain", "thunder"].includes(m), text: " · 记得带伞" },
  { match: (m) => m === "snow", text: " · 注意防滑" },
  { match: (m) => ["fog", "smog"].includes(m), text: " · 能见度低" },
  { match: (m) => m === "windy", text: " · 谨防坠物" },
  { match: (m, t) => ["hot", "extreme_heat"].includes(t), text: " · 防暑防晒" },
  { match: (m, t) => ["cold", "freeze", "extreme_cold"].includes(t), text: " · 注意保暖" },
];

const WEATHER_SUGGESTION_RULES = [
  { match: (m, t, w) => m === "rain" && w.intensity >= 3, text: "⚠️ 外面正下着暴雨，路面湿滑且积水严重。吃饭固然重要，但安全第一，建议减少出门，留在室内或选择外卖配送哦！" },
  { match: (m, t, w) => m === "snow" && w.intensity >= 3, text: "⚠️ 户外大雪纷飞，道路极易结冰滑倒。安全重于泰山，尽量减少出行，注意防寒防滑！" },
  { match: (m) => ["thunderstorm", "thunder"].includes(m), text: "⚠️ 天空雷暴轰鸣，电闪雷鸣。安全重于泰山，千万不要去户外逗留，尽量减少出行，待在安全的室内避雷！" },
  { match: (m, t, w) => t === "extreme_heat" || (typeof w.temperature === "number" && w.temperature >= 38), text: "⚠️ 户外处于极端酷暑高温状态。高温中暑风险极高，请避免在烈日下暴晒出行，注意补充水分，安全第一！" },
  { match: (m, t, w) => ["extreme_cold", "freeze"].includes(t) || (typeof w.temperature === "number" && w.temperature <= -10), text: "⚠️ 户外正值极寒冰冻天气。地面极易结冰打滑，请注意防寒防摔，尽量减少非必要出行，安全第一！" },
  { match: (m) => m === "rain", text: "今天外面下雨啦，正好适合窝在家里点外送，或者去温馨的室内咖啡厅静听雨声。" },
  { match: (m, t) => m === "sunny" && ["hot", "extreme_heat"].includes(t), text: "天气有些炎热，适合去喝杯冰饮，或者在空调充足的商超里避暑。" },
  { match: (m) => m === "sunny", text: "今天阳光明媚，适合去公园散步，或者约上好友去户外走走，享受好天气。" },
  { match: (m, t) => ["cold", "freeze", "extreme_cold"].includes(t), text: "气温有些低，最适合去吃一顿热气腾腾的火锅或者喝碗热汤。" },
];

const DAILY_QUOTES = [
  "生活不仅有忙碌，还有美食与远方。",
  "有时好饭，安排好每一餐，今天也要开心鸭！",
  "今天也是值得被美味治愈的一天。",
  "认真对待生活的人，生活也会温柔待你。",
];

function getTodayLabel() {
  const now = new Date();
  return `${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAYS[now.getDay()]}`;
}

function getExpireTime(coupon) {
  const dateStr = coupon.expireDate || coupon.expireAt || "";
  const time = getExactDateTimestamp(dateStr, true);
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function sortByUsefulPriority(a, b) {
  const scoreDiff = (b.recommendationScore || 0) - (a.recommendationScore || 0);
  if (scoreDiff) return scoreDiff;
  const urgentDiff = (a.stateClass === "urgent" ? -1 : 0) - (b.stateClass === "urgent" ? -1 : 0);
  if (urgentDiff) return urgentDiff;
  const priceDiff = Number(b.price || 0) - Number(a.price || 0);
  return (getExpireTime(a) - getExpireTime(b)) || priceDiff;
}

function compactPriorityCoupon(item = {}, hasWarning = false) {
  return {
    id: item.id,
    title: item.title,
    days: item.days,
    expiresIn: item.expiresIn,
    price: item.price,
    recommendedAt: item.recommendedAt,
    state: item.state,
    stateClass: item.stateClass,
    hasWarning,
  };
}

function compactPrimaryRecommendation(item = {}) {
  const reasons = item.recommendation && Array.isArray(item.recommendation.reasons)
    ? item.recommendation.reasons
    : [];
  return {
    id: item.id,
    title: item.title,
    platform: item.platform,
    people: item.people,
    price: item.price,
    originalPrice: item.originalPrice,
    discountText: item.discountText,
    expiresIn: item.expiresIn,
    travelTime: item.travelTime,
    score: item.score,
    recommendedAt: item.recommendedAt,
    primaryReason: item.shortReason || reasons[0] || "综合有效期、时间与距离给出的安排建议",
    highlightTags: (item.highlightTags || []).slice(0, 2),
    weatherBadge: item.weatherBadge || null,
    timeAffinityBadge: item.timeAffinityBadge || null,
    hasWarning: Boolean(item.hasWarning),
    recommendation: item.recommendation || null,
  };
}

function parseWeatherTemp(tempStr) {
  const match = String(tempStr).match(/(-?\d+)\s*-\s*(-?\d+)/);
  if (!match) return { main: tempStr, high: "", low: "", rangeText: "", current: parseInt(tempStr) };
  const [low, high] = [match[1], match[2]];
  const avg = Math.round((Number(low) + Number(high)) / 2);
  return { main: `${avg}°`, high: `${high}°`, low: `${low}°`, rangeText: `最高 ${high}°  最低 ${low}°`, current: avg };
}

function resolveTimePhase(hour, rawWeather) {
  if (["sunny_night"].includes(rawWeather.key || rawWeather.value) || rawWeather.timeOfDay === "night") {
    return { timeOfDay: "night", isNight: true };
  }
  if (hour >= 5 && hour < 8) return { timeOfDay: "dawn", isNight: false };
  if (hour >= 8 && hour < 16) return { timeOfDay: "day", isNight: false };
  if (hour >= 16 && hour < 19) return { timeOfDay: "sunset", isNight: false };
  return { timeOfDay: "night", isNight: true };
}

function resolveLocationLabels(activeRouteOrigin = {}, rawWeather = {}) {
  let title = "常用地点";
  let detail = "点击选择常用地点";
  const activeRole = activeRouteOrigin.role
    || (activeRouteOrigin.id === "loc_gps" || activeRouteOrigin.source === "wx.getLocation" ? "gps" : "");
  const weatherLoc = String(rawWeather.locationName || "").trim();

  const isCoordinateText = (text) => /^(经纬度|gps|lat\s*[:=]|lng\s*[:=])/i.test(text)
    || /^-?\d{1,3}\.\d+\s*[,，]\s*-?\d{1,3}\.\d+$/.test(text);
  const isPlaceholder = (text) => !text || [
    "实时定位", "当前位置", "当前定位", "当前定位地点", "附近位置未解析",
    "已获取手机GPS坐标", "已获取实时定位", "未解析位置", "请用微信地图选择位置", "当前起点",
    "广深附近", "北京周边", "江浙沪地区", "成渝地区", "定位中..."
  ].includes(text) || isCoordinateText(text);

  if (activeRole === "home") {
    title = "家";
    detail = activeRouteOrigin.address
      || (activeRouteOrigin.name && activeRouteOrigin.name !== "家" ? activeRouteOrigin.name : "")
      || "点击设置家位置";
  } else if (activeRole === "work") {
    title = "学校/公司";
    detail = activeRouteOrigin.address
      || (activeRouteOrigin.name && activeRouteOrigin.name !== "学校/公司" ? activeRouteOrigin.name : "")
      || "点击设置工作地";
  } else if (activeRole === "gps") {
    title = "当前位置";
    const rawName = String(activeRouteOrigin.name || "").trim();
    const rawAddr = String(activeRouteOrigin.address || "").trim();

    if (weatherLoc && !isPlaceholder(weatherLoc)) {
      detail = weatherLoc;
    } else if (rawName && !isPlaceholder(rawName)) {
      detail = rawName;
    } else if (rawAddr && !isPlaceholder(rawAddr)) {
      detail = rawAddr;
    } else {
      const lat = normalizeCoordinate(activeRouteOrigin.latitude !== undefined ? activeRouteOrigin.latitude : activeRouteOrigin.lat);
      const lng = normalizeCoordinate(activeRouteOrigin.longitude !== undefined ? activeRouteOrigin.longitude : activeRouteOrigin.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        detail = (locationService && typeof locationService.getOfflineEstimateAddress === "function")
          ? locationService.getOfflineEstimateAddress(lat, lng)
          : "点击刷新定位";
      } else {
        detail = "点击获取实时定位";
      }
    }
  } else {
    title = activeRouteOrigin.name || "常用地点";
    detail = activeRouteOrigin.address || activeRouteOrigin.name || "点击选择常用地点";
  }

  let cleanDetail = detail.replace(/^(广东省|北京市|上海市|浙江省|江苏省|四川省)/, "");
  cleanDetail = cleanDetail.replace(/^(北京市|上海市|广州市|深圳市|成都市|杭州市|武汉市)/, "");
  if (!cleanDetail || cleanDetail === "·" || cleanDetail.trim() === "" || cleanDetail === "当前位置") {
    cleanDetail = (weatherLoc && !isPlaceholder(weatherLoc)) ? weatherLoc : (detail === "当前位置" ? "点击获取实时定位" : detail);
  }

  const isResolvedGps = activeRole === "gps" && cleanDetail && cleanDetail !== "点击获取实时定位" && cleanDetail !== "当前位置" && cleanDetail !== "当前起点" && cleanDetail !== "点击刷新定位";
  const isEstimatedGps = isResolvedGps && activeRouteOrigin.estimated === true;
  const isUnresolvedGps = isResolvedGps && activeRouteOrigin.resolved === false;
  const currentOriginTitle = isResolvedGps ? cleanDetail : title;
  const currentOriginDetail = isResolvedGps
    ? (isEstimatedGps
      ? "GPS坐标 · 区域估算"
      : (isUnresolvedGps ? "GPS坐标 · 地名待解析" : "GPS定位 · 地名已解析"))
    : (cleanDetail.length > 12 ? `${cleanDetail.slice(0, 11)}...` : cleanDetail);
  const currentOriginLabel = currentOriginTitle;
  const currentLocationName = (rawWeather.locationName && !isPlaceholder(rawWeather.locationName))
    ? rawWeather.locationName
    : (isResolvedGps ? cleanDetail : (detail && !isPlaceholder(detail) ? detail : "待选择位置"));

  return {
    currentOriginTitle,
    currentOriginDetail,
    currentOriginLabel,
    currentLocationName,
  };
}

function getDynamicTips(weather, timeOfDay) {
  const isNight = timeOfDay === "night";
  const isMorning = timeOfDay === "dawn" || (new Date().getHours() < 12 && timeOfDay === "day");
  const main = weather.mainCondition || "cloudy";
  const thermal = weather.thermalMood || "comfortable";
  const modifiers = weather.modifiers || [];
  const chips = [];

  if (["rain", "thunder"].includes(main) || modifiers.includes("rain_mix")) {
    chips.push("记得带伞", weather.intensity >= 3 ? "减少户外" : "适合室内", isNight ? "路面湿滑" : (isMorning ? "注意车距" : "适合热食"));
  } else if (main === "snow" || modifiers.includes("snow_mix")) {
    chips.push("注意防滑", "防寒保暖", weather.intensity >= 3 ? "减少外出" : "适合热饮");
  } else if (["fog", "smog"].includes(main) || modifiers.includes("fog")) {
    chips.push(main === "smog" ? "佩戴口罩" : "能见度低", main === "smog" ? "减少户外" : "慢速出行", "注意安全");
  } else if (main === "windy" || modifiers.includes("wind")) {
    chips.push("谨防坠物", "注意防风", isNight ? "晚风偏冷" : "收好阳台");
  } else if (["hot", "extreme_heat"].includes(thermal)) {
    chips.push("防暑防晒", thermal === "extreme_heat" ? "避免暴晒" : "多补水", thermal === "extreme_heat" ? "多补充水分" : "适合冷饮");
  } else if (["cold", "freeze", "extreme_cold"].includes(thermal) || modifiers.includes("ice")) {
    chips.push("防寒保暖", thermal === "extreme_cold" ? "超厚防寒" : "添衣保暖", thermal === "extreme_cold" ? "室内取暖" : "适合热食");
  } else if (main === "sunny") {
    chips.push(isNight ? "适合散步" : "适合出游", isNight ? "晚风微凉" : (isMorning ? "适合散步" : "防晒多补水"), "体感舒适");
  } else {
    chips.push(isNight ? "夜空朦胧" : "宜通勤", isNight ? "宜早歇" : "适合散步", "适合出游");
  }

  return chips.slice(0, 3);
}

function resolveFeelingText(weather, weatherTitle, isNight) {
  const main = weather.mainCondition || "cloudy";
  const thermal = weather.thermalMood || "comfortable";
  const matchedSuffix = FEELING_SUFFIX_MAP.find((item) => item.match(main, thermal));
  const suffix = matchedSuffix ? matchedSuffix.text : (isNight ? " · 晚风微凉" : ` · ${weather.descKicker || "体感舒适"}`);
  return weatherTitle + suffix;
}

function buildTodaySuggestion(main, thermal, weather) {
  if (weather && weather.source === "local") {
    const quote = DAILY_QUOTES[new Date().getDate() % DAILY_QUOTES.length];
    return `实况天气待更新，暂不根据天气给出出行建议。${quote}`;
  }
  const matchedRule = WEATHER_SUGGESTION_RULES.find((r) => r.match(main, thermal, weather));
  const weatherText = matchedRule ? matchedRule.text : "天气信息已更新，请结合实际情况安排出行。";
  const quote = DAILY_QUOTES[new Date().getDate() % DAILY_QUOTES.length];
  return `${weather && weather.source === "manual" ? "模拟场景：" : ""}${weatherText} ${quote}`;
}

function buildDashboardState({ coupons = [], plans = [], rawWeather = {}, activeRouteOrigin = {} }) {
  const { currentOriginTitle, currentOriginDetail, currentOriginLabel, currentLocationName } = resolveLocationLabels(activeRouteOrigin, rawWeather);
  const couponById = new Map(coupons.map((coupon) => [coupon.id, coupon]));
  const activeCouponIds = new Set(
    plans
      .filter((plan) => isActivePlanStatus(plan.statusCode))
      .map((plan) => plan.couponId)
      .filter(Boolean),
  );
  const recommendableCoupons = coupons.filter((c) => {
    const status = c.statusCode || c.status;
    return !["draft", "planned", "used", "expired"].includes(status)
      && !activeCouponIds.has(c.id)
      && (c.days === undefined || c.days >= 0);
  });

  const hour = new Date().getHours();
  const { timeOfDay, isNight } = resolveTimePhase(hour, rawWeather);

  const isLocalWeatherSample = rawWeather.source === "local";
  const overriddenTips = isLocalWeatherSample
    ? ["本地样例", "仅供视觉预览", "实况待更新"]
    : getDynamicTips(rawWeather, timeOfDay);
  const v2Scene = weatherEngine.generateWeatherScene(rawWeather, rawWeather.customTheme || rawWeather.theme);
  const mods = rawWeather.modifiers || [];

  const weatherParsed = parseWeatherTemp(rawWeather.temperature);
  const rawTemperature = Number(rawWeather.temperature);
  const currentTemp = Number.isFinite(weatherParsed.current)
    ? weatherParsed.current
    : (Number.isFinite(rawTemperature) ? rawTemperature : null);
  const parsedHigh = Number(weatherParsed.high);
  const parsedLow = Number(weatherParsed.low);
  const rawMax = Number(rawWeather.temperatureMax);
  const rawMin = Number(rawWeather.temperatureMin);
  const tempMax = Number.isFinite(rawMax) ? rawMax : (Number.isFinite(parsedHigh) ? parsedHigh : null);
  const tempMin = Number.isFinite(rawMin) ? rawMin : (Number.isFinite(parsedLow) ? parsedLow : null);
  const hasTemperatureRange = Number.isFinite(tempMax) && Number.isFinite(tempMin);
  const sourceLabel = rawWeather.source === "api"
    ? "实时天气"
    : (rawWeather.source === "manual" ? "手动模拟" : "本地视觉样例");

  const weather = Object.assign({}, rawWeather, {
    v2Scene,
    tips: overriddenTips,
    temperature: currentTemp,
    temperatureText: Number.isFinite(currentTemp) ? `${currentTemp}°` : "温度待更新",
    temperatureMax: tempMax,
    temperatureMin: tempMin,
    temperatureRange: hasTemperatureRange ? `${tempMin}-${tempMax}°` : "",
    hasTemperatureRange,
    sourceLabel,
    hasAqi: Boolean(v2Scene && v2Scene.semantic && v2Scene.semantic.aqi && v2Scene.semantic.aqi.text),
    hasCloudLight: mods.includes("cloud_light"),
    hasCloudHeavy: mods.includes("cloud_heavy"),
    hasThunder: mods.includes("thunder"),
    hasWind: mods.includes("wind"),
    hasFog: mods.includes("fog"),
    hasIce: mods.includes("ice"),
    hasSunHaze: mods.includes("sun_haze"),
  });

  let weatherTitle = weather.title || "未知天气";
  if (isNight && NIGHT_MAIN_MAP[weather.mainCondition]) {
    weatherTitle = NIGHT_MAIN_MAP[weather.mainCondition];
  }

  const main = weather.mainCondition || "cloudy";
  const thermal = weather.thermalMood || "comfortable";
  const feelingText = resolveFeelingText(weather, weatherTitle, isNight);

  const context = recommendation.buildRecommendationContext({
    weather,
    existingPlans: plans,
    allCoupons: coupons,
    routeOrigin: activeRouteOrigin,
  });
  const precomputedRecommendations = recommendation.generateRecommendations(recommendableCoupons, context);
  // The weekly composer uses the same coupon set and context. Reuse this
  // score pass instead of evaluating every dimension a second time.
  context.precomputedRecommendations = precomputedRecommendations;
  context.precomputedRecommendationSource = {
    coupons: recommendableCoupons,
    existingPlans: context.existingPlans,
    friends: context.friends,
    now: context.now,
    routeOrigin: context.routeOrigin,
    userPreference: context.userPreference,
    userSchedule: context.userSchedule,
    weather: context.weather,
    weeklyWeather: context.weeklyWeather,
  };
  const enriched = recommendableCoupons.map((coupon, index) => (
    recommendation.mergeCouponRecommendation(coupon, precomputedRecommendations[index], context)
  ));
  const top = enriched.filter((item) => item.recommendationLevel !== "blocked").sort((a, b) => b.recommendationScore - a.recommendationScore);
  const todayStr = recommendation.dateText(context.now);
  const todayRecommendations = top.filter((item) => {
    const detail = item.recommendation || {};
    const recommendedTime = detail.recommendedTime || {};
    return (detail.date || recommendedTime.date) === todayStr;
  });

  let recommend = {};
  let recommendBlocked = false;
  let hasRecommendation = false;
  let todaySuggestion = "";

  if (todayRecommendations.length > 0) {
    recommend = Object.assign({}, todayRecommendations[0]);
    recommendBlocked = recommend.recommendationLevel === "blocked";
    recommend.hasWarning = recommendBlocked || Boolean(recommend.recommendation && recommend.recommendation.blockers && recommend.recommendation.blockers.length);
    if (!recommend.timeAffinityBadge && recommend.recommendation && recommend.recommendation.recommendedTime && recommend.recommendation.recommendedTime.timeAffinityBadge) {
      recommend.timeAffinityBadge = recommend.recommendation.recommendedTime.timeAffinityBadge;
    }
    hasRecommendation = true;
  } else {
    todaySuggestion = buildTodaySuggestion(main, thermal, weather);
  }

  const priorityList = top
    .filter((item) => item.id !== recommend.id)
    .slice(0, 4)
    .map((item) => {
      const hasWarning = item.recommendationLevel === "blocked" || Boolean(item.recommendation && item.recommendation.blockers && item.recommendation.blockers.length);
      return compactPriorityCoupon(item, hasWarning);
    });

  const weeklyArrangement = recommendation.generateWeeklyArrangement(recommendableCoupons, context);
  weeklyArrangement.items = weeklyArrangement.items.map((item) => {
    const coupon = couponById.get(item.couponId);
    const planTime = item.planTime || {};
    return {
      couponId: item.couponId,
      planId: item.planId,
      planTime: {
        date: planTime.date,
        weekday: planTime.weekday,
        scene: planTime.scene,
      },
      score: item.score,
      isPlanned: Boolean(item.isPlanned),
      title: coupon ? coupon.title : (item.title || "待安排"),
    };
  });
  // Conflict diagnostics may contain one entry per stored coupon and are not
  // rendered on the home page. Keep them out of setData so the logic bridge
  // only serializes the compact calendar view model.
  const weeklyArrangementView = {
    id: weeklyArrangement.id,
    range: weeklyArrangement.range,
    items: weeklyArrangement.items,
  };

  const weatherOptions = weatherService.getWeatherOptions() || [];
  const currentCategory = weather.category || "sunny";
  const drawerSubWeathers = weatherOptions.filter((opt) => opt.category === currentCategory);

  return {
    todayLabel: getTodayLabel(),
    currentOriginTitle,
    currentOriginDetail,
    currentOriginLabel,
    currentLocationName,
    weather,
    weatherParsed,
    timeOfDay,
    isNight,
    feelingText,
    recommend: hasRecommendation ? compactPrimaryRecommendation(recommend) : {},
    recommendBlocked,
    priorityList,
    todaySuggestion,
    weeklyArrangement: weeklyArrangementView,
    hasRecommendation,
    weatherCategories: weatherService.getWeatherCategories() || [],
    activeWeatherCategory: currentCategory,
    drawerSubWeathers,
  };
}

module.exports = {
  getTodayLabel,
  getExpireTime,
  sortByUsefulPriority,
  parseWeatherTemp,
  resolveTimePhase,
  resolveLocationLabels,
  getDynamicTips,
  buildDashboardState,
};
