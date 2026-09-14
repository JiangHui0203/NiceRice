/**
 * Preference & Auxiliary Scorer Engine
 * 紧急度、优惠价值、距离、偏好、清洁、口味疲劳、预约与日程评分（扁平化与卫语句）
 */

const routeService = require("../services/routeService.js");
const { getCouponType } = require("./slotGenerator.js");
const { 
  WEEKDAYS, 
  daysUntil, 
  parseNumber, 
  timeToMinutes, 
  minutesToTime, 
  rangesOverlap,
  weeklyRangesOverlap,
  getExistingPlanConflict, 
  dateTime,
} = require("./slotGenerator.js");
const { getCategory, getSlotWeather, isFactualWeather, isOutdoor, isHeavyMeal } = require("./weatherScorer.js");

const DURATION_DEFAULTS = {
  火锅: 90, 烧烤: 90, 粉面: 40, 咖啡甜品: 60,
  展览: 120, 公园: 120, 户外: 180, 温泉: 180, 洗浴: 120, 其他: 60,
};
const TRAVEL_MODE_LABELS = {
  transit: "公共交通",
  walking: "步行",
  driving: "驾车",
  cycling: "骑行",
};

function isFoodOrDrinkCoupon(coupon = {}) {
  return ["food", "drink", "美食", "餐饮", "饮品", "咖啡茶饮"].includes(getCategory(coupon));
}

function getNeedReservation(coupon = {}) {
  if (coupon.needReservation !== undefined) return Boolean(coupon.needReservation);
  if (coupon.usageRules && coupon.usageRules.needReservation !== undefined) return Boolean(coupon.usageRules.needReservation);
  return Boolean(coupon.reservationRequired);
}

function getReservationStatus(coupon = {}) {
  const status = String(coupon.reservationStatus || "").trim();
  if (["not_required", "required", "pending", "confirmed", "failed", "unknown"].includes(status)) return status;
  const hasReservationFlag = coupon.needReservation !== undefined
    || coupon.reservationRequired !== undefined
    || Boolean(coupon.usageRules && coupon.usageRules.needReservation !== undefined);
  if (!hasReservationFlag) return "unknown";
  return getNeedReservation(coupon) ? "required" : "not_required";
}

function getUsageRules(coupon = {}) {
  const text = coupon.usableTime || (coupon.availableTime && coupon.availableTime.text) || "";
  const matched = text.match(/(\d{1,2}:\d{2})\s*[-至到]\s*(\d{1,2}:\d{2})/);
  const fallbackRange = matched ? [{ start: matched[1], end: matched[2], label: "可用时段" }] : [];
  return Object.assign({
    availableDays: [],
    unavailableDays: [],
    availableTimeRanges: fallbackRange,
    holidayAvailable: true,
    needReservation: getNeedReservation(coupon),
    reservationLeadTimeHours: getNeedReservation(coupon) ? 12 : 0,
    refundType: (coupon.refundInfo && coupon.refundInfo.refundType) || "unknown",
    storeLimit: "",
    notes: coupon.note || coupon.notes || "",
  }, coupon.usageRules || {});
}

function getRefundInfo(coupon = {}) {
  const rules = getUsageRules(coupon);
  const refundInfo = coupon.refundInfo || {};
  let refundType = refundInfo.refundType || rules.refundType;
  if (!refundType) refundType = "unknown";
  const isLoss = refundType === "non_refundable" || refundType === "partial";
  const lossAmount = isLoss ? (parseNumber(refundInfo.lossAmount) || parseNumber(coupon.price) || 0) : 0;
  return Object.assign({
    refundable: refundType === "unknown" ? null : (refundType === "auto" || refundType === "manual"),
    refundType,
    lossAmount,
  }, refundInfo);
}

function getDurationMinutes(coupon = {}) {
  if (coupon.duration && typeof coupon.duration.estimatedMinutes === "number") return coupon.duration.estimatedMinutes;
  if (typeof coupon.durationMinutes === "number" && coupon.durationMinutes > 0) return coupon.durationMinutes;
  return DURATION_DEFAULTS[getCouponType(coupon)] || 60;
}

function scoreUrgency(coupon, context, reasons, warnings, blockers) {
  const days = daysUntil(coupon.expireDate, context.now);
  const refundInfo = getRefundInfo(coupon);
  const refundType = refundInfo.refundType || "unknown";
  const lossAmount = ["non_refundable", "partial"].includes(refundType)
    ? (parseNumber(refundInfo.lossAmount) || parseNumber(coupon.price) || 0)
    : 0;

  if (days !== null && days < 0) {
    blockers.push("这张券已经过期");
    return 0;
  }

  let score = 8;
  if (days === null) warnings.push("有效期待补充，本次未按临期程度加分");
  else if (days <= 1) score = 30;
  else if (days <= 3) score = 26;
  else if (days <= 7) score = 20;
  else if (days <= 14) score = 14;

  if (refundType === "non_refundable") {
    score += 5;
    warnings.push("⚠️ 不可退款，建议尽快使用");
  } else if (refundType === "partial") {
    warnings.push("⚠️ 部分退款");
  }

  if (lossAmount >= 100) score += 4;
  else if (lossAmount >= 50) score += 2;

  if (days !== null && days <= 1) reasons.push("明天前后过期，建议优先安排");
  else if (days !== null && days <= 3) reasons.push("3天内到期，优先级较高");

  return Math.min(36, score);
}

function scoreDiscountValue(coupon, reasons, context = {}) {
  const p = parseFloat(coupon.price);
  const op = parseFloat(coupon.originalPrice);
  if (!(p > 0 && op > p)) return 0;

  const savings = op - p;
  const discountRate = p / op;
  let score = savings >= 100 ? 6 : savings >= 50 ? 4 : savings >= 20 ? 2 : 0;

  if (discountRate <= 0.3) {
    score += 6;
    reasons.push(`优惠极大（${(discountRate * 10).toFixed(1)}折），使用超划算`);
  } else if (discountRate <= 0.5) {
    score += 4;
    reasons.push(`优惠力度大（${(discountRate * 10).toFixed(1)}折），建议优先享用`);
  } else if (discountRate <= 0.8) {
    score += 2;
  }
  const sensitivity = context.userPreference && context.userPreference.priceSensitivity;
  if (sensitivity === "high") return Math.min(16, Math.round(score * 1.25));
  if (sensitivity === "low") return Math.round(score * 0.6);
  return score;
}

function getCleanupMinutes(coupon) {
  const cleanup = String(coupon.cleanup || "");
  const tags = Array.isArray(coupon.tags) ? coupon.tags : [];
  const type = getCouponType(coupon);
  if (tags.includes("需要洗澡洗头") || tags.includes("火锅后洗澡洗头") || cleanup.includes("洗澡洗头") || /火锅|烧烤|烤肉/.test(type)) return 45;
  if (tags.includes("换衣服") || cleanup.includes("换衣服")) return 20;
  if (cleanup.includes("整理时间") || tags.includes("整理时间")) return 30;
  return 0;
}

function scoreSchedule(coupon, slot, context, reasons, warnings, blockers) {
  const existingPlan = getExistingPlanConflict(slot, context);
  if (existingPlan) {
    blockers.push(`该时间与已安排计划「${existingPlan.title || "未命名计划"}」冲突`);
    return 0;
  }
  const conflicts = (context.userSchedule || []).filter((item) => weeklyRangesOverlap(
    slot.weekday,
    slot.startTime,
    slot.endTime,
    item.weekday,
    item.startTime,
    item.endTime
  ));
  if (conflicts.length) {
    blockers.push(`该时间与${conflicts[0].title}冲突`);
    return 0;
  }

  const cleanupMins = getCleanupMinutes(coupon);
  if (cleanupMins > 0) {
    const endMin = timeToMinutes(slot.endTime) + cleanupMins;
    const extendedEndTime = minutesToTime(endMin);
    const extendedConflicts = (context.userSchedule || []).filter((item) =>
      weeklyRangesOverlap(slot.weekday, slot.startTime, extendedEndTime, item.weekday, item.startTime, item.endTime)
      && !weeklyRangesOverlap(slot.weekday, slot.startTime, slot.endTime, item.weekday, item.startTime, item.endTime)
    );
    if (extendedConflicts.length) {
      blockers.push(`虽有用餐时间，但餐后洗头整理(${cleanupMins}分钟)与「${extendedConflicts[0].title}」冲突`);
      return 0;
    }

    const extendedSlot = Object.assign({}, slot, { endTime: extendedEndTime });
    // The original slot was already checked at the top of this scorer. Reuse
    // the date-bucket conflict index for the cleanup-extended range instead of
    // scanning every plan again for every coupon/slot pair.
    const conflictPlan = getExistingPlanConflict(extendedSlot, context);
    if (conflictPlan) {
      blockers.push(`餐后洗头整理与计划「${conflictPlan.title}」冲突`);
      return 0;
    }
  }

  const people = coupon.people || "";
  if (people === "1人" || people === "单人") {
    reasons.push("这是单人安排，时间协调成本较低");
    return 18;
  }
  const peopleCount = Number.isFinite(Number(coupon.peopleCount)) && Number(coupon.peopleCount) > 0
    ? Number(coupon.peopleCount)
    : null;
  if (peopleCount === 1) {
    reasons.push("适用人数标记为单人，无需协调好友空档");
    return 20;
  }
  if (peopleCount === null) {
    warnings.push("适用人数待补充，暂未评估好友协调成本");
    return 10;
  }

  const friends = context.friends || [];
  if (!friends.length) {
    warnings.push("尚未添加好友信息，暂未评估多人协调成本");
    return 10;
  }

  const availableFriends = friends.filter((friend) => {
    const slots = Array.isArray(friend.slots) ? friend.slots.filter((item) => typeof item === "string") : [];
    if (!slots.length) return false;
    return slots.some((item) => {
      if (!item.includes(slot.weekday)) return false;
      const currentScene = slot.scene || slot.label;
      const STANDARD_SCENES = ["早餐", "午餐", "下午茶", "晚餐", "夜间聚会", "深夜桌游", "上午", "下午", "晚上", "周末半日"];
      const otherScenes = STANDARD_SCENES.filter((name) => name !== currentScene);
      if (currentScene && otherScenes.some((name) => item.includes(name)) && !item.includes(currentScene)) {
        return false;
      }
      const matched = item.match(/(\d{1,2}:\d{2})\s*[-至到]\s*(\d{1,2}:\d{2})/);
      return matched ? rangesOverlap(matched[1], matched[2], slot.startTime, slot.endTime) : true;
    });
  });

  const requiredFriendsCount = Math.max(1, peopleCount - 1);

  if (availableFriends.length >= requiredFriendsCount) {
    const friendNames = availableFriends.slice(0, requiredFriendsCount).map((f) => f.name).join("和");
    reasons.push(`你和${friendNames}在${slot.weekday}${slot.scene}有足够空档`);
    return 20;
  }

  if (availableFriends.length > 0) {
    const friendNames = availableFriends.map((f) => f.name).join("、");
    warnings.push(`仅${friendNames}在此时间有空档，建议与好友确认`);
    return 14;
  }

  warnings.push("好友在此时间段暂未标记空档，建议聚会前微信协调");
  return 8;
}

function scoreDistance(coupon, slot, context, reasons, warnings, blockers) {
  const userPreference = context.userPreference || {};
  const route = routeService.estimateRoute(coupon, 7, context.routeOrigin, userPreference.transportMode);
  if (route.isCrossRegion || routeService.isCrossRegionDistance(route.distanceMeters)) {
    blockers.push("商户与当前起点距离过远，疑似异地或跨城券");
    return 0;
  }
  const selfMinutes = route.self.durationMinutes || routeService.parseMinutes(coupon.travelTime);
  // 未保存好友起点时不能用“我的路程”替代好友路程，否则会产生虚假的阻断结论。
  const friendMinutes = route.friend && route.friend.durationMinutes || null;
  const durationPreference = Number(userPreference.maxTravelDuration);
  const explicitLimit = routeService.parseMinutes(userPreference.commuteLimit)
    || (Number.isFinite(durationPreference) && durationPreference > 0 ? durationPreference : null);
  const limit = explicitLimit || 45;
  const needsFriend = coupon.people !== "1人" && coupon.people !== "单人";
  const friend = (context.friends || [])[0];
  const friendLimit = needsFriend ? (routeService.parseMinutes(friend && friend.travel) || limit) : limit;
  const travelPreferences = userPreference.travel || [];
  const weather = getSlotWeather(slot, context);
  const main = weather.mainCondition || "cloudy";
  const modifiers = weather.modifiers || [];
  const hasFactualWeather = isFactualWeather(weather);
  const rainy = hasFactualWeather
    && (["rain", "thunder", "snow"].includes(main) || modifiers.includes("rain_mix") || modifiers.includes("snow_mix"));
  const distanceMeters = route.distanceMeters || (coupon.route && coupon.route.distanceMeters);

  if (!selfMinutes) {
    if (route.origin && route.origin.hasCoordinates && route.destination && route.destination.hasCoordinates) {
      warnings.push("已保存默认起点和券位置，接入路线 API 后可自动估算路程");
      return 6;
    }
    if (route.origin && route.origin.hasAddress) {
      warnings.push("常用起点已保存，补地图点后可用于路线估算");
      return 5;
    }
    warnings.push("路程还未填写，建议先补单程时间");
    return 4;
  }

  if (rainy && travelPreferences.includes("雨天不想走太远") && selfMinutes > 35) {
    warnings.push("你设置了雨天不想走太远，这个路程在雨天会更累");
  }
  if (rainy && distanceMeters && distanceMeters > 10000) {
    warnings.push("雨天长距离出行成本较高，建议优先选择近处或地铁直达");
  }
  if (rainy && isOutdoor(coupon) && selfMinutes > 35) {
    warnings.push("雨天户外项目路程偏长，执行风险较高");
  }
  if (needsFriend && friendMinutes && friendMinutes > friendLimit + 15) {
    blockers.push(`${(friend && friend.name) || "朋友"}的路程超过出行偏好`);
    return 0;
  }
  if (needsFriend && friendMinutes && friendMinutes > friendLimit) {
    warnings.push(`${(friend && friend.name) || "朋友"}的路程略超过偏好上限`);
  }
  if ((selfMinutes && selfMinutes > limit + 20) || (friendMinutes && friendMinutes > friendLimit + 20)) {
    warnings.push(selfMinutes > 120
      ? "跨城或长途出行，建议预留充裕行程安排"
      : (explicitLimit ? "路程略超当前出行偏好，建议安排在充裕时间" : "路程较长，建议安排在时间充裕的时段"));
    return 4;
  }
  if (explicitLimit && selfMinutes > limit) {
    warnings.push(`单程约 ${selfMinutes} 分钟，超过你设置的 ${limit} 分钟出行上限`);
  }

  if (route.distanceMeters) {
    const distText = route.distanceMeters < 1000 ? `${route.distanceMeters}米` : `${(route.distanceMeters / 1000).toFixed(1)}公里`;
    const travelModeLabel = TRAVEL_MODE_LABELS[route.transportType] || "出行";
    reasons.push(selfMinutes <= 15
      ? `距离起点仅 ${distText}，${travelModeLabel}约 ${selfMinutes} 分钟`
      : `距离起点约 ${distText}，${travelModeLabel}约 ${selfMinutes} 分钟`);
  } else {
    if (friendMinutes !== null && selfMinutes <= 30 && friendMinutes <= 30) reasons.push("双方路程都在 30 分钟内");
    else if (friendMinutes !== null && selfMinutes <= 45 && friendMinutes <= 45) reasons.push("双方路程都在 45 分钟内");
    else reasons.push(`已填写单程约 ${selfMinutes} 分钟，实际距离待估算`);
  }

  let distanceScore = selfMinutes <= 10 ? 15 : selfMinutes <= 20 ? 12 : selfMinutes <= 30 ? 10 : selfMinutes <= 45 ? 7 : 3;

  if (hasFactualWeather && weather && weather.v2Scene && weather.v2Scene.business) {
    const penalty = weather.v2Scene.business.travelPenalty || 0;
    if (penalty > 0) {
      distanceScore = Math.max(1, Math.round(distanceScore * (1 - penalty * (selfMinutes / 45))));
      if (penalty >= 0.4 && selfMinutes > 15) {
        warnings.push("雨雪或大风天气下路程耗时较长，出行建议优先选择公共交通或打车");
      }
    }
  } else if (rainy) {
    distanceScore = Math.round(distanceScore * 0.7);
  }

  return distanceScore;
}

function textContainsAny(text, list) {
  return (list || []).some((item) => item && text.includes(item));
}

const contextCouponLookupCache = new WeakMap();
const contextHistoryCountCache = new WeakMap();
const contextRecentPlanCache = new WeakMap();
const MAX_RECENT_PLAN_DATE_CACHE_ENTRIES = 16;

function clearContextCaches(context) {
  if (!context || typeof context !== "object") return;
  contextCouponLookupCache.delete(context);
  contextHistoryCountCache.delete(context);
  contextRecentPlanCache.delete(context);
}

function buildContextCouponLookup(context = {}) {
  const explicitCoupons = Array.isArray(context && context.allCoupons) ? context.allCoupons : null;
  const cacheRevision = context && (context.recommendationCacheRevision || context.cacheRevision);
  if (context && typeof context === "object" && contextCouponLookupCache.has(context)) {
    const cached = contextCouponLookupCache.get(context);
    if (cached.source === explicitCoupons
      && cached.length === (explicitCoupons ? explicitCoupons.length : -1)
      && cached.revision === cacheRevision) {
      return cached.lookup;
    }
  }
  let coupons = explicitCoupons;
  if (!coupons) {
    try {
      const couponStore = require("../couponStore.js");
      coupons = couponStore.getAllCoupons() || [];
    } catch (error) {
      coupons = [];
    }
  }
  const lookup = new Map();
  coupons.forEach((coupon) => {
    if (coupon && coupon.id) lookup.set(coupon.id, coupon);
  });
  if (context && typeof context === "object") {
    contextCouponLookupCache.set(context, {
      length: explicitCoupons ? explicitCoupons.length : -1,
      lookup,
      revision: cacheRevision,
      source: explicitCoupons,
    });
  }
  return lookup;
}

function findCouponType(couponId, context) {
  if (!couponId) return "";
  try {
    const found = buildContextCouponLookup(context).get(couponId);
    return found ? found.type : "";
  } catch (e) {
    return "";
  }
}

function getHistoricalPlanCounts(context = {}) {
  const plans = Array.isArray(context && context.existingPlans) ? context.existingPlans : [];
  const couponLookup = buildContextCouponLookup(context);
  const cacheRevision = context && (context.recommendationCacheRevision || context.cacheRevision);
  if (context && typeof context === "object" && contextHistoryCountCache.has(context)) {
    const cached = contextHistoryCountCache.get(context);
    if (cached.source === plans
      && cached.length === plans.length
      && cached.couponLookup === couponLookup
      && cached.revision === cacheRevision) {
      return cached.counts;
    }
  }
  const completedByType = Object.create(null);
  const cancelledByType = Object.create(null);
  plans.forEach((plan) => {
    if (!plan || !["completed", "cancelled"].includes(plan.statusCode)) return;
    const type = findCouponType(plan.couponId, context);
    if (!type) return;
    const target = plan.statusCode === "completed" ? completedByType : cancelledByType;
    target[type] = (target[type] || 0) + 1;
  });
  const counts = { completedByType, cancelledByType };
  if (context && typeof context === "object") {
    contextHistoryCountCache.set(context, {
      counts,
      couponLookup,
      length: plans.length,
      revision: cacheRevision,
      source: plans,
    });
  }
  return counts;
}

function getRecentPlansForSlotDate(context = {}, slotDateText = "") {
  const plans = Array.isArray(context && context.existingPlans) ? context.existingPlans : [];
  const revision = context && (context.recommendationCacheRevision || context.cacheRevision);
  let cacheEntry = null;
  if (context && typeof context === "object") {
    cacheEntry = contextRecentPlanCache.get(context);
    if (!cacheEntry || cacheEntry.source !== plans
      || cacheEntry.length !== plans.length || cacheEntry.revision !== revision) {
      cacheEntry = {
        byDate: new Map(),
        length: plans.length,
        revision,
        source: plans,
      };
      contextRecentPlanCache.set(context, cacheEntry);
    }
    if (cacheEntry.byDate.has(slotDateText)) return cacheEntry.byDate.get(slotDateText);
  }
  const slotDate = new Date(`${slotDateText}T12:00:00`);
  if (Number.isNaN(slotDate.getTime())) return [];
  const earliest = slotDate.getTime() - 3 * 24 * 60 * 60 * 1000;
  const latest = slotDate.getTime();
  const recentPlans = plans.filter((plan) => {
    if (!plan || !["completed", "used"].includes(plan.statusCode)) return false;
    const planTime = new Date(plan.date || plan.createdAt).getTime();
    return Number.isFinite(planTime) && planTime >= earliest && planTime <= latest;
  });
  if (cacheEntry) {
    if (!cacheEntry.byDate.has(slotDateText)
      && cacheEntry.byDate.size >= MAX_RECENT_PLAN_DATE_CACHE_ENTRIES) {
      const oldestKey = cacheEntry.byDate.keys().next().value;
      cacheEntry.byDate.delete(oldestKey);
    }
    cacheEntry.byDate.set(slotDateText, recentPlans);
  }
  return recentPlans;
}

function scorePreference(coupon, context, reasons, warnings, blockers) {
  const preference = context.userPreference || {};
  const isFoodOrDrink = isFoodOrDrinkCoupon(coupon);
  const dislikeText = (preference.dislikedFoods || []).join("|");
  const likeText = (preference.likedFoods || []).join("|");
  const couponText = `${coupon.title || ""}${coupon.venue || ""}${coupon.type || ""}${(coupon.tags || []).join("")}${coupon.note || ""}`;
  const friend = (context.friends || [])[0];

  if (isFoodOrDrink && textContainsAny(couponText, preference.dislikedFoods)) {
    blockers.push(`与你的不吃偏好冲突：${dislikeText}`);
    return 0;
  }
  if (isFoodOrDrink && friend && textContainsAny(couponText, friend.restrictions || [])) {
    warnings.push(`${friend.name || "朋友"}有饮食限制，需要点单时避开`);
    return 5;
  }

  let score = 8;
  const couponType = getCouponType(coupon);
  if (couponType) {
    const historyCounts = getHistoricalPlanCounts(context);
    const completedCount = historyCounts.completedByType[couponType] || 0;
    if (completedCount > 0) {
      const bonus = Math.min(2, completedCount * 0.5);
      reasons.push(`历史消费偏好：此品类已完成安排 ${completedCount} 次 (评分 +${bonus.toFixed(1)})`);
      score += bonus;
    }
    const cancelledCount = historyCounts.cancelledByType[couponType] || 0;
    if (cancelledCount > 0) {
      const penalty = Math.min(3, cancelledCount * 0.8);
      warnings.push(`历史消费反馈：此品类曾取消安排 ${cancelledCount} 次 (评分 -${penalty.toFixed(1)})`);
      score -= penalty;
    }
  }

  if (isFoodOrDrink && textContainsAny(couponText, preference.likedFoods)) {
    reasons.push(`符合你爱吃的偏好：${likeText}`);
    score += 2;
  } else if (isFoodOrDrink) {
    reasons.push("没有发现明显忌口冲突");
  }
  return Math.max(0, Math.min(10, score));
}

function isWorkdayEve(slot) {
  return ["周日", "周一", "周二", "周三", "周四"].includes(slot.weekday);
}

function hasNextMorningCommitment(slot, context) {
  if (!slot || !Number.isInteger(slot.weekdayIndex) || slot.weekdayIndex < 0 || slot.weekdayIndex > 6) return false;
  const nextWeekday = WEEKDAYS[(slot.weekdayIndex + 1) % 7];
  return (context.userSchedule || []).some((item) => {
    const startMinutes = timeToMinutes(item.startTime);
    return item.weekday === nextWeekday && startMinutes !== null && startMinutes <= timeToMinutes("10:30");
  });
}

function scoreTimePreference(coupon, slot, context, reasons, warnings, blockers) {
  const timePreferences = (context.userPreference && context.userPreference.time) || [];
  const durationMinutes = getDurationMinutes(coupon);
  const isFoodOrDrink = isFoodOrDrinkCoupon(coupon);
  if (timePreferences.includes("晚上 22:00 后不出门") && timeToMinutes(slot.endTime) > timeToMinutes("22:00")) {
    blockers.push("超过你设置的 22:00 后不出门");
    return 0;
  }
  if (timePreferences.includes("周末上午不安排") && ["周六", "周日"].includes(slot.weekday) && slot.scene === "上午") {
    blockers.push("你设置了周末上午不安排");
    return 0;
  }

  let score = 8;
  if (isFoodOrDrink && timePreferences.includes("午饭最多 1 小时") && slot.scene === "午餐" && durationMinutes > 60) {
    warnings.push("这次午餐预计超过 1 小时，可能压缩午休");
    score -= 5;
  }
  if (isFoodOrDrink && timePreferences.includes("晚饭最多 2.5 小时") && slot.scene === "晚餐" && durationMinutes > 150) {
    warnings.push("这次晚饭预计超过 2.5 小时，结束时间可能偏晚");
    score -= 4;
  }
  if (timePreferences.includes("工作日前夜不想太晚") && isWorkdayEve(slot) && timeToMinutes(slot.endTime) > timeToMinutes("21:30")) {
    warnings.push("这是工作日前夜，结束时间不宜太晚");
    score -= 4;
  }
  if (score >= 8) reasons.push("符合你的时间偏好");
  return Math.max(0, score);
}

function scoreCleanup(coupon, slot, context, reasons, warnings) {
  if (!isFoodOrDrinkCoupon(coupon)) return 8;
  const tags = coupon.tags || [];
  const heavy = tags.includes("味道大") || tags.includes("需要洗澡洗头") || /火锅|烧烤|烤肉/.test(getCouponType(coupon));
  if (!heavy) {
    reasons.push("未发现需要额外清洁恢复时间的标签");
    return 8;
  }
  const startMinutes = timeToMinutes(slot && slot.startTime);
  const endMinutes = timeToMinutes(slot && slot.endTime);
  const crossesMidnight = startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes;
  const endsLate = endMinutes !== null && (crossesMidnight || endMinutes > timeToMinutes("21:00"));
  if (hasNextMorningCommitment(slot, context) && endsLate) {
    warnings.push("第二天上午有固定安排，重口味晚餐不宜结束太晚");
    return 1;
  }
  if (endMinutes !== null && !crossesMidnight && endMinutes <= timeToMinutes("21:30")) {
    reasons.push("味道较大，但饭后仍有时间洗澡洗头");
    return 10;
  }
  warnings.push("结束时间偏晚，清洁和休息时间会被压缩");
  return 3;
}

function scoreTasteFatigue(coupon, slot, context, reasons, warnings) {
  if (!isFoodOrDrinkCoupon(coupon)) return 0;
  if (!slot || !slot.date || typeof slot.date !== "string" || !slot.date.includes("-")) return 0;
  const recentPlans = getRecentPlansForSlotDate(context, slot.date);
  if (!recentPlans.length) return 0;

  const type = getCouponType(coupon);
  const isHeavy = isHeavyMeal(coupon);
  let penalty = 0;
  let matchedReason = "";

  const couponLookup = buildContextCouponLookup(context);

  for (const prevPlan of recentPlans) {
    const prevCoupon = prevPlan.couponId === coupon.id
      ? coupon
      : (couponLookup.get(prevPlan.couponId) || null);
    const prevType = prevCoupon ? getCouponType(prevCoupon) : (prevPlan.category || "");
    const prevIsHeavy = prevCoupon ? isHeavyMeal(prevCoupon) : (/火锅|烧烤|烤肉/.test(prevPlan.title) || (prevPlan.tags && prevPlan.tags.includes("重口味")));

    if (type && prevType && type === prevType) {
      penalty = Math.max(penalty, 25);
      matchedReason = `最近刚安排吃过「${type}」，换换口味吧`;
    } else if (isHeavy && prevIsHeavy) {
      penalty = Math.max(penalty, 15);
      matchedReason = "最近连吃重口味，为了肠胃健康，今天建议吃清淡一些";
    }
  }

  if (penalty > 0) {
    warnings.push(matchedReason);
    return -penalty;
  }
  return 0;
}

function scoreReservation(coupon, slot, context, reasons, warnings, blockers) {
  const reservationStatus = getReservationStatus(coupon);
  if (reservationStatus === "unknown") {
    warnings.push("预约要求待补充，本次未按免预约加分");
    return 3;
  }
  if (reservationStatus === "not_required") {
    reasons.push("这张券不需要预约，执行成本较低");
    return 5;
  }
  const rules = getUsageRules(coupon);
  const start = dateTime(new Date(`${slot.date}T00:00:00`), slot.startTime);
  const hoursLeft = (start.getTime() - context.now.getTime()) / (60 * 60 * 1000);

  if (reservationStatus === "confirmed") {
    reasons.push("预约已确认，执行风险较低");
    return 8;
  }
  if (hoursLeft < (rules.reservationLeadTimeHours || 0)) {
    const message = "该券需提前预约，请留意商家接待安排";
    if (hoursLeft < 1) {
      warnings.push(`${message}（时间紧凑，建议先致电商家）`);
      return 2;
    }
    warnings.push(message);
    return 4;
  }
  warnings.push("该券需要提前预约，建议提前向商家确认");
  return 5;
}

function scoreTimeOfDayAffinity(coupon, slot, context, reasons = [], warnings = []) {
  const now = (context && context.now instanceof Date) ? context.now : new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const timeVal = currentHour + currentMinute / 60;

  const type = getCouponType(coupon);
  const title = (coupon.title || "").toLowerCase();
  const category = coupon.category || "";
  const combined = `${type}${title}${category}`.toLowerCase();
  const scene = slot ? (slot.scene || "") : "";
  const isFoodOrDrink = isFoodOrDrinkCoupon(coupon);

  // 判定当前实际所处的日常餐饮黄金窗口
  let currentPeriod = "dinner";
  if (timeVal >= 6.0 && timeVal < 10.0) {
    currentPeriod = "breakfast";
  } else if (timeVal >= 10.0 && timeVal < 13.75) {
    currentPeriod = "lunch";
  } else if (timeVal >= 13.75 && timeVal < 17.0) {
    currentPeriod = "afternoon";
  } else if (timeVal >= 17.0 && timeVal < 21.0) {
    currentPeriod = "dinner";
  } else {
    currentPeriod = "lateNight";
  }

  // 针对不同品类的时段亲和力匹配
  const isBreakfastItem = isFoodOrDrink && /早餐|早茶|面包|烘焙|点心|咖啡|豆浆|包子|早点/.test(combined);
  const isLunchItem = isFoodOrDrink && (/快餐|简餐|粉|面|盖饭|便当|米线|轻食|一人食|自选快餐|麻辣烫|汉堡|饭/.test(combined) || coupon.people === "1人" || coupon.people === "单人");
  const isAfternoonItem = isFoodOrDrink && /咖啡|奶茶|甜品|蛋糕|下午茶|果茶|面包|冰淇淋|茶馆|茶饮/.test(combined);
  const isAfternoonActivity = !isFoodOrDrink && /展览|书店|看展|休闲|运动|健身|瑜伽|普拉提|体验/.test(combined);
  const isDinnerItem = isFoodOrDrink && (/火锅|烤肉|烧烤|烤鱼|炒菜|双人餐|聚餐|海鲜|牛排|寿喜烧|正餐|大餐/.test(combined) || coupon.people === "2人" || coupon.people === "3-4人");
  const isLateNightItem = /清吧|精酿|酒吧|烧烤|烤串|串串|炸鸡|小龙虾|酒馆|居酒屋|宵夜|夜宵/.test(combined);

  let score = 0;
  let affinityBadge = null;

  if (currentPeriod === "breakfast") {
    if (isBreakfastItem) {
      score = 5;
      affinityBadge = { label: "🌅 晨饮早点", theme: "badge-morning" };
      reasons.push("契合当下晨间早点与咖啡唤醒时光");
    } else if (scene === "上午") {
      score = 2;
    }
  } else if (currentPeriod === "lunch") {
    if (isLunchItem) {
      score = 5;
      affinityBadge = { label: "🍜 午市精选", theme: "badge-lunch" };
      reasons.push("契合当前午餐黄金期，出餐快捷省心");
    } else if (scene === "午餐") {
      score = 2;
      affinityBadge = isFoodOrDrink
        ? { label: "🍱 午间安排", theme: "badge-lunch" }
        : { label: "☀️ 午间活动", theme: "badge-afternoon" };
    }
  } else if (currentPeriod === "afternoon") {
    if (isAfternoonItem) {
      score = 6;
      affinityBadge = { label: "☕ 下午茶小憩", theme: "badge-afternoon" };
      reasons.push("契合当前午后休闲时段，来杯咖啡或甜品小憩");
    } else if (isAfternoonActivity) {
      score = 5;
      affinityBadge = { label: "🌤️ 午后体验", theme: "badge-afternoon" };
      reasons.push("适合安排在相对从容的午后时段");
    } else if (scene === "下午") {
      score = 2;
      if (!isFoodOrDrink) affinityBadge = { label: "🌤️ 午后安排", theme: "badge-afternoon" };
    }
  } else if (currentPeriod === "dinner") {
    if (isDinnerItem) {
      score = 5;
      affinityBadge = { label: "🍲 晚市佳选", theme: "badge-dinner" };
      reasons.push("契合当前晚市聚餐时段，丰盛正餐犒赏一日辛苦");
    } else if (scene === "晚餐") {
      score = 2;
      affinityBadge = isFoodOrDrink
        ? { label: "🍽️ 晚市就餐", theme: "badge-dinner" }
        : { label: "🌙 晚间活动", theme: "badge-night" };
    }
  } else if (currentPeriod === "lateNight") {
    if (isLateNightItem) {
      score = 6;
      affinityBadge = { label: "🌙 深夜微醺", theme: "badge-night" };
      reasons.push("契合深夜宵夜氛围，适合小酌微醺或解馋烤串");
    } else if (scene === "晚上") {
      score = 2;
      if (!isFoodOrDrink) affinityBadge = { label: "🌙 夜间活动", theme: "badge-night" };
    }
  }

  if (slot && affinityBadge) {
    slot.timeAffinityBadge = affinityBadge;
  }

  return score;
}

module.exports = {
  clearContextCaches,
  isFoodOrDrinkCoupon,
  getCouponType,
  getNeedReservation,
  getReservationStatus,
  getUsageRules,
  getRefundInfo,
  getDurationMinutes,
  getCleanupMinutes,
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
};
