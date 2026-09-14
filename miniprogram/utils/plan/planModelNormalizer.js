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
const {
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
} = require("./planModelSupport.js");

function normalizePlan(plan = {}) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null;
  const id = normalizeExactId(plan.id);
  if (!id) return null;

  const requestedStatusCode = normalizeStatus(plan.statusCode || plan.status);
  const hasCouponId = hasProvidedIdentity(plan.couponId);
  const hasSourceId = hasProvidedIdentity(plan.sourceId);
  const rawCouponId = hasCouponId ? plan.couponId : (hasSourceId ? plan.sourceId : "");
  const couponId = hasCouponId || hasSourceId ? normalizeExactId(rawCouponId) : "";
  if ((hasCouponId || hasSourceId) && !couponId) return null;
  const sourceId = hasSourceId ? normalizeExactId(plan.sourceId) : couponId;
  if (hasSourceId && !sourceId) return null;
  if (couponId && sourceId && couponId !== sourceId) return null;
  const coupon = findMockCoupon(couponId) || {};
  const selectedTimeSource = plan.selectedTime && typeof plan.selectedTime === "object" && !Array.isArray(plan.selectedTime)
    ? plan.selectedTime
    : selectedTimeFromLegacy(plan);
  const selectedTime = normalizeSelectedTime(selectedTimeSource);
  const hasScheduledTime = Boolean(selectedTime.date && selectedTime.startTime);
  const statusCode = ACTIVE_SCHEDULE_STATUSES.has(requestedStatusCode) && !hasScheduledTime
    ? "draft"
    : requestedStatusCode;
  const participants = normalizeParticipants(plan.participants);

  const rawLocation = plan.location && hasLocationValue(plan.location)
    ? plan.location
    : buildLocationFromCoupon(coupon);

  const location = normalizeLocation(rawLocation);

  const mergedUsageRules = mergeUsageRules(coupon.usageRules, plan.usageRules);
  const refundInfo = mergeRefundInfo(coupon.refundInfo, plan.refundInfo);
  const tags = boundedTextList(Array.isArray(plan.tags) && plan.tags.length ? plan.tags : coupon.tags, 30, 48);
  const { needReservation, reservationStatus } = resolveReservation(plan, coupon);
  const usageRules = Object.assign({}, mergedUsageRules, { needReservation: needReservation === true });
  const route = normalizeRoute(
    plan.route && typeof plan.route === "object" && !Array.isArray(plan.route) ? plan.route : coupon.route,
    location,
  );
  const durationMinutes = boundedNumber(plan.durationMinutes, 1, 10080);
  const score = boundedNumber(plan.score, 0, 100);
  const recommendationSnapshot = normalizeRecommendationSnapshot(plan.recommendationSnapshot);
  const directInviteId = normalizeInviteId(plan.inviteId);
  const normalizedInviteSnapshot = normalizeInviteSnapshot(plan.inviteSnapshot);
  const inviteSnapshot = normalizedInviteSnapshot
    && (!directInviteId || normalizedInviteSnapshot.inviteId === directInviteId)
    && (!normalizedInviteSnapshot.planId || normalizedInviteSnapshot.planId === id)
    && (!normalizedInviteSnapshot.couponId || normalizedInviteSnapshot.couponId === couponId)
    ? normalizedInviteSnapshot
    : null;
  const feedback = normalizeFeedback(plan.feedback);

  return {
    id,
    couponId,
    sourceId,
    title: boundedText(plan.title || coupon.title || "自定义计划", 120),
    category: boundedText(plan.category || coupon.category, 32),
    statusCode,
    status: statusLabel(statusCode),
    statusClass: statusClass(statusCode),
    date: selectedTime.date || "待定",
    time: selectedTime.startTime || "待定",
    startTime: selectedTime.startTime,
    endTime: selectedTime.endTime,
    venue: boundedText(location.name || plan.venue || coupon.venue || "地点待定", 120),
    address: boundedText(location.address || plan.address || coupon.address || "待补充地址", 500),
    location,
    latitude: location.latitude,
    longitude: location.longitude,
    route,
    travelTime: boundedText(plan.travelTime || location.distanceText || coupon.travelTime || "待估算", 64),
    durationMinutes,
    price: boundedText(plan.price, 32),
    originalPrice: boundedText(plan.originalPrice, 32),
    platform: boundedText(plan.platform, 48),
    type: boundedText(plan.type || coupon.type, 48),
    dishes: boundedText(plan.dishes || coupon.dishes, 1000),
    score,
    cleanup: boundedText(plan.cleanup || coupon.cleanup || (tags.includes("需要洗澡洗头") ? "饭后预留 45 分钟洗澡洗头" : ""), 200),
    selectedTime,
    participants,
    withText: boundedText(plan.withText || participants.map((p) => p.name).join("、"), 300),
    note: boundedText(plan.note || coupon.note, 1000),
    tags,
    needReservation,
    reservationStatus,
    usageRules,
    refundInfo,
    liveRisk: normalizeLiveRisk(plan.liveRisk),
    changeLogs: normalizeChangeLogs(plan.changeLogs),
    recommendationSnapshot,
    weatherView: normalizeWeatherView(plan.weatherView),
    reminders: boundedTextList(plan.reminders, 20, 160),
    inviteId: directInviteId || (inviteSnapshot && inviteSnapshot.inviteId) || "",
    inviteSnapshot,
    feedback,
    createdAt: boundedText(plan.createdAt, 40),
    updatedAt: boundedText(plan.updatedAt, 40),
    modifiedAt: boundedText(plan.modifiedAt, 40),
    lastModifiedAt: boundedText(plan.lastModifiedAt, 40),
    revision: normalizeRevision(plan.revision),
    version: normalizeRevision(plan.version),
    source: boundedText(plan.source, 48),
    temporaryDirectUse: plan.temporaryDirectUse === true,
    isImported: plan.isImported === true,
    isCollaborative: plan.isCollaborative === true,
  };
}

module.exports = {
  normalizePlan,
};
