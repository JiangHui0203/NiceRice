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
const {
  computeCouponLifeState,
  computeCouponLifeProgress,
  computeDiscountText,
  buildCouponNotices,
} = require("./couponPresentation.js");
const {
  normalizeScreenshotId,
  sanitizeStoredScreenshots,
} = require("./couponMediaNormalizer.js");

function normalizeCoupon(coupon = {}) {
  if (!coupon || typeof coupon !== "object" || Array.isArray(coupon)) return null;
  const id = normalizeExactId(coupon.id);
  if (!id) return null;
  const hasPlanId = hasProvidedIdentity(coupon.planId);
  const planId = hasPlanId ? normalizeExactId(coupon.planId) : "";
  if (hasPlanId && !planId) return null;

  const type = boundedText(coupon.type || coupon.subCategory, 48, "其他");
  const preset = mock.typeDefaults[type] || mock.typeDefaults["其他"] || { category: "food", tags: [] };
  const rawStatus = boundedText(coupon.statusCode || coupon.status, 32);
  const expireDate = normalizeDateText(coupon.expireDate || coupon.expireAt);
  const rawUsableTime = boundedText(coupon.usableTime, 160);
  const usableTime = validateUsableTimeText(rawUsableTime) ? rawUsableTime : "";
  const normalizedSource = {
    usableTime,
    ruleNotes: boundedText(coupon.ruleNotes, 1000),
    note: boundedText(coupon.note, 1000),
    usageRules: coupon.usageRules,
    availableDays: coupon.availableDays,
    unavailableDays: coupon.unavailableDays,
    reservationLeadTimeHours: coupon.reservationLeadTimeHours,
    storeLimit: coupon.storeLimit,
    refundType: coupon.refundType,
    refundInfo: coupon.refundInfo,
    lossAmount: coupon.lossAmount,
    price: boundedText(coupon.price, 32),
    refundDeadline: coupon.refundDeadline,
    expireDate,
  };
  const days = daysBetween(expireDate);
  const normalizedStatus = normalizeStatus(rawStatus);
  const derivedStatus = days !== null && days < 0 && normalizedStatus !== "used"
    ? "expired"
    : normalizedStatus;

  const rawReservationStatus = boundedText(coupon.reservationStatus, 32);
  const reservationRequiredByStatus = ["required", "pending", "confirmed", "failed"].includes(rawReservationStatus);
  const nestedReservationRequired = coupon.usageRules
    && typeof coupon.usageRules === "object"
    && !Array.isArray(coupon.usageRules)
    && coupon.usageRules.needReservation === true;
  const reservationRequired = rawReservationStatus === "not_required"
    ? false
    : (reservationRequiredByStatus
      || coupon.reservationRequired === true
      || coupon.needReservation === true
      || nestedReservationRequired);
  const hasReservationDeclaration = typeof coupon.reservationRequired === "boolean"
    || typeof coupon.needReservation === "boolean"
    || (coupon.usageRules
      && typeof coupon.usageRules === "object"
      && !Array.isArray(coupon.usageRules)
      && typeof coupon.usageRules.needReservation === "boolean");
  const reservationStatus = RESERVATION_STATUSES.has(rawReservationStatus)
    ? rawReservationStatus
    : (hasReservationDeclaration
      ? (reservationRequired ? "required" : "not_required")
      : "unknown");
  const usageRules = buildUsageRules(normalizedSource, reservationRequired);
  const refundInfo = buildRefundInfo(normalizedSource);
  const lifeState = computeCouponLifeState(derivedStatus, days);
  const lifeProgress = computeCouponLifeProgress(days, derivedStatus);
  const usedAtSource = boundedText(coupon.usedAt || coupon.completedAt || coupon.lastUsedAt, 80);
  const usedAtText = formatUsedAt(usedAtSource);
  const validityText = derivedStatus === "used"
    ? (usedAtText ? `使用于 ${usedAtText}` : "使用时间待补")
    : expireText(expireDate);
  const validityValue = derivedStatus === "used"
    ? (usedAtText || "时间待补")
    : validityText;
  const validityLabel = derivedStatus === "used" ? "使用时间" : "截止";
  const location = buildCouponLocation(coupon);

  const route = buildNormalizedCouponRoute(coupon, location);

  const durationMinutes = boundedNumber(
    coupon.durationMinutes || (coupon.duration && coupon.duration.actTime) || getDefaultDuration(type),
    1,
    10080,
    getDefaultDuration(type),
  );
  const availableTime = parseTimeRange(usableTime);
  const tags = boundedTextList(
    Array.isArray(coupon.tags) && coupon.tags.length ? coupon.tags : preset.tags,
    30,
    48,
  );
  const notices = buildCouponNotices(reservationRequired, usageRules, refundInfo, normalizedSource, tags);
  const price = boundedText(coupon.price, 32);
  const originalPrice = boundedText(coupon.originalPrice, 32);

  return {
    id,
    title: boundedText(coupon.title, 120, `${type}券`),
    venue: boundedText(coupon.venue || coupon.merchantName, 120, "待补充店名"),
    merchantName: boundedText(coupon.venue || coupon.merchantName, 120, "待补充店名"),
    type,
    subCategory: type,
    category: boundedText(coupon.category || preset.category, 48, "other"),
    people: boundedText(coupon.people, 32, "人数待补充"),
    peopleCount: normalizePeopleCount(coupon.people),
    platform: boundedText(coupon.platform, 48, "平台待补充"),
    reservationRequired,
    needReservation: reservationRequired,
    reservationStatus,
    reservationLeadTimeHours: usageRules.reservationLeadTimeHours,
    refundType: refundInfo.refundType,
    expireDate,
    expireAt: expireDate,
    days,
    usedAt: usedAtText,
    usedAtText,
    validityText,
    validityValue,
    validityLabel,
    expiresIn: validityText,
    usableTime: usableTime || "时段待补充",
    availableTime,
    address: boundedText(location.address || coupon.address, 500, "待补充地址"),
    location,
    latitude: location.latitude,
    longitude: location.longitude,
    travelTime: boundedText(route.distanceText, 80, "待估算"),
    route,
    durationMinutes,
    duration: {
      prepTime: 15,
      goTime: route.durationMinutes || 0,
      actTime: durationMinutes,
      backTime: route.durationMinutes || 0,
      cleanTime: tags.includes("需要洗澡洗头") ? 45 : (tags.includes("需要简单整理") ? 20 : 0),
      bufferTime: 15,
    },
    price,
    originalPrice,
    discountText: computeDiscountText(price, originalPrice),
    shortReason: boundedText(coupon.shortReason, 300),
    dishes: boundedText(coupon.dishes, 1000),
    tags,
    reasons: boundedTextList(coupon.reasons, 8, 200),
    reasonItems: (Array.isArray(coupon.reasonItems) ? coupon.reasonItems : []).slice(0, 8).map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      return {
        label: boundedText(item.label, 48),
        desc: boundedText(item.desc, 200),
      };
    }).filter((item) => item && (item.label || item.desc)),
    notices: boundedTextList(notices, 8, 200),
    note: boundedText(coupon.note, 1000),
    storeLimit: boundedText(coupon.storeLimit || usageRules.storeLimit, 500),
    ruleNotes: boundedText(coupon.ruleNotes || usageRules.notes, 1000),
    screenshots: sanitizeStoredScreenshots(coupon.screenshots),
    lossAmount: refundInfo.lossAmount,
    cleanup: boundedText(
      coupon.cleanup || (tags.includes("需要洗澡洗头") ? "饭后预留 45 分钟洗澡洗头" : ""),
      200,
    ),
    statusCode: derivedStatus,
    status: lifeState.state,
    state: lifeState.state,
    stateClass: lifeState.stateClass,
    expiryProgress: lifeProgress.expiryProgress,
    lifeColorClass: lifeProgress.lifeColorClass,
    lifeBarColor: lifeProgress.lifeBarColor,
    score: boundedNumber(coupon.score, 0, 100),
    usageRules,
    refundInfo,
    planId,
    usageNote: boundedText(coupon.usageNote, 500),
    notes: boundedText(coupon.notes, 1000),
    recommendedAt: boundedText(coupon.recommendedAt, 160),
    recommendationScore: boundedNumber(coupon.recommendationScore, 0, 100),
    selected: coupon.selected === false ? false : (coupon.selected === true ? true : undefined),
    heavy: coupon.heavy === true,
    createdAt: boundedText(coupon.createdAt, 40),
    updatedAt: boundedText(coupon.updatedAt, 40),
    source: boundedText(coupon.source, 48),
  };
}

function buildCoupon(form = {}) {
  form = form && typeof form === "object" && !Array.isArray(form) ? form : {};
  const type = boundedText(form.type, 48, "其他");
  const preset = mock.typeDefaults[type] || mock.typeDefaults["其他"] || { category: "food", tags: [] };
  const tags = Array.isArray(form.tags) && form.tags.length ? form.tags : preset.tags;
  const reservationRequired = form.reservationRequired === true || form.needReservation === true;
  const incomingUsageRules = form.usageRules
    && typeof form.usageRules === "object"
    && !Array.isArray(form.usageRules)
    ? form.usageRules
    : {};
  const usageRules = {
    availableDays: incomingUsageRules.availableDays,
    unavailableDays: incomingUsageRules.unavailableDays,
    availableTimeRanges: incomingUsageRules.availableTimeRanges,
    holidayAvailable: incomingUsageRules.holidayAvailable,
    needReservation: reservationRequired,
    reservationLeadTimeHours: form.reservationLeadTimeHours !== undefined
      ? form.reservationLeadTimeHours
      : incomingUsageRules.reservationLeadTimeHours,
    refundType: form.refundType !== undefined ? form.refundType : incomingUsageRules.refundType,
    storeLimit: form.storeLimit !== undefined ? form.storeLimit : incomingUsageRules.storeLimit,
    notes: form.ruleNotes !== undefined ? form.ruleNotes : incomingUsageRules.notes,
  };
  const incomingRefundInfo = form.refundInfo
    && typeof form.refundInfo === "object"
    && !Array.isArray(form.refundInfo)
    ? form.refundInfo
    : {};
  const refundInfo = {
    refundable: incomingRefundInfo.refundable,
    refundType: form.refundType !== undefined ? form.refundType : incomingRefundInfo.refundType,
    refundDeadline: form.refundDeadline !== undefined
      ? form.refundDeadline
      : incomingRefundInfo.refundDeadline,
    lossAmount: form.lossAmount !== undefined ? form.lossAmount : incomingRefundInfo.lossAmount,
    non_refundable: incomingRefundInfo.non_refundable === true
      || (form.refundType !== undefined ? form.refundType : incomingRefundInfo.refundType) === "non_refundable",
  };
  const location = buildCouponLocation(form);
  const route = buildNormalizedCouponRoute(form, location);

  return normalizeCoupon({
    id: form.id || `c_user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: form.title,
    venue: form.venue || form.merchantName || "待补充店名",
    merchantName: form.venue || form.merchantName || "待补充店名",
    type,
    category: preset.category,
    people: form.people || "人数待补充",
    platform: form.platform || "平台待补充",
    reservationRequired,
    needReservation: reservationRequired,
    reservationStatus: form.reservationStatus || (reservationRequired ? "required" : "not_required"),
    expireDate: form.expireDate,
    usableTime: form.usableTime || "待补充",
    address: location.address || "待补充地址",
    location,
    travelTime: route.distanceText,
    route,
    durationMinutes: form.durationMinutes || getDefaultDuration(type),
    price: form.price,
    originalPrice: form.originalPrice,
    shortReason: form.shortReason || "",
    dishes: form.dishes || "",
    tags,
    note: form.note || "",
    cleanup: form.cleanup || preset.cleanup || "",
    statusCode: form.statusCode || form.status,
    score: form.score,
    ruleNotes: form.ruleNotes || "",
    storeLimit: form.storeLimit || "",
    refundType: form.refundType,
    refundDeadline: form.refundDeadline,
    lossAmount: form.lossAmount,
    reservationLeadTimeHours: form.reservationLeadTimeHours,
    usageRules,
    refundInfo,
    screenshots: form.screenshots,
    usedAt: form.usedAt || form.completedAt || form.lastUsedAt,
    reasons: form.reasons,
    reasonItems: form.reasonItems,
    planId: form.planId,
    usageNote: form.usageNote,
    notes: form.notes,
    recommendedAt: form.recommendedAt,
    recommendationScore: form.recommendationScore,
    selected: form.selected,
    heavy: form.heavy,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
    source: form.source,
  });
}

module.exports = {
  normalizeCoupon,
  buildCoupon,
};
