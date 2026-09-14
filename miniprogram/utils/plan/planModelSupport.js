const mock = require("../mock.js");
const { pad } = require("../dateUtils.js");
const { hasCoordinates, normalizeCoordinate } = require("../locationUtils.js");
const {
  STATUS_META,
  STATUS_ALIAS_MAP,
  WEEKDAYS,
  ACTIVE_SCHEDULE_STATUSES,
  PARTICIPANT_STATUSES,
  RESERVATION_STATUSES,
  REFUND_TYPES,
  RECOMMENDATION_LEVELS,
  RISK_LEVELS,
  SCORE_BREAKDOWN_KEYS,
  DAY_ALIASES,
} = require("./planConstants.js");
const {
  boundedText,
  normalizeExactId,
  hasProvidedIdentity,
  boundedNumber,
  normalizeRevision,
  normalizeBoundedCoordinate,
  normalizeInviteId,
  boundedTextList,
  isTextValue,
  normalizeExactDate,
  normalizeClock,
  normalizeSelectedTime,
  normalizeParticipants,
  normalizeLocation,
  normalizeRoutePoint,
  hasLocationValue,
  normalizeRoute,
} = require("./planBaseNormalizer.js");
const {
  normalizeUsageRules,
  mergeUsageRules,
  normalizeRefundInfo,
  mergeRefundInfo,
} = require("./planPolicyNormalizer.js");
const {
  normalizeWeatherView,
  normalizeRecommendationSnapshot,
  normalizeLiveRisk,
  normalizeChangeLogs,
  normalizeFeedback,
  normalizeInviteSnapshot,
} = require("./planSnapshotNormalizer.js");

function findMockCoupon(couponId) {
  return (mock.coupons || []).find((coupon) => coupon.id === couponId) || null;
}

function buildLocationFromCoupon(coupon = {}) {
  coupon = coupon && typeof coupon === "object" && !Array.isArray(coupon) ? coupon : {};
  const loc = coupon.location && typeof coupon.location === "object" && !Array.isArray(coupon.location)
    ? coupon.location
    : {};
  return {
    name: coupon.venue || coupon.merchantName || "",
    address: loc.address || coupon.address || "",
    latitude: loc.latitude !== undefined ? loc.latitude : coupon.latitude,
    longitude: loc.longitude !== undefined ? loc.longitude : coupon.longitude,
    distanceText: coupon.travelTime || (coupon.route && coupon.route.distanceText) || "",
    source: loc.source || "coupon",
  };
}

function nowText() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function normalizeStatus(status) {
  const normalized = boundedText(status, 32);
  return STATUS_ALIAS_MAP[normalized] || (STATUS_META[normalized] ? normalized : "pending");
}

function statusLabel(statusCode) {
  return (STATUS_META[statusCode] || STATUS_META.pending).label;
}

function statusClass(statusCode) {
  return (STATUS_META[statusCode] || STATUS_META.pending).className;
}

function selectedTimeFromLegacy(plan = {}) {
  plan = plan && typeof plan === "object" && !Array.isArray(plan) ? plan : {};
  const dateText = boundedText(plan.date, 32) || "待定";
  const timeText = boundedText(plan.startTime || plan.time, 16) || "待定";
  return {
    date: dateText.includes("-") ? dateText : "",
    label: dateText,
    weekday: "",
    startTime: timeText,
    endTime: boundedText(plan.endTime, 16),
    scene: "",
  };
}

function parsePlanStart(plan = {}) {
  plan = plan && typeof plan === "object" && !Array.isArray(plan) ? plan : {};
  const selectedTime = plan.selectedTime || {};
  const dateStr = normalizeExactDate(selectedTime.date || plan.date);
  const timeStr = normalizeClock(selectedTime.startTime || plan.startTime || plan.time);
  if (!dateStr || !timeStr) return Number.MAX_SAFE_INTEGER;
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return Number.MAX_SAFE_INTEGER;
  }
  return date.getTime();
}

function resolveReservation(plan = {}, coupon = {}) {
  plan = plan && typeof plan === "object" && !Array.isArray(plan) ? plan : {};
  coupon = coupon && typeof coupon === "object" && !Array.isArray(coupon) ? coupon : {};
  const rawStatus = boundedText(plan.reservationStatus || coupon.reservationStatus, 32);
  const status = RESERVATION_STATUSES.has(rawStatus) ? rawStatus : "unknown";
  if (["required", "pending", "confirmed", "failed"].includes(status)) {
    return { needReservation: true, reservationStatus: status };
  }
  if (status === "not_required") {
    return { needReservation: false, reservationStatus: status };
  }
  if (typeof plan.needReservation === "boolean") {
    return {
      needReservation: plan.needReservation,
      reservationStatus: plan.needReservation ? "required" : "not_required",
    };
  }
  if (plan.usageRules && typeof plan.usageRules === "object" && !Array.isArray(plan.usageRules)
    && typeof plan.usageRules.needReservation === "boolean") {
    return {
      needReservation: plan.usageRules.needReservation,
      reservationStatus: plan.usageRules.needReservation ? "required" : "not_required",
    };
  }
  if (typeof coupon.reservationRequired === "boolean" && coupon.reservationStatus !== "unknown") {
    return {
      needReservation: coupon.reservationRequired,
      reservationStatus: coupon.reservationRequired ? "required" : "not_required",
    };
  }
  if (coupon.usageRules && typeof coupon.usageRules === "object" && !Array.isArray(coupon.usageRules)
    && typeof coupon.usageRules.needReservation === "boolean") {
    return {
      needReservation: coupon.usageRules.needReservation,
      reservationStatus: coupon.usageRules.needReservation ? "required" : "not_required",
    };
  }
  return { needReservation: null, reservationStatus: "unknown" };
}

module.exports = {
  findMockCoupon,
  hasLocationValue,
  buildLocationFromCoupon,
  nowText,
  normalizeStatus,
  statusLabel,
  statusClass,
  selectedTimeFromLegacy,
  parsePlanStart,
  resolveReservation,
};
