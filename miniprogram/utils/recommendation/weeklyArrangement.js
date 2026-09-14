/**
 * Weekly arrangement composer. Scoring and domain policies are injected by the facade.
 */

const { isActivePlanStatus } = require("../plan/planStatus.js");
const { planConflictsWithSlot, timeToMinutes } = require("./slotGenerator.js");

function generateWeeklyArrangement(coupons, context, dependencies = {}) {
  const {
    addDays,
    dateText,
    generateRecommendations,
    getCategory,
    getCouponType,
    isHeavyMeal,
    now = Date.now,
    pad,
  } = dependencies;
  const startStr = dateText(context.now);
  const endStr = dateText(addDays(context.now, 6));

  const usedDates = Object.create(null);
  const usedSlots = [];
  const usedDayCount = Object.create(null);
  const heavyDays = Object.create(null);
  const usedCuisines = Object.create(null);
  const usedVenues = Object.create(null);

  function registerCuisine(dateStr, type) {
    if (!type) return;
    if (!usedCuisines[dateStr]) usedCuisines[dateStr] = [];
    if (!usedCuisines[dateStr].includes(type)) {
      usedCuisines[dateStr].push(type);
    }
  }

  function resolveTimeRange(time = {}, durationMinutes = 0) {
    const start = timeToMinutes(time.startTime);
    let end = timeToMinutes(time.endTime);
    const duration = Number(durationMinutes);
    if (start === null) return null;
    if (end === null || end === start) {
      end = (start + (Number.isFinite(duration) && duration > 0 ? duration : 1)) % (24 * 60);
    }
    return { start, end };
  }

  function registerTimeRange(date, time, ownerId, durationMinutes) {
    const range = resolveTimeRange(time, durationMinutes);
    if (!range || !date) return;
    usedSlots.push({
      ownerId,
      plan: {
        id: ownerId,
        statusCode: "confirmed",
        durationMinutes,
        selectedTime: Object.assign({}, time, {
          date,
          endTime: time.endTime || minutesToClock(range.end),
        }),
      },
    });
  }

  function minutesToClock(minutes) {
    const safe = ((Number(minutes) % (24 * 60)) + (24 * 60)) % (24 * 60);
    return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
  }

  function getCachedRecommendations(sourceCoupons, cached) {
    if (!Array.isArray(cached)) return null;
    const expectedIds = (Array.isArray(sourceCoupons) ? sourceCoupons : [])
      .filter((coupon) => coupon && coupon.id)
      .map((coupon) => coupon.id);
    if (cached.length !== expectedIds.length) return null;
    const cachedById = new Map();
    for (let index = 0; index < cached.length; index += 1) {
      const item = cached[index];
      if (!item || !item.couponId || cachedById.has(item.couponId)) return null;
      cachedById.set(item.couponId, item);
    }
    if (!expectedIds.every((id) => cachedById.has(id))) return null;
    return expectedIds.map((id) => cachedById.get(id));
  }

  function isCurrentCacheSource(source) {
    return Boolean(source
      && source.coupons === coupons
      && source.existingPlans === context.existingPlans
      && source.friends === context.friends
      && source.now === context.now
      && source.routeOrigin === context.routeOrigin
      && source.userPreference === context.userPreference
      && source.userSchedule === context.userSchedule
      && source.weather === context.weather
      && source.weeklyWeather === context.weeklyWeather);
  }

  const couponMap = new Map();
  (coupons || []).forEach((coupon) => {
    if (coupon && coupon.id) couponMap.set(coupon.id, coupon);
  });
  const lookupCoupons = Array.isArray(context.allCoupons) ? context.allCoupons : (coupons || []);
  const lookupCouponMap = new Map(lookupCoupons.map((coupon) => [coupon.id, coupon]));

  const items = [];
  const conflicts = [];
  const unscheduledCoupons = [];

  const plans = context.existingPlans || [];
  plans.forEach((plan) => {
    const status = String((plan && plan.statusCode) || "");
    if (plan.selectedTime && plan.selectedTime.date &&
        plan.selectedTime.date >= startStr && plan.selectedTime.date <= endStr &&
        (!status || isActivePlanStatus(status))) {
      const time = plan.selectedTime;
      const key = `${time.date}_${time.scene}`;

      usedDates[key] = plan.couponId || `plan_${plan.id}`;
      usedDayCount[time.date] = (usedDayCount[time.date] || 0) + 1;
      registerTimeRange(time.date, time, plan.couponId || `plan_${plan.id}`, plan.durationMinutes);

      const coupon = lookupCouponMap.get(plan.couponId);
      if (coupon) {
        if (isHeavyMeal(coupon)) {
          heavyDays[time.date] = true;
        }
        registerCuisine(time.date, getCouponType(coupon));
        const existingVenueKey = String(coupon.venue || coupon.title || "").trim().toLocaleLowerCase();
        if (existingVenueKey) usedVenues[existingVenueKey] = true;
      }

      items.push({
        couponId: plan.couponId,
        planId: plan.id,
        planTime: time,
        score: plan.score !== "" && plan.score !== null && plan.score !== undefined
          && Number.isFinite(Number(plan.score))
          ? Number(plan.score)
          : null,
        isPlanned: true,
        title: plan.title,
      });
    }
  });

  // Score once, then partition. The previous implementation scored every
  // coupon twice (top candidates first, blocked diagnostics second), which
  // became expensive at the 500-coupon storage boundary.
  const cachedRecommendations = getCachedRecommendations(
    coupons,
    isCurrentCacheSource(context && context.precomputedRecommendationSource)
      ? context.precomputedRecommendations
      : null,
  );
  let allRecommendations;
  let recommendations;
  let blocked;
  if (cachedRecommendations) {
    allRecommendations = cachedRecommendations;
    recommendations = allRecommendations
      .filter((item) => item.level !== "blocked")
      .sort((a, b) => b.score - a.score);
    blocked = allRecommendations.filter((item) => item.level === "blocked");
  } else {
    allRecommendations = generateRecommendations(coupons, context) || [];
    recommendations = allRecommendations
      .filter((item) => item.level !== "blocked")
      .sort((a, b) => b.score - a.score);
    blocked = allRecommendations.filter((item) => item.level === "blocked");
  }
  recommendations.forEach((recommendation) => {
    const time = recommendation.recommendedTime;
    if (!time) {
      const blockers = Array.isArray(recommendation.blockers) ? recommendation.blockers : [];
      unscheduledCoupons.push({ couponId: recommendation.couponId, reason: blockers[0] || "没有合适时间" });
      return;
    }
    const key = `${time.date}_${time.scene}`;
    if (usedDates[key]) {
      conflicts.push({
        couponId: recommendation.couponId,
        withCouponId: usedDates[key],
        reason: `${time.weekday}${time.scene}已有安排`,
      });
      return;
    }
    const recommendedRange = resolveTimeRange(time, recommendation.durationMinutes);
    const overlapSlot = recommendedRange
      ? Object.assign({}, time, { endTime: minutesToClock(recommendedRange.end) })
      : time;
    const overlapping = recommendedRange && usedSlots.find((entry) => planConflictsWithSlot(entry.plan, overlapSlot));
    if (overlapping) {
      conflicts.push({
        couponId: recommendation.couponId,
        withCouponId: overlapping.ownerId,
        reason: `${time.weekday}${time.scene}与已有安排时间重叠`,
      });
      return;
    }
    if ((usedDayCount[time.date] || 0) >= 2) {
      conflicts.push({
        couponId: recommendation.couponId,
        reason: `${time.weekday}已经有较多安排`,
      });
      return;
    }
    const coupon = couponMap.get(recommendation.couponId) || {};
    const type = getCouponType(coupon);
    const category = getCategory(coupon);
    const isFoodOrDrink = category === "food" || category === "drink";
    const venueText = String(coupon.venue || coupon.title || "").trim();
    const venueKey = venueText.toLocaleLowerCase();

    // 1. 同店/同品牌去重避让：一周内尽量不重复同一家店
    if (venueKey && usedVenues[venueKey]) {
      conflicts.push({
        couponId: recommendation.couponId,
        reason: `本周已安排过「${venueText.slice(0, 16)}」，换一家体验更多样`,
      });
      return;
    }

    // 2. 餐饮品类冲突避让
    if (isFoodOrDrink && type && type !== "其他") {
      const dDate = new Date(`${time.date}T00:00:00`);
      let cuisineConflict = false;
      for (let dayOffset = -2; dayOffset <= 2; dayOffset++) {
        const checkDate = new Date(dDate.getTime());
        checkDate.setDate(checkDate.getDate() + dayOffset);
        const checkDateStr = `${checkDate.getFullYear()}-${pad(checkDate.getMonth() + 1)}-${pad(checkDate.getDate())}`;

        const cuisinesOnDay = usedCuisines[checkDateStr] || [];
        if (cuisinesOnDay.includes(type)) {
          cuisineConflict = true;
          break;
        }
      }
      if (cuisineConflict) {
        conflicts.push({
          couponId: recommendation.couponId,
          reason: `附近日期已有同类餐饮「${type}」，建议换搭`,
        });
        return;
      }
    }

    // 3. 连续重口味/火锅/烤肉防疲劳保护 (检查前后相邻1天)
    if (isHeavyMeal(coupon)) {
      const dDate = new Date(`${time.date}T00:00:00`);
      let heavyAdjacent = false;
      for (let offset of [-1, 0, 1]) {
        const checkDate = new Date(dDate.getTime());
        checkDate.setDate(checkDate.getDate() + offset);
        const checkDateStr = `${checkDate.getFullYear()}-${pad(checkDate.getMonth() + 1)}-${pad(checkDate.getDate())}`;
        if (heavyDays[checkDateStr]) {
          heavyAdjacent = true;
          break;
        }
      }
      if (heavyAdjacent) {
        conflicts.push({
          couponId: recommendation.couponId,
          reason: "前后相邻日期已有重口味大餐安排，建议换搭清淡或休闲活动",
        });
        return;
      }
    }

    usedDates[key] = recommendation.couponId;
    usedDayCount[time.date] = (usedDayCount[time.date] || 0) + 1;
    registerTimeRange(time.date, time, recommendation.couponId, recommendation.durationMinutes);
    if (isHeavyMeal(coupon)) heavyDays[time.date] = true;
    if (venueKey) usedVenues[venueKey] = true;
    registerCuisine(time.date, type);

    items.push({
      couponId: recommendation.couponId,
      planTime: time,
      score: recommendation.score,
      reasons: recommendation.reasons,
      recommendation,
      isPlanned: false,
    });
  });

  blocked.forEach((item) => {
    const blockers = Array.isArray(item && item.blockers) ? item.blockers : [];
    unscheduledCoupons.push({ couponId: item && item.couponId, reason: blockers[0] || "暂不推荐" });
  });

  const SCENE_ORDER = { "上午": 0, "午餐": 1, "下午": 2, "晚餐": 3, "晚上": 4 };
  items.sort((a, b) => {
    if (a.planTime.date !== b.planTime.date) {
      return a.planTime.date.localeCompare(b.planTime.date);
    }
    const aOrder = SCENE_ORDER[a.planTime.scene] !== undefined ? SCENE_ORDER[a.planTime.scene] : 99;
    const bOrder = SCENE_ORDER[b.planTime.scene] !== undefined ? SCENE_ORDER[b.planTime.scene] : 99;
    return aOrder - bOrder;
  });

  return {
    id: `batch_${now()}`,
    range: {
      startDate: startStr,
      endDate: endStr,
    },
    items: items.slice(0, 14),
    conflicts,
    unscheduledCoupons,
  };
}

module.exports = { generateWeeklyArrangement };
