/**
 * Slot Generator & Schedule Conflict Resolver
 * 候选时段生成与日程冲突检测（纯函数 & 扁平卫语句）
 */
const { formatDate: dateText, pad } = require("../dateUtils.js");
const { isActivePlanStatus } = require("../plan/planStatus.js");

const mock = require("../mock.js");

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const SCENE_SLOTS = {
  lunch: { scene: "午餐", startTime: "11:30", endTime: "13:00" },
  afternoon: { scene: "下午", startTime: "14:00", endTime: "17:00" },
  dinner: { scene: "晚餐", startTime: "18:30", endTime: "21:00" },
  evening: { scene: "晚上", startTime: "19:00", endTime: "21:30" },
  weekendHalfDay: { scene: "周末半日", startTime: "13:00", endTime: "18:00" },
  morning: { scene: "上午", startTime: "09:30", endTime: "12:00" },
};

const TYPE_SCENES = {
  粉面: ["lunch", "dinner"],
  火锅: ["dinner", "weekendHalfDay"],
  烧烤: ["dinner"],
  咖啡甜品: ["afternoon", "evening"],
  展览: ["weekendHalfDay", "afternoon"],
  公园: ["morning", "afternoon"],
  户外: ["morning", "afternoon"],
  温泉: ["weekendHalfDay"],
  其他: ["afternoon", "dinner"],
};

function dateTime(date, timeText) {
  const [hour, minute] = String(timeText || "00:00").split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour || 0, minute || 0, 0, 0);
}

function parseExactDateParts(dateTextValue) {
  const matched = String(dateTextValue || "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { year, month, day };
}

function slotDateTime(slot, timeText) {
  if (!slot || !slot.date) return null;
  const dateParts = parseExactDateParts(slot.date);
  const minutes = timeToMinutes(timeText);
  if (!dateParts || minutes === null) return null;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const date = new Date(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute, 0, 0);
  if (date.getFullYear() !== dateParts.year
    || date.getMonth() !== dateParts.month - 1
    || date.getDate() !== dateParts.day
    || date.getHours() !== hour
    || date.getMinutes() !== minute) return null;
  return date.getTime();
}

function expireEndTime(coupon) {
  if (!coupon || !coupon.expireDate) return null;
  const dateParts = parseExactDateParts(coupon.expireDate);
  if (!dateParts) return null;
  return new Date(dateParts.year, dateParts.month - 1, dateParts.day, 23, 59, 59, 999).getTime();
}

function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function daysUntil(dateTextValue, now = new Date()) {
  const matched = String(dateTextValue || "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const targetDate = new Date(year, month - 1, day, 23, 59, 59, 999);
  if (targetDate.getFullYear() !== year
    || targetDate.getMonth() !== month - 1
    || targetDate.getDate() !== day) return null;
  return Math.ceil((targetDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

function parseNumber(text) {
  const matched = String(text || "").match(/\d+(\.\d+)?/);
  return matched ? Number(matched[0]) : null;
}

function timeToMinutes(timeText) {
  if (!timeText) return null;
  const matched = String(timeText).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return null;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23
    || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function minutesToTime(minutes) {
  if (minutes === "" || minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return "";
  const safe = ((Math.round(Number(minutes)) % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${pad(hour)}:${pad(minute)}`;
}

function toMin(val) {
  if (typeof val !== "number") return timeToMinutes(val);
  return Number.isFinite(val) && val >= 0 && val <= 48 * 60 ? val : null;
}

function weeklyRangesOverlap(aWeekday, aStart, aEnd, bWeekday, bStart, bEnd) {
  const aDay = WEEKDAYS.indexOf(String(aWeekday || "").replace("星期", "周").replace("周天", "周日"));
  const bDay = WEEKDAYS.indexOf(String(bWeekday || "").replace("星期", "周").replace("周天", "周日"));
  const [aS, aERaw, bS, bERaw] = [toMin(aStart), toMin(aEnd), toMin(bStart), toMin(bEnd)];
  if (aDay < 0 || bDay < 0 || aS === null || aERaw === null || bS === null || bERaw === null) return false;
  if (aS === aERaw || bS === bERaw) return false;
  const weekMinutes = 7 * 24 * 60;
  const aStartAbs = aDay * 24 * 60 + aS;
  let aEndAbs = aDay * 24 * 60 + aERaw;
  if (aEndAbs <= aStartAbs) aEndAbs += 24 * 60;
  const bStartBase = bDay * 24 * 60 + bS;
  let bEndBase = bDay * 24 * 60 + bERaw;
  if (bEndBase <= bStartBase) bEndBase += 24 * 60;
  return [-weekMinutes, 0, weekMinutes].some((offset) => (
    Math.max(aStartAbs, bStartBase + offset) < Math.min(aEndAbs, bEndBase + offset)
  ));
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  const [aS, aERaw, bS, bERaw] = [toMin(aStart), toMin(aEnd), toMin(bStart), toMin(bEnd)];
  if (aS === null || aERaw === null || bS === null || bERaw === null) return false;
  if (aS === aERaw || bS === bERaw) return false;
  const aE = aERaw <= aS ? aERaw + 24 * 60 : aERaw;
  const bE = bERaw <= bS ? bERaw + 24 * 60 : bERaw;
  return [-24 * 60, 0, 24 * 60].some((offset) => (
    Math.max(aS, bS + offset) < Math.min(aE, bE + offset)
  ));
}

function rangeContains(containerStart, containerEnd, childStart, childEnd) {
  const [cS, cERaw, kS, kERaw] = [toMin(containerStart), toMin(containerEnd), toMin(childStart), toMin(childEnd)];
  if (cS === null || cERaw === null || kS === null || kERaw === null) return false;
  if (cS === cERaw || kS === kERaw) return false;
  const cE = cERaw <= cS ? cERaw + 24 * 60 : cERaw;
  const kE = kERaw <= kS ? kERaw + 24 * 60 : kERaw;
  return [-24 * 60, 0, 24 * 60].some((offset) => cS <= kS + offset && cE >= kE + offset);
}

function isActivePlan(plan = {}) {
  return isActivePlanStatus(plan.statusCode);
}

function parseDateStart(value) {
  const matched = String(value || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day) return null;
  return date.getTime();
}

function getPlanAbsoluteRange(plan = {}) {
  if (!isActivePlan(plan)) return null;
  const selectedTime = plan.selectedTime || {};
  const planDayStart = parseDateStart(selectedTime.date || plan.date || "");
  const planStart = timeToMinutes(selectedTime.startTime || plan.startTime || plan.time);
  let planEnd = timeToMinutes(selectedTime.endTime || plan.endTime);
  const durationMinutes = Number(plan.durationMinutes);
  if (planEnd !== null && planStart !== null && planEnd === planStart) planEnd = null;
  if (planEnd === null && planStart !== null && Number.isFinite(durationMinutes) && durationMinutes > 0) {
    planEnd = planStart + durationMinutes;
  }
  if (planDayStart === null || planStart === null || planEnd === null) return null;
  const start = planDayStart + planStart * 60 * 1000;
  let end = planDayStart + planEnd * 60 * 1000;
  if (end <= start) end += 24 * 60 * 60 * 1000;
  return { start, end };
}

function getSlotAbsoluteRange(slot = {}) {
  const slotDayStart = parseDateStart(slot.date);
  const slotStart = timeToMinutes(slot.startTime);
  const slotEnd = timeToMinutes(slot.endTime);
  if (slotDayStart === null || slotStart === null || slotEnd === null) return null;
  const start = slotDayStart + slotStart * 60 * 1000;
  let end = slotDayStart + slotEnd * 60 * 1000;
  if (end <= start) end += 24 * 60 * 60 * 1000;
  return { start, end };
}

function planConflictsWithSlot(plan = {}, slot = {}) {
  const planRange = getPlanAbsoluteRange(plan);
  const slotRange = getSlotAbsoluteRange(slot);
  if (!planRange || !slotRange) return false;
  return Math.max(planRange.start, slotRange.start) < Math.min(planRange.end, slotRange.end);
}

const planConflictIndexCache = new WeakMap();

function getCalendarDayStarts(range = {}) {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) return [];
  const cursor = new Date(range.start);
  cursor.setHours(0, 0, 0, 0);
  const starts = [];
  // Plan durations are bounded by the normalizer, but keep a defensive cap so
  // corrupt caller-owned objects cannot create an unbounded loop here.
  for (let count = 0; count < 32 && cursor.getTime() < range.end; count += 1) {
    starts.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  return starts;
}

function buildPlanConflictIndex(context = {}) {
  const plans = Array.isArray(context && context.existingPlans) ? context.existingPlans : [];
  const revision = context && (context.recommendationCacheRevision || context.cacheRevision);
  if (context && typeof context === "object" && planConflictIndexCache.has(context)) {
    const cached = planConflictIndexCache.get(context);
    if (cached.source === plans && cached.length === plans.length && cached.revision === revision) {
      return cached.byDay;
    }
  }
  const byDay = new Map();
  plans.forEach((plan) => {
    const range = getPlanAbsoluteRange(plan);
    if (!range) return;
    getCalendarDayStarts(range).forEach((dayStart) => {
      const entries = byDay.get(dayStart) || [];
      entries.push({ plan, start: range.start, end: range.end });
      byDay.set(dayStart, entries);
    });
  });
  if (context && typeof context === "object") {
    planConflictIndexCache.set(context, {
      byDay,
      length: plans.length,
      revision,
      source: plans,
    });
  }
  return byDay;
}

function getExistingPlanConflict(slot, context = {}) {
  const slotRange = getSlotAbsoluteRange(slot);
  if (!slotRange) return null;
  const index = buildPlanConflictIndex(context);
  const seenPlans = new Set();
  const dayStarts = getCalendarDayStarts(slotRange);
  for (let dayIndex = 0; dayIndex < dayStarts.length; dayIndex += 1) {
    const candidates = index.get(dayStarts[dayIndex]) || [];
    for (let indexValue = 0; indexValue < candidates.length; indexValue += 1) {
      const entry = candidates[indexValue];
      if (seenPlans.has(entry.plan)) continue;
      seenPlans.add(entry.plan);
      if (Math.max(entry.start, slotRange.start) < Math.min(entry.end, slotRange.end)) {
        return entry.plan;
      }
    }
  }
  return null;
}

function isSlotAllowedByRules(coupon = {}, slot = {}) {
  const rules = coupon.usageRules || {};
  if (Array.isArray(rules.unavailableDays) && rules.unavailableDays.includes(slot.dayKey)) return false;
  if (Array.isArray(rules.availableDays) && rules.availableDays.length && !rules.availableDays.includes(slot.dayKey)) return false;
  if (rules.holidayAvailable === false && (slot.dayKey === "sat" || slot.dayKey === "sun")) return false;

  if (Array.isArray(rules.availableTimeRanges) && rules.availableTimeRanges.length) {
    const slotStart = timeToMinutes(slot.startTime);
    const slotEnd = timeToMinutes(slot.endTime);
    const matchesAny = rules.availableTimeRanges.some((range) => {
      const rStart = timeToMinutes(range.start);
      const rEnd = timeToMinutes(range.end);
      if (rStart === null || rEnd === null) return false;
      return rangeContains(rStart, rEnd, slotStart, slotEnd);
    });
    if (!matchesAny) return false;
  }
  return true;
}

function getCouponType(coupon = {}) {
  return coupon.type || coupon.subCategory || coupon.category || "其他";
}

function generateCandidateSlots(coupon = {}, context = {}) {
  const type = getCouponType(coupon);
  const scenes = TYPE_SCENES[type] || TYPE_SCENES["其他"];
  const slots = [];
  const now = context.now || new Date();
  const expireLimit = expireEndTime(coupon);

  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(now, offset);
    const dayKey = DAY_KEYS[date.getDay()];
    const isToday = offset === 0;

    for (const sceneKey of scenes) {
      const template = SCENE_SLOTS[sceneKey];
      if (!template) continue;
      if (sceneKey === "weekendHalfDay" && dayKey !== "sat" && dayKey !== "sun") continue;

      const slotStart = dateTime(date, template.startTime);
      const slotEnd = dateTime(date, template.endTime);

      if (isToday && slotStart.getTime() <= now.getTime()) continue;
      if (expireLimit && slotEnd.getTime() > expireLimit) continue;

      const slot = {
        key: `${dateText(date)}_${sceneKey}`,
        date: dateText(date),
        weekday: WEEKDAYS[date.getDay()],
        dayKey,
        scene: template.scene,
        sceneKey,
        startTime: template.startTime,
        endTime: template.endTime,
        dayOffset: offset,
        isWeekend: dayKey === "sat" || dayKey === "sun",
      };

      if (isSlotAllowedByRules(coupon, slot)) {
        slots.push(slot);
      }
    }
  }

  return slots;
}

module.exports = {
  WEEKDAYS,
  DAY_KEYS,
  SCENE_SLOTS,
  TYPE_SCENES,
  pad,
  dateText,
  dateTime,
  slotDateTime,
  expireEndTime,
  addDays,
  daysUntil,
  parseNumber,
  timeToMinutes,
  minutesToTime,
  rangesOverlap,
  weeklyRangesOverlap,
  rangeContains,
  isActivePlan,
  planConflictsWithSlot,
  getExistingPlanConflict,
  isSlotAllowedByRules,
  getCouponType,
  generateCandidateSlots,
};
