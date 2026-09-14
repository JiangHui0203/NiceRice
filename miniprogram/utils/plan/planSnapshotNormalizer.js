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

function normalizeWeatherView(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    icon: boundedText(value.icon, 8),
    condition: boundedText(value.condition, 48),
    temperature: boundedText(value.temperature, 24),
    summary: boundedText(value.summary, 200),
    weatherRisk: value.weatherRisk === true,
    riskText: boundedText(value.riskText, 160),
    tips: boundedTextList(value.tips, 8, 80),
    source: boundedText(value.source, 32),
  };
}

function normalizeRecommendationSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const score = boundedNumber(value.score, 0, 100);
  const rawLevel = boundedText(value.level, 32);
  const level = RECOMMENDATION_LEVELS.has(rawLevel) ? rawLevel : "unknown";
  const rawScoreBreakdown = value.scoreBreakdown
    && typeof value.scoreBreakdown === "object"
    && !Array.isArray(value.scoreBreakdown)
    ? value.scoreBreakdown
    : {};
  const scoreBreakdown = {};
  SCORE_BREAKDOWN_KEYS.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(rawScoreBreakdown, key)) return;
    const scoreValue = boundedNumber(rawScoreBreakdown[key], -100, 100);
    if (scoreValue !== null) scoreBreakdown[key] = scoreValue;
  });
  return {
    score,
    level,
    category: boundedText(value.category, 32),
    reasons: boundedTextList(value.reasons, 8, 200),
    warnings: boundedTextList(value.warnings, 8, 200),
    blockers: boundedTextList(value.blockers, 8, 200),
    reasonItems: (Array.isArray(value.reasonItems) ? value.reasonItems : []).slice(0, 8).map((item) => ({
      label: boundedText(item && item.label, 32),
      desc: boundedText(item && item.desc, 200),
      type: boundedText(item && item.type, 24),
    })).filter((item) => item.label || item.desc),
    scoreBreakdown,
    weatherView: normalizeWeatherView(value.weatherView),
  };
}

function normalizeLiveRisk(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const messages = (Array.isArray(source.messages) ? source.messages : []).slice(0, 20).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const rawLevel = boundedText(item.level, 24);
    return {
      type: boundedText(item.type, 48),
      level: RISK_LEVELS.has(rawLevel) && rawLevel !== "none" ? rawLevel : "medium",
      text: boundedText(item.text, 240),
    };
  }).filter((item) => item && item.text);
  const hasRisk = source.hasRisk !== false && messages.length > 0;
  const rawLevel = boundedText(source.level, 24);
  return {
    hasRisk,
    level: hasRisk ? (RISK_LEVELS.has(rawLevel) && rawLevel !== "none" ? rawLevel : "medium") : "none",
    messages,
  };
}

function normalizeChangeLogs(value) {
  return (Array.isArray(value) ? value : []).slice(-100).map((item) => ({
    type: boundedText(item && item.type, 48),
    text: boundedText(item && item.text, 300),
    createdAt: boundedText(item && item.createdAt, 40),
    updatedAt: boundedText(item && item.updatedAt, 40),
  })).filter((item) => item.text);
}

function normalizeFeedback(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rating = boundedNumber(value.rating, 1, 5);
  if (rating === null || !Number.isInteger(rating)) return null;
  return {
    rating,
    tags: boundedTextList(value.tags, 20, 48),
    comment: boundedText(value.comment, 500),
    createdAt: boundedText(value.createdAt, 40),
  };
}

function normalizeInviteSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const inviteId = normalizeInviteId(value.inviteId || value.id);
  if (!inviteId) return null;
  const hasPlanId = hasProvidedIdentity(value.planId);
  const hasCouponId = hasProvidedIdentity(value.couponId);
  const planId = hasPlanId ? normalizeExactId(value.planId) : "";
  const couponId = hasCouponId ? normalizeExactId(value.couponId) : "";
  if ((hasPlanId && !planId) || (hasCouponId && !couponId)) return null;
  const rawProposal = value.proposal && typeof value.proposal === "object" && !Array.isArray(value.proposal)
    ? value.proposal
    : null;
  const proposalTime = rawProposal ? normalizeSelectedTime(rawProposal.selectedTime) : null;
  const proposal = rawProposal && proposalTime.date && proposalTime.startTime
    ? { selectedTime: proposalTime, createdAt: boundedText(rawProposal.createdAt, 40) }
    : null;
  return {
    id: inviteId,
    inviteId,
    planId,
    couponId,
    title: boundedText(value.title, 120),
    friendName: boundedText(value.friendName, 48),
    status: ["pending", "confirmed", "rejected", "invalid"].includes(value.status) ? value.status : "pending",
    message: boundedText(value.message, 160),
    sharePath: boundedText(value.sharePath, 1024),
    syncStatus: value.syncStatus === "cloud" ? "cloud" : "local",
    statusSyncStatus: value.statusSyncStatus === "cloud" ? "cloud" : "local",
    proposalSyncStatus: value.proposalSyncStatus === "cloud" ? "cloud" : "local",
    planUpdatedAt: boundedText(value.planUpdatedAt, 40),
    createdAt: boundedText(value.createdAt, 40),
    updatedAt: boundedText(value.updatedAt, 40),
    proposal,
    invalid: value.invalid === true,
  };
}

module.exports = {
  normalizeWeatherView,
  normalizeRecommendationSnapshot,
  normalizeLiveRisk,
  normalizeChangeLogs,
  normalizeFeedback,
  normalizeInviteSnapshot,
};
