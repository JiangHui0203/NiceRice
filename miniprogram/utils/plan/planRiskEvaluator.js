/**
 * planRiskEvaluator.js
 * 计划履约风险评估引擎（规则链模式）
 * 消除多层嵌套判断，每个规则独立评估并返回标准风险信息
 */

const { WEEKDAYS, parsePlanStart, normalizePlan } = require("./planNormalizer.js");
const { isFactualWeather } = require("../recommendation/weatherScorer.js");
const persistedStatusByRiskView = new WeakMap();

function resolvePlanWeekday(plan = {}) {
  const selectedTime = plan.selectedTime || {};
  const direct = String(selectedTime.weekday || "").replace("星期", "周").replace("周天", "周日");
  if (WEEKDAYS.includes(direct)) return direct;
  const matched = String(selectedTime.date || plan.date || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!matched) return "";
  const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  if (Number.isNaN(date.getTime())
    || date.getFullYear() !== Number(matched[1])
    || date.getMonth() !== Number(matched[2]) - 1
    || date.getDate() !== Number(matched[3])) return "";
  return WEEKDAYS[date.getDay()];
}

function clockMinutes(value) {
  const matched = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return null;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

const RISK_RULES = [
  // 1. 户外雨雪天气风险
  (plan, ctx) => {
    const category = plan.category || (plan.recommendationSnapshot && plan.recommendationSnapshot.category);
    const weather = isFactualWeather(ctx.weather) ? ctx.weather : null;
    const weatherText = `${(weather && weather.title) || ""}${(weather && weather.desc) || ""}`;
    const isOutdoor = category === "outdoor" || /公园|户外|游船/.test(plan.title || "");
    if (/大雨|暴雨|雨/.test(weatherText) && isOutdoor) {
      return {
        type: "weather_changed",
        level: /大雨|暴雨/.test(weatherText) ? "high" : "medium",
        text: "当天有雨，户外活动体验可能受影响，建议考虑改时间。",
      };
    }
    return null;
  },

  // 2. 雨天长距离出行风险
  (plan, ctx) => {
    const weather = isFactualWeather(ctx.weather) ? ctx.weather : null;
    const weatherText = `${(weather && weather.title) || ""}${(weather && weather.desc) || ""}`;
    if (/雨|雪/.test(weatherText) && plan.route && plan.route.distanceMeters > 10000) {
      return {
        type: "rainy_long_distance",
        level: "medium",
        text: "天气不好且路程偏长，出门成本会比较高。",
      };
    }
    return null;
  },

  // 3. 好友待确认风险
  (plan, ctx, hoursLeft) => {
    const pendingFriend = (plan.participants || []).find((item) => item.id !== "self" && item.status !== "confirmed");
    if (pendingFriend && (hoursLeft === null || hoursLeft < 24)) {
      return {
        type: "friend_pending",
        level: "medium",
        text: `${pendingFriend.name}还没有确认这个计划。`,
      };
    }
    return null;
  },

  // 4. 预约未完成风险
  (plan, ctx, hoursLeft) => {
    const needReservation = plan.needReservation || plan.reservationStatus === "required" || plan.reservationStatus === "pending";
    const rawLeadHours = Number(plan.usageRules && plan.usageRules.reservationLeadTimeHours);
    const leadHours = Number.isFinite(rawLeadHours) && rawLeadHours >= 0 ? rawLeadHours : 24;
    if (needReservation && plan.reservationStatus !== "confirmed" && (hoursLeft === null || hoursLeft < leadHours)) {
      return {
        type: "reservation_missing",
        level: "high",
        text: "该券需提前预约，建议先向商家确认是否还能接待。",
      };
    }
    return null;
  },

  // 5. 不可退款高额损失风险
  (plan) => {
    const lossAmount = Number((plan.refundInfo && plan.refundInfo.lossAmount) || 0);
    if (plan.refundInfo && plan.refundInfo.refundType === "non_refundable" && lossAmount >= 100) {
      return {
        type: "loss_risk",
        level: "medium",
        text: `这张券不可退款，过期可能损失 ¥${lossAmount}。`,
      };
    }
    return null;
  },

  // 6. 重口味晚餐与次日上午日程冲突
  (plan, ctx) => {
    const tags = plan.tags || [];
    const heavyMeal = tags.includes("味道大") || tags.includes("需要洗澡洗头") || /火锅|烧烤|烤肉/.test(plan.title || "");
    const weekdayIndex = WEEKDAYS.indexOf(resolvePlanWeekday(plan));
    const nextDay = weekdayIndex > -1 ? WEEKDAYS[(weekdayIndex + 1) % 7] : "";
    const nextMorningBusy = (ctx.userSchedule || []).some((item) => item.weekday === nextDay && item.startTime <= "10:30");
    const selectedTime = plan.selectedTime || {};
    const startMinutes = clockMinutes(selectedTime.startTime);
    const endMinutes = clockMinutes(selectedTime.endTime);
    const endsLate = endMinutes !== null && (
      endMinutes > 21 * 60
      || (startMinutes !== null && endMinutes <= startMinutes)
    );
    if (heavyMeal && nextMorningBusy && endsLate) {
      return {
        type: "next_morning_cleanup",
        level: "medium",
        text: "第二天上午有固定安排，重口味晚餐要预留清洁和睡眠时间。",
      };
    }
    return null;
  },

  // 7. 计划时间已过风险
  (plan, ctx, hoursLeft) => {
    if (hoursLeft !== null && hoursLeft < 0 && !["completed", "cancelled"].includes(plan.statusCode)) {
      return {
        type: "time_passed",
        level: "medium",
        text: "计划时间已经过去，请确认是否已完成。",
      };
    }
    return null;
  },
];

function validatePlan(plan, context = {}) {
  const normalized = normalizePlan(plan);
  const now = context.now instanceof Date ? context.now : new Date();
  const startTime = parsePlanStart(normalized);
  const hoursLeft = startTime ? (startTime - now.getTime()) / (60 * 60 * 1000) : null;

  const messages = [];
  for (const rule of RISK_RULES) {
    const riskItem = rule(normalized, context, hoursLeft);
    if (riskItem) messages.push(riskItem);
  }

  const blocked = messages.some((item) => item.level === "blocked");
  const high = messages.some((item) => item.level === "high");
  const medium = messages.some((item) => item.level === "medium");

  return {
    hasRisk: messages.length > 0,
    level: blocked ? "blocked" : (high ? "high" : (medium ? "medium" : (messages.length ? "low" : "none"))),
    messages,
  };
}

function applyRisk(plan, context = {}) {
  const liveRisk = validatePlan(plan, context);
  let statusCode = plan.statusCode;

  if (!["completed", "cancelled"].includes(statusCode)) {
    if (liveRisk.messages.some((item) => item.type === "time_passed")) {
      statusCode = "expired";
    }
  }

  const evaluated = normalizePlan(Object.assign({}, plan, {
    statusCode,
    liveRisk,
  }));
  if (evaluated && statusCode !== plan.statusCode) {
    // A direct rollback save can recover the durable status through this
    // module-private identity map.
    persistedStatusByRiskView.set(evaluated, plan.statusCode);
    // setData/JSON cloning cannot retain WeakMap identity. Keep a small view-
    // only fallback that normalizePlan deliberately does not persist.
    evaluated.riskSourceStatusCode = plan.statusCode;
  }
  return evaluated;
}

function getPersistedStatusCode(plan) {
  if (!plan || typeof plan !== "object") return "";
  return persistedStatusByRiskView.get(plan)
    || (typeof plan.riskSourceStatusCode === "string" ? plan.riskSourceStatusCode : "");
}

module.exports = {
  validatePlan,
  applyRisk,
  getPersistedStatusCode,
};
