const mock = require("../mock.js");
const routeService = require("../services/routeService.js");
const {
  STATUS_ALIAS_MAP,
  DAY_ORDER,
  DAY_MAP,
  DEFAULT_DURATIONS,
  DAY_MATCHERS,
  UNAVAILABLE_DAY_MATCHERS,
  REFUND_TYPE_RULES,
  STATIC_STATE_MAP,
  REFUND_TYPES,
  RESERVATION_STATUSES,
} = require("./couponConstants.js");
const {
  boundedText,
  normalizeExactId,
  hasProvidedIdentity,
  boundedNumber,
  boundedTextList,
  isTextValue,
  normalizeLocation,
  buildCouponLocation,
  normalizeRoutePoint,
  normalizeRoute,
  buildNormalizedCouponRoute,
} = require("./couponBaseNormalizer.js");
const {
  parseExactDateParts,
  normalizeDateText,
  getExactDateTimestamp,
  daysBetween,
  expireText,
  formatUsedAt,
  normalizeStatus,
  normalizeClockText,
  validateUsableTimeText,
  parseTimeRange,
  getDefaultDuration,
  expandDayRange,
  parseDayRules,
} = require("./couponTimeRules.js");
const {
  normalizePeopleCount,
  sanitizeAvailableTimeRanges,
  buildUsageRules,
  buildRefundInfo,
} = require("./couponUsageRules.js");

function computeCouponLifeState(finalStatusCode, days) {
  if (finalStatusCode === "draft") return STATIC_STATE_MAP.draft;
  if (finalStatusCode === "used") return STATIC_STATE_MAP.used;
  if (finalStatusCode === "planned") return STATIC_STATE_MAP.planned;
  if (finalStatusCode === "expired" || (days !== null && days < 0)) return STATIC_STATE_MAP.expired;
  return STATIC_STATE_MAP.pending;
}

function computeCouponLifeProgress(days, derivedStatus) {
  // 已使用是完成态，不再展示有效期生命条。
  if (derivedStatus === "used") {
    return {
      expiryProgress: 0,
      lifeColorClass: "used",
      lifeBarColor: "#94a3b8",
    };
  }
  // 2. 已过期：0% 归零灰
  if (derivedStatus === "expired" || (days !== null && days < 0)) {
    return {
      expiryProgress: 0,
      lifeColorClass: "expired",
      lifeBarColor: "#94a3b8",
    };
  }
  if (days === null) {
    return {
      expiryProgress: 0,
      lifeColorClass: "pending",
      lifeBarColor: "#94a3b8",
    };
  }
  // 3. 3天内（含今天/明天/3天内）：红色 (urgent, #e25c5c)
  if (days <= 3) {
    let progress = 3;
    if (days === 1) progress = 8;
    else if (days === 2) progress = 14;
    else if (days === 3) progress = 20;
    return {
      expiryProgress: progress,
      lifeColorClass: "urgent",
      lifeBarColor: "#e25c5c",
    };
  }
  // 4. 4 - 10天：黄色 (watch, #eab308)
  if (days >= 4 && days <= 10) {
    const progress = Math.round(22 + ((days - 4) / 6) * 23); // 22% ~ 45%
    return {
      expiryProgress: progress,
      lifeColorClass: "watch",
      lifeBarColor: "#eab308",
    };
  }
  // 5. 11天往上：绿色 (ready, #3aafa9)
  const progress = Math.min(100, Math.round(50 + ((days - 11) / 19) * 50)); // 50% ~ 100%
  return {
    expiryProgress: progress,
    lifeColorClass: "ready",
    lifeBarColor: "#3aafa9",
  };
}

function computeDiscountText(price, originalPrice) {
  const p = parseFloat(boundedText(price, 32));
  const op = parseFloat(boundedText(originalPrice, 32));
  if (p > 0 && op > p) {
    const rate = (p / op) * 10;
    return rate % 1 === 0 ? `${rate.toFixed(0)}折` : `${rate.toFixed(1)}折`;
  }
  return "";
}

function buildCouponNotices(reservationRequired, usageRules = {}, refundInfo = {}, form = {}, tags = []) {
  usageRules = usageRules && typeof usageRules === "object" && !Array.isArray(usageRules) ? usageRules : {};
  refundInfo = refundInfo && typeof refundInfo === "object" && !Array.isArray(refundInfo) ? refundInfo : {};
  tags = Array.isArray(tags) ? tags.slice(0, 30) : [];
  return [
    reservationRequired ? "需要提前预约，建议确认可用时段。" : "",
    usageRules.unavailableDays && usageRules.unavailableDays.length ? "存在不可用日期，推荐会自动避开。" : "",
    refundInfo.refundType === "non_refundable" ? "可能不可退款，临期损失风险较高。" : "",
    tags.includes("不适合工作日前夜") ? "不建议安排在工作日前夜。" : "",
    tags.includes("需要洗澡洗头") ? "建议饭后预留洗澡洗头时间。" : "",
  ].filter(Boolean);
}

module.exports = {
  computeCouponLifeState,
  computeCouponLifeProgress,
  computeDiscountText,
  buildCouponNotices,
};
