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

function normalizeUsageRules(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalizeDays = (days) => boundedTextList(days, 7, 8)
    .map((day) => DAY_ALIASES[day])
    .filter((day, index, list) => Boolean(day) && list.indexOf(day) === index);
  const ranges = (Array.isArray(source.availableTimeRanges) ? source.availableTimeRanges : [])
    .slice(0, 8)
    .map((range) => {
      if (!range || typeof range !== "object" || Array.isArray(range)) return null;
      const start = normalizeClock(range.start);
      const end = normalizeClock(range.end);
      return start && end && start !== end
        ? { start, end, label: boundedText(range.label || "可用时段", 32) }
        : null;
    })
    .filter(Boolean);
  const rawRefundType = boundedText(source.refundType, 32);
  return {
    availableDays: normalizeDays(source.availableDays),
    unavailableDays: normalizeDays(source.unavailableDays),
    availableTimeRanges: ranges,
    holidayAvailable: typeof source.holidayAvailable === "boolean" ? source.holidayAvailable : true,
    needReservation: source.needReservation === true,
    reservationLeadTimeHours: boundedNumber(source.reservationLeadTimeHours, 0, 720, 0),
    refundType: REFUND_TYPES.has(rawRefundType) ? rawRefundType : "unknown",
    storeLimit: boundedText(source.storeLimit, 500),
    notes: boundedText(source.notes, 1000),
  };
}

function mergeUsageRules(baseValue, overrideValue) {
  const base = normalizeUsageRules(baseValue);
  const override = overrideValue && typeof overrideValue === "object" && !Array.isArray(overrideValue)
    ? overrideValue
    : {};
  const overrideLeadTime = boundedNumber(override.reservationLeadTimeHours, 0, 720);
  const overrideRefundType = boundedText(override.refundType, 32);
  return normalizeUsageRules({
    availableDays: Array.isArray(override.availableDays) ? override.availableDays : base.availableDays,
    unavailableDays: Array.isArray(override.unavailableDays) ? override.unavailableDays : base.unavailableDays,
    availableTimeRanges: Array.isArray(override.availableTimeRanges)
      ? override.availableTimeRanges
      : base.availableTimeRanges,
    holidayAvailable: typeof override.holidayAvailable === "boolean"
      ? override.holidayAvailable
      : base.holidayAvailable,
    needReservation: typeof override.needReservation === "boolean" ? override.needReservation : base.needReservation,
    reservationLeadTimeHours: overrideLeadTime !== null ? overrideLeadTime : base.reservationLeadTimeHours,
    refundType: REFUND_TYPES.has(overrideRefundType) ? overrideRefundType : base.refundType,
    storeLimit: isTextValue(override.storeLimit) ? override.storeLimit : base.storeLimit,
    notes: isTextValue(override.notes) ? override.notes : base.notes,
  });
}

function normalizeRefundInfo(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const rawType = boundedText(source.refundType, 32);
  const refundType = source.non_refundable === true
    ? "non_refundable"
    : (REFUND_TYPES.has(rawType) ? rawType : "unknown");
  const normalizedLossAmount = boundedNumber(source.lossAmount, 0, 1000000000, 0);
  return {
    refundable: refundType === "unknown"
      ? (typeof source.refundable === "boolean" ? source.refundable : null)
      : (refundType === "auto" || refundType === "manual"),
    refundType,
    refundDeadline: normalizeExactDate(source.refundDeadline),
    lossAmount: ["auto", "manual"].includes(refundType) ? 0 : normalizedLossAmount,
    non_refundable: refundType === "non_refundable",
  };
}

function mergeRefundInfo(baseValue, overrideValue) {
  const base = normalizeRefundInfo(baseValue);
  const override = overrideValue && typeof overrideValue === "object" && !Array.isArray(overrideValue)
    ? overrideValue
    : {};
  const rawOverrideType = boundedText(override.refundType, 32);
  const hasOverrideType = REFUND_TYPES.has(rawOverrideType) || override.non_refundable === true;
  const normalizedOverrideDeadline = normalizeExactDate(override.refundDeadline);
  const overrideLossAmount = boundedNumber(override.lossAmount, 0, 1000000000);
  return normalizeRefundInfo({
    refundable: typeof override.refundable === "boolean" ? override.refundable : base.refundable,
    refundType: hasOverrideType ? rawOverrideType : base.refundType,
    refundDeadline: normalizedOverrideDeadline || base.refundDeadline,
    lossAmount: overrideLossAmount !== null ? overrideLossAmount : base.lossAmount,
    non_refundable: typeof override.non_refundable === "boolean"
      ? override.non_refundable
      : (hasOverrideType ? rawOverrideType === "non_refundable" : base.non_refundable),
  });
}

module.exports = {
  normalizeUsageRules,
  mergeUsageRules,
  normalizeRefundInfo,
  mergeRefundInfo,
};
