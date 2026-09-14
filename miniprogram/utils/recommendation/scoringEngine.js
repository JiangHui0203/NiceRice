/**
 * scoringEngine.js
 * 多维综合评分调度内核、方案产出与周排程组合
 */

const mock = require("../mock.js");
const preferenceStore = require("../preferenceStore.js");
const friendStore = require("../friendStore.js");
const scheduleStore = require("../scheduleStore.js");
const routeService = require("../services/routeService.js");
const weatherService = require("../services/weatherService.js");
const weeklyArrangement = require("./weeklyArrangement.js");

const {
  WEEKDAYS,
  pad,
  dateText,
  slotDateTime,
  expireEndTime,
  addDays,
  daysUntil,
  timeToMinutes,
  minutesToTime,
  isSlotAllowedByRules,
  getCouponType,
  generateCandidateSlots,
} = require("./slotGenerator.js");

const {
  getCategory,
  getSlotWeather,
  isFactualWeather,
  isHeavyMeal,
  scoreWeather,
} = require("./weatherScorer.js");

const {
  getDurationMinutes,
  isFoodOrDrinkCoupon,
  scoreUrgency,
  scoreDiscountValue,
  scoreSchedule,
  scoreDistance,
  scorePreference,
  scoreTimePreference,
  scoreTimeOfDayAffinity,
  scoreCleanup,
  scoreTasteFatigue,
  scoreReservation,
} = require("./preferenceScorer.js");

const STATUS_LABELS = {
  blocked: "暂不推荐",
  high: "很适合安排",
  medium: "可以安排",
  low: "谨慎安排",
};

function normalizeStatusLabel(level) {
  return STATUS_LABELS[level] || "谨慎安排";
}

function getLevel(score, blockers) {
  if (blockers.length) return "blocked";
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  return "low";
}

function buildRecommendationContext(overrides = {}) {
  const now = overrides.now || new Date();
  let baseWeather = overrides.weather || weatherService.getWeather();
  if (baseWeather && !baseWeather.v2Scene) {
    const weatherEngine = require("../services/weatherEngine.js");
    baseWeather = Object.assign({}, baseWeather, {
      v2Scene: weatherEngine.generateWeatherScene({
        conditionCode: baseWeather.key || baseWeather.value || "cloudy",
        conditionText: baseWeather.title || baseWeather.condition || "晴天",
        temperature: baseWeather.temperature,
        thermalMood: baseWeather.thermalMood,
        mainCondition: baseWeather.mainCondition,
        intensity: baseWeather.intensity,
        modifiers: baseWeather.modifiers,
        timePhase: baseWeather.timePhase || "afternoon",
      }),
    });
  }
  const weeklyWeather = overrides.weeklyWeather || (overrides.weather ? null : weatherService.getWeeklyWeather(now));
  const datedWeather = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() + i);
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const provided = (weeklyWeather && Array.isArray(weeklyWeather) && (weeklyWeather.find(w => w.date === dateStr) || weeklyWeather[i])) || baseWeather;
    datedWeather.push(Object.assign({}, provided, { date: dateStr }));
  }

  return Object.assign({
    now,
    weather: baseWeather,
    weeklyWeather: datedWeather,
    userPreference: preferenceStore.readPreferences(),
    userSchedule: scheduleStore.readSchedules(),
    friends: friendStore.readFriends(),
    routeOrigin: routeService.getActiveRouteOrigin(),
    routeInfo: {},
    existingPlans: [],
  }, overrides, { weather: baseWeather });
}

// 评分维度管道清单
const SCORING_DIMENSIONS = [
  { key: "urgency", run: (c, s, ctx, r, w, b) => scoreUrgency(c, ctx, r, w, b) },
  { key: "schedule", run: (c, s, ctx, r, w, b) => scoreSchedule(c, s, ctx, r, w, b) },
  { key: "timePreference", run: (c, s, ctx, r, w, b) => scoreTimePreference(c, s, ctx, r, w, b) },
  { key: "timeOfDayAffinity", run: (c, s, ctx, r, w, b) => scoreTimeOfDayAffinity(c, s, ctx, r, w) },
  { key: "weather", run: (c, s, ctx, r, w, b) => scoreWeather(c, s, ctx, r, w, b) },
  { key: "distance", run: (c, s, ctx, r, w, b) => scoreDistance(c, s, ctx, r, w, b) },
  { key: "preference", run: (c, s, ctx, r, w, b) => scorePreference(c, ctx, r, w, b) },
  { key: "cleanup", run: (c, s, ctx, r, w) => scoreCleanup(c, s, ctx, r, w) },
  { key: "reservation", run: (c, s, ctx, r, w, b) => scoreReservation(c, s, ctx, r, w, b) },
  { key: "tasteFatigue", run: (c, s, ctx, r, w) => scoreTasteFatigue(c, s, ctx, r, w) },
  { key: "discountValue", run: (c, s, ctx, r) => scoreDiscountValue(c, r, ctx) },
];

function scoreSlotWithContext(coupon, slot, context) {
  const reasons = [];
  const warnings = [];
  const blockers = [];
  const ruleResult = isSlotAllowedByRules(coupon, slot);
  if (ruleResult === false) {
    blockers.push("该时段不符合优惠券使用规则");
  } else if (Array.isArray(ruleResult)) {
    blockers.push(...ruleResult);
  }

  const nowTime = context.now instanceof Date ? context.now.getTime() : new Date(context.now).getTime();
  const startTime = slotDateTime(slot, slot.startTime);
  let endTime = slotDateTime(slot, slot.endTime || slot.startTime);
  if (startTime !== null && endTime !== null && endTime <= startTime && slot.endTime) {
    endTime += 24 * 60 * 60 * 1000;
  }
  const couponExpireTime = expireEndTime(coupon);

  if (endTime !== null && Number.isFinite(nowTime) && endTime <= nowTime) {
    blockers.push("该时间已经过去");
  }
  if (couponExpireTime !== null && startTime !== null && startTime > couponExpireTime) {
    blockers.push("该时间已超过券过期日");
  }

  const scoreBreakdown = {};
  for (const dim of SCORING_DIMENSIONS) {
    try {
      scoreBreakdown[dim.key] = dim.run(coupon, slot, context, reasons, warnings, blockers) || 0;
    } catch (e) {
      console.error(`Scorer [${dim.key}] failed:`, e);
      scoreBreakdown[dim.key] = 0;
    }
  }

  const rawScore = Object.values(scoreBreakdown).reduce((sum, val) => sum + val, 0);
  const score = blockers.length ? Math.min(40, Math.max(10, Math.round(rawScore * 0.4))) : Math.max(0, Math.min(100, rawScore));
  const level = getLevel(score, blockers);

  return {
    couponId: coupon.id,
    score,
    level,
    statusLabel: normalizeStatusLabel(level),
    recommendedTime: blockers.length ? null : slot,
    reasons: Array.from(new Set(reasons)).slice(0, 8),
    warnings: Array.from(new Set(warnings)).slice(0, 8),
    blockers: Array.from(new Set(blockers)),
    scoreBreakdown,
  };
}

function scoreSlot(coupon, slot, context = buildRecommendationContext()) {
  return scoreSlotWithContext(coupon, slot, context);
}

function buildHumanReadableRationale(coupon, slot, rec, context) {
  const title = coupon.venue || coupon.merchantName || coupon.title || "优惠券";
  const days = typeof coupon.days === "number" ? coupon.days : daysUntil(coupon.expireDate);
  const daysText = days === null
    ? "有效期待补充"
    : (days < 0 ? "已经过期" : (days === 0 ? "今天到期" : (days === 1 ? "明天到期" : `还有 ${days} 天到期`)));

  const orig = Number(coupon.originalPrice) || 0;
  const price = Number(coupon.price) || 0;
  const val = orig > 0 ? orig : price;
  const valueText = val > 0 ? `价值 ¥${val}` : (coupon.discountText || "价格待补充");

  const weekday = (slot && slot.weekday) || "近期";
  const timeDesc = (slot && (slot.scene || slot.startTime)) ? `${slot.scene || ""} ${slot.startTime || ""}`.trim() : "从容时段";

  const dynamicDist = routeService.getDynamicDistance(coupon, context ? context.routeOrigin : null);
  const rawTravel = dynamicDist.travelTimeText || coupon.travelTime || "";
  const travelNum = parseInt(String(rawTravel).replace(/\D/g, ""), 10) || 0;

  let distSegment = "";
  if (dynamicDist.isCrossRegion) {
    distSegment = "，异地商户，暂不建议从当前起点安排";
  } else if (travelNum > 0 && travelNum <= 120) {
    distSegment = `，距离约 ${travelNum} 分钟`;
  } else if (travelNum > 120) {
    distSegment = "，异地商户";
  }

  const slotWeather = slot ? getSlotWeather(slot, context) : null;
  const weatherWord = isFactualWeather(slotWeather) && slotWeather.v2Scene
    ? slotWeather.v2Scene.semantic.displayTitle
    : "天气数据待更新";

  const scheduleText = slot ? "本机日程中未发现冲突" : "时间尚未确定";
  return `${title}券${daysText}，${valueText}；${weekday} ${timeDesc}，${scheduleText}${distSegment}，${weatherWord}。`;
}

function generateTimeOptions(coupon, context = buildRecommendationContext()) {
  const scoredSlots = generateCandidateSlots(coupon, context)
    .map((slot) => scoreSlotWithContext(coupon, slot, context))
    .filter((item) => item.level !== "blocked");

  if (!scoredSlots.length) return [];

  // 1. 最推荐 (最高评分)
  const bestSlot = scoredSlots.slice().sort((a, b) => b.score - a.score)[0];

  // 2. 更近时间 (按日期由近及远)
  const earliestSlot = scoredSlots.slice().sort((a, b) => {
    const da = new Date(`${a.recommendedTime.date}T00:00:00`).getTime();
    const db = new Date(`${b.recommendedTime.date}T00:00:00`).getTime();
    return da - db;
  }).find((item) => !bestSlot || item.recommendedTime.date !== bestSlot.recommendedTime.date || item.recommendedTime.startTime !== bestSlot.recommendedTime.startTime);

  // 3. 备选时间 (周末或其他可用空档)
  const alternativeSlot = scoredSlots.find((item) => {
    const isDifferent = (!bestSlot || (item.recommendedTime.date !== bestSlot.recommendedTime.date || item.recommendedTime.startTime !== bestSlot.recommendedTime.startTime)) &&
                        (!earliestSlot || (item.recommendedTime.date !== earliestSlot.recommendedTime.date || item.recommendedTime.startTime !== earliestSlot.recommendedTime.startTime));
    return isDifferent;
  });

  const selectedItems = [bestSlot, earliestSlot, alternativeSlot].filter(Boolean).slice(0, 3);

  return selectedItems.map((item, index) => {
    const slot = item.recommendedTime || {};
    const slotWeather = getSlotWeather(slot, context);
    const hasFactualWeather = isFactualWeather(slotWeather);
    const icon = hasFactualWeather
      ? (slotWeather.icon || weatherService.getWeatherIcon(slotWeather.mainCondition, slotWeather.timePhase))
      : "▫️";
    const weatherText = hasFactualWeather
      ? (slotWeather.v2Scene ? slotWeather.v2Scene.semantic.displayTitle : (slotWeather.condition || slotWeather.summary || "天气待更新"))
      : "天气待更新";
    const label = index === 0 ? "最推荐时间" : index === 1 ? "更近的时间" : "其他可选时间";

    return Object.assign({}, slot, {
      optionId: `${item.couponId}_${index}`,
      score: item.score,
      level: item.level,
      reasons: item.reasons,
      warnings: item.warnings,
      weatherTag: `${icon} ${weatherText}`,
      weatherBadge: slot.weatherBadge || null,
      label,
      range: `${slot.startTime} - ${slot.endTime}`,
      desc: buildHumanReadableRationale(coupon, slot, item, context),
      recommendation: item,
    });
  });
}

function generateRecommendationWithContext(coupon, context) {
  const slots = generateCandidateSlots(coupon, context);
  const scored = slots.map((slot) => scoreSlotWithContext(coupon, slot, context));
  const usable = scored.filter((item) => item.level !== "blocked").sort((a, b) => b.score - a.score);
  if (usable.length) return usable[0];

  const fallbackSlot = scored[0] || scoreSlotWithContext(coupon, {
    date: dateText(context.now),
    weekday: WEEKDAYS[context.now.getDay()],
    weekdayIndex: context.now.getDay(),
    startTime: "18:30",
    endTime: "21:00",
    scene: "晚餐",
    label: "暂无可用时间",
  }, context);

  return Object.assign({}, fallbackSlot, {
    score: 0,
    level: "blocked",
    statusLabel: "暂不推荐",
    recommendedTime: null,
  });
}

function generateRecommendation(coupon, context = buildRecommendationContext()) {
  return generateRecommendationWithContext(coupon, context);
}

function generateRecommendations(coupons, context = buildRecommendationContext()) {
  // Keep the public batch API aligned with the long-standing one-result-per-input
  // contract. Page-level callers decide which coupons are eligible; silently
  // filtering here breaks index-based joins with the original coupon array.
  return (coupons || []).map((coupon) => generateRecommendationWithContext(coupon, context));
}

function getTopRecommendations(coupons, context = buildRecommendationContext()) {
  return generateRecommendations(coupons, context)
    .filter((item) => item.level !== "blocked")
    .sort((a, b) => b.score - a.score);
}

function getRecommendationByCouponId(couponId, coupons, context = buildRecommendationContext()) {
  const coupon = (coupons || []).find((item) => item.id === couponId);
  return coupon ? generateRecommendation(coupon, context) : null;
}

const REASON_TYPE_MATCHERS = [
  {
    test: (t) => /过期|临期|到期|截止/.test(t),
    label: "期限",
    type: (t) => (/优先|较高|建议优先/.test(t) ? (/3 天内|优先级较高/.test(t) ? "warning" : "urgent") : "default"),
  },
  { test: (t) => /空档|空闲|偏好|时段|日程|时间/.test(t), label: "时间", type: () => "time" },
  { test: (t) => /天气|天候|气温|雨|晴|天/.test(t), label: "天气", type: () => "weather" },
  { test: (t) => /朋友|小王|约|社交/.test(t), label: "社交", type: () => "social" },
  { test: (t) => /优惠|划算|折|省/.test(t), label: "优惠", type: () => "time" },
];

function buildReasonItems(recommendation) {
  return (recommendation.reasons || []).slice(0, 4).map((text) => {
    let label = "推荐";
    let type = "default";

    for (const matcher of REASON_TYPE_MATCHERS) {
      if (matcher.test(text)) {
        label = matcher.label;
        type = matcher.type(text);
        break;
      }
    }

    return {
      label,
      type,
      title: text.length > 14 ? text.slice(0, 14) : text,
      desc: text,
    };
  });
}

const HIGHLIGHT_TAG_RULES = [
  { test: (t) => /临期|过期|截止/.test(t), tag: { label: "⏳ 临期优先", type: "urgent" } },
  { test: (t) => /小王|空档|朋友|约/.test(t), tag: { label: "👥 社交闲余", type: "social" } },
  { test: (t) => /雨|晴|天气|天候|冷|热|气温/.test(t), tag: { label: "⛅ 天候合宜", type: "weather" } },
  { test: (t) => /时间偏好|时段|日程|偏好/.test(t), tag: { label: "🕒 时段完美", type: "time" } },
  { test: (t) => /饮食|喜好|口味|忌口/.test(t), tag: { label: "🍲 口味契合", type: "food" } },
];

function getHighlightTags(reasons) {
  const tags = [];
  (reasons || []).forEach((text) => {
    for (const rule of HIGHLIGHT_TAG_RULES) {
      if (rule.test(text)) {
        tags.push(rule.tag);
        break;
      }
    }
  });

  if (tags.length === 0 && reasons && reasons.length) {
    tags.push({ label: "✨ 综合推荐", type: "default" });
  }
  return tags.slice(0, 3);
}

function classifyWarnings(blockers, warnings) {
  if (blockers && blockers.length > 0) {
    return { severity: "critical", badge: "", list: blockers };
  }

  const moderateList = (warnings || []).filter((w) => /过期可能损失|明天过期|提前预约|体验可能受影响|体验可能较差/.test(w));

  if (moderateList.length > 0) {
    return { severity: "moderate", badge: "", list: moderateList };
  }

  return { severity: "info", badge: "", list: warnings || [] };
}

function getPostDiningSuggestion(coupon, context) {
  const category = coupon.category || "food";
  const isSingle = coupon.people === "1人" || coupon.people === "单人";

  if (category !== "food" && coupon.type !== "粉面" && coupon.type !== "火锅" && coupon.type !== "咖啡甜品") {
    return null;
  }

  if (isSingle) {
    return "餐后可按体感散步或休息，具体去处请结合实际位置决定。";
  }

  let allCoupons = Array.isArray(context && context.allCoupons) ? context.allCoupons : null;
  if (!allCoupons) {
    try {
      const couponStore = require("../couponStore.js");
      allCoupons = couponStore.getAllCoupons() || [];
    } catch (e) {
      allCoupons = [];
    }
  }

  const playCoupon = allCoupons.find((c) =>
    c.id !== coupon.id && c.statusCode !== "used" && c.statusCode !== "expired" &&
    (c.category === "play" || c.type === "展览" || c.type === "户外")
  );

  if (playCoupon) {
    return `餐后可考虑券包里的「${playCoupon.title || playCoupon.venue}」，是否顺路请以实际位置为准。`;
  }
  return "餐后可按体感安排散步或休息，具体去处请结合实际位置决定。";
}

const LEVEL_STATE_MAP = {
  high: { state: "首选", stateClass: "ready" },
  medium: { state: "合适", stateClass: "ready" },
  low: { state: "备选", stateClass: "watch" },
  blocked: { state: "暂缓", stateClass: "blocked" },
};

function computeFinalRecommendationState(coupon, recommendation) {
  // A hard recommendation blocker must win over urgency styling. Otherwise a
  // cross-region or unusable coupon can still look like an actionable "临期"
  // item in fallback lists.
  if (recommendation.level === "blocked") {
    return { finalState: "暂缓", finalStateClass: "blocked" };
  }
  if (coupon.stateClass === "urgent" || coupon.state === "临期") {
    return { finalState: "临期", finalStateClass: "urgent" };
  }
  if (coupon.stateClass === "priority" || coupon.state === "优先") {
    return { finalState: "优先", finalStateClass: "priority" };
  }
  const levelMeta = LEVEL_STATE_MAP[recommendation.level] || LEVEL_STATE_MAP.blocked;
  return { finalState: levelMeta.state, finalStateClass: levelMeta.stateClass };
}

function mergeCouponRecommendation(coupon, recommendation, context = buildRecommendationContext()) {
  const { finalState, finalStateClass } = computeFinalRecommendationState(coupon, recommendation);
  const time = recommendation.recommendedTime;
  const warningsClassified = classifyWarnings(recommendation.blockers, recommendation.warnings);

  const isSingle = coupon.people === "1人" || coupon.people === "单人";
  const isFoodOrDrink = isFoodOrDrinkCoupon(coupon);
  const diningPerspectiveIcon = isSingle ? "👤" : "👥";
  const primaryFriendName = (context.friends && context.friends.length > 0)
    ? context.friends[0].name
    : "";
  let diningPerspectiveText = "";
  if (isFoodOrDrink) {
    diningPerspectiveText = isSingle
      ? "单人就餐 · 一个人也要好好吃饭 🍜"
      : (primaryFriendName
        ? `多人就餐 · 可与 ${primaryFriendName} 确认时间 🤝`
        : "多人就餐 · 可邀请同行人确认时间 🤝");
  } else {
    diningPerspectiveText = isSingle
      ? "单人体验 · 给自己留一段专注时间"
      : (primaryFriendName
        ? `多人体验 · 可与 ${primaryFriendName} 确认时间`
        : "多人体验 · 可邀请同行人确认时间");
  }

  const postDiningSuggestion = getPostDiningSuggestion(coupon, context);
  const dynamicDistance = routeService.getDynamicDistance(coupon, context.routeOrigin);

  const humanRationale = buildHumanReadableRationale(coupon, time, recommendation, context);

  return Object.assign({}, coupon, {
    score: recommendation.score,
    recommendation,
    recommendationScore: recommendation.score,
    recommendationLevel: recommendation.level,
    recommendedAt: time ? `${time.weekday} ${time.startTime}` : "暂无合适时间",
    humanRationale,
    state: finalState,
    stateClass: finalStateClass,
    distanceKmText: dynamicDistance.distanceKmText,
    travelTime: dynamicDistance.travelTimeText || coupon.travelTime,
    shortReason: recommendation.blockers[0] || recommendation.reasons[0] || coupon.shortReason || "推荐依据待评估",
    reasons: recommendation.reasons,
    reasonItems: buildReasonItems(recommendation),
    highlightTags: getHighlightTags(recommendation.reasons),
    notices: (coupon.notices && coupon.notices.length) ? coupon.notices : [],
    warningSeverity: warningsClassified.severity,
    warningBadge: warningsClassified.badge,
    hasWarning: warningsClassified.severity === "critical" || warningsClassified.severity === "moderate",
    weatherBadge: (recommendation.recommendedTime && recommendation.recommendedTime.weatherBadge) || null,
    diningPerspectiveIcon,
    diningPerspectiveText,
    postDiningSuggestion,
  });
}

function generateWeeklyArrangement(coupons, context = buildRecommendationContext()) {
  return weeklyArrangement.generateWeeklyArrangement(coupons, context, {
    addDays,
    dateText,
    generateRecommendations,
    getCategory,
    getCouponType,
    isHeavyMeal,
    pad,
  });
}

function evaluateCustomSlot(coupon, dateStr, timeStr, context = buildRecommendationContext()) {
  const exactDateTimestamp = slotDateTime({ date: dateStr }, "00:00");
  const isDateInvalid = exactDateTimestamp === null;
  const d = isDateInvalid ? new Date(context.now) : new Date(exactDateTimestamp);
  const weekdayIndex = isDateInvalid ? 0 : d.getDay();
  const weekday = isDateInvalid ? "周一" : WEEKDAYS[weekdayIndex];

  const startMin = timeToMinutes(timeStr);
  const isTimeInvalid = startMin === null;
  const safeStartMin = isTimeInvalid ? 720 : startMin;
  const safeTimeStr = isTimeInvalid ? "12:00" : minutesToTime(startMin);

  const duration = getDurationMinutes(coupon) || 90;
  const endMin = safeStartMin + duration;
  const endTimeStr = minutesToTime(endMin);

  let scene = "晚上";
  if (safeStartMin >= 6 * 60 && safeStartMin < 11 * 60) scene = "上午";
  else if (safeStartMin >= 11 * 60 && safeStartMin < 14 * 60) scene = "午餐";
  else if (safeStartMin >= 14 * 60 && safeStartMin < 17 * 60) scene = "下午";
  else if (safeStartMin >= 17 * 60 && safeStartMin < 21 * 60) scene = "晚餐";

  const slot = {
    date: isDateInvalid ? dateText(d) : dateText(new Date(exactDateTimestamp)),
    weekday,
    weekdayIndex,
    startTime: safeTimeStr,
    endTime: endTimeStr,
    scene,
    label: `${weekday}${scene}`,
  };

  const errorDesc = isDateInvalid ? "选择的日期格式不正确" : isTimeInvalid ? "选择的时间格式不正确" : "";
  const scored = errorDesc
    ? {
      couponId: coupon && coupon.id,
      score: 0,
      level: "blocked",
      statusLabel: normalizeStatusLabel("blocked"),
      recommendedTime: null,
      reasons: [errorDesc],
      warnings: [],
      blockers: [errorDesc],
      scoreBreakdown: {},
    }
    : scoreSlotWithContext(coupon, slot, context);
  const slotWeather = getSlotWeather(slot, context);
  const hasFactualWeather = isFactualWeather(slotWeather);
  const icon = hasFactualWeather
    ? (slotWeather.icon || weatherService.getWeatherIcon(slotWeather.mainCondition, slotWeather.timePhase))
    : "▫️";
  const weatherText = hasFactualWeather
    ? (slotWeather.v2Scene ? slotWeather.v2Scene.semantic.displayTitle : (slotWeather.condition || slotWeather.summary || "天气待更新"))
    : "天气待更新";

  return Object.assign({}, slot, {
    optionId: `custom_${Date.now()}`,
    score: scored.score,
    level: scored.level,
    reasons: scored.reasons,
    warnings: scored.warnings,
    blockers: scored.blockers,
    weatherTag: `${icon} ${weatherText}`,
    weatherBadge: slot.weatherBadge || null,
    label: "自定义",
    range: `${safeTimeStr} - ${endTimeStr}`,
    desc: errorDesc || (scored.blockers.length ? scored.blockers[0] : (scored.reasons[0] || "手动选择的时间")),
    recommendation: scored,
  });
}

module.exports = {
  buildRecommendationContext,
  buildHumanReadableRationale,
  scoreSlot,
  generateTimeOptions,
  generateRecommendation,
  generateRecommendations,
  getTopRecommendations,
  getRecommendationByCouponId,
  buildReasonItems,
  getHighlightTags,
  classifyWarnings,
  getPostDiningSuggestion,
  mergeCouponRecommendation,
  generateWeeklyArrangement,
  evaluateCustomSlot,
  getLevel,
  normalizeStatusLabel,
};
