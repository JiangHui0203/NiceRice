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
const {
  normalizePlan,
} = require("./planModelNormalizer.js");

function createPlanFromRecommendation(coupon = {}, rec = {}, participants = [], options = {}) {
  coupon = coupon && typeof coupon === "object" && !Array.isArray(coupon) ? coupon : {};
  rec = rec && typeof rec === "object" && !Array.isArray(rec) ? rec : {};
  participants = Array.isArray(participants) ? participants : [];
  options = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const selectedTime = options.selectedTime || (rec && rec.selectedTime) || {
    date: rec.date || "",
    weekday: rec.weekday || "",
    startTime: rec.startTime || "",
    endTime: rec.endTime || "",
    scene: rec.scene || "",
    label: [rec.weekday, rec.startTime].filter(Boolean).join(" ") || "时间待定",
  };

  const hasScheduledTime = parsePlanStart({ selectedTime }) !== Number.MAX_SAFE_INTEGER;
  const requestedStatus = options.statusCode || "";
  const statusCode = hasScheduledTime
    ? (requestedStatus || "confirmed")
    : "draft";
  const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const reservation = resolveReservation({}, coupon);
  const needReservation = reservation.needReservation;
  const location = coupon.location || buildLocationFromCoupon(coupon);

  const initialParticipants = participants && participants.length
    ? participants
    : [{ id: "self", name: "我", status: "confirmed" }];

  return normalizePlan({
    id: planId,
    couponId: coupon.id,
    title: coupon.title,
    category: coupon.category || "food",
    venue: coupon.venue,
    address: coupon.address,
    location,
    travelTime: coupon.travelTime,
    route: coupon.route,
    durationMinutes: coupon.durationMinutes,
    price: coupon.price,
    originalPrice: coupon.originalPrice,
    platform: coupon.platform,
    type: coupon.type,
    dishes: coupon.dishes,
    cleanup: coupon.cleanup,
    tags: coupon.tags || [],
    needReservation,
    reservationStatus: needReservation === true ? "pending" : (needReservation === false ? "not_required" : "unknown"),
    usageRules: coupon.usageRules || {},
    refundInfo: coupon.refundInfo || {},
    selectedTime,
    participants: initialParticipants,
    withText: initialParticipants.map((p) => p.name).join("、"),
    note: coupon.note || "",
    statusCode,
    recommendationSnapshot: {
      score: rec.score,
      level: rec.level,
      category: coupon.category,
      reasons: rec.reasons || [],
      warnings: rec.warnings || [],
      blockers: rec.blockers || [],
      reasonItems: rec.reasonItems || [],
      scoreBreakdown: rec.scoreBreakdown,
      weatherView: rec.weatherView,
    },
    reminders: [coupon.cleanup]
      .concat(Array.isArray(coupon.notices) ? coupon.notices : [])
      .concat(Array.isArray(rec.warnings) ? rec.warnings : [])
      .filter(Boolean),
    changeLogs: [{
      type: "created",
      text: statusCode === "pending"
        ? "计划已创建，等待同行人确认。"
        : (statusCode === "draft" ? "计划草稿已创建，时间待补充。" : "计划已确认加入日程。"),
      createdAt: nowText(),
    }],
  });
}

module.exports = {
  createPlanFromRecommendation,
};
