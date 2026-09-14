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

function normalizePeopleCount(people) {
  const str = boundedText(people, 32);
  const matched = str.match(/\d+/);
  if (matched) return boundedNumber(matched[0], 1, 100);
  return str.includes("多人") ? 4 : null;
}

function sanitizeAvailableTimeRanges(ranges = []) {
  if (!Array.isArray(ranges)) return [];
  return ranges.slice(0, 8).map((range) => {
    if (!range || typeof range !== "object" || Array.isArray(range)) return null;
    const start = normalizeClockText(range.start);
    const end = normalizeClockText(range.end);
    if (!start || !end || start === end) return null;
    return {
      start,
      end,
      label: boundedText(range.label, 32, "可用时段"),
    };
  }).filter(Boolean);
}

function buildUsageRules(form = {}, reservationRequired = false) {
  form = form && typeof form === "object" && !Array.isArray(form) ? form : {};
  const usableTimeText = boundedText(form.usableTime, 160);
  const usable = parseTimeRange(usableTimeText);
  const incoming = form.usageRules && typeof form.usageRules === "object" && !Array.isArray(form.usageRules)
    ? form.usageRules
    : {};
  const notes = boundedText(isTextValue(incoming.notes) ? incoming.notes : (form.ruleNotes || form.note || ""), 1000);
  const dayRules = parseDayRules(`${usableTimeText} ${notes}`);

  const incomingRefundType = boundedText(incoming.refundType, 32);
  const formRefundType = boundedText(form.refundType, 32);
  let refundType = REFUND_TYPES.has(incomingRefundType) ? incomingRefundType : formRefundType;
  if (incoming.non_refundable === true) refundType = "non_refundable";
  if (!refundType) {
    refundType = /不可退|过期不退/.test(notes) ? "non_refundable" : (/自动退/.test(notes) ? "auto" : "unknown");
  }
  if (!REFUND_TYPES.has(refundType)) refundType = "unknown";

  const availableTimeRanges = usable.startTime ? [{
    start: usable.startTime,
    end: usable.endTime,
    label: usable.type === "dinner" ? "晚市" : (usable.type === "lunch" ? "午市" : "可用时段"),
  }] : [];

  const rangeSource = Array.isArray(incoming.availableTimeRanges)
    ? incoming.availableTimeRanges
    : availableTimeRanges;
  const incomingLeadTime = boundedNumber(incoming.reservationLeadTimeHours, 0, 720);
  const formLeadTime = boundedNumber(form.reservationLeadTimeHours, 0, 720);
  return {
    // Keep legacy Chinese weekday labels importable, while bounding the list.
    availableDays: boundedTextList(
      Array.isArray(incoming.availableDays)
        ? incoming.availableDays
        : (Array.isArray(form.availableDays) ? form.availableDays : dayRules.availableDays),
      7,
      8,
    ),
    unavailableDays: boundedTextList(
      Array.isArray(incoming.unavailableDays)
        ? incoming.unavailableDays
        : (Array.isArray(form.unavailableDays) ? form.unavailableDays : dayRules.unavailableDays),
      7,
      8,
    ),
    availableTimeRanges: sanitizeAvailableTimeRanges(rangeSource),
    holidayAvailable: typeof incoming.holidayAvailable === "boolean"
      ? incoming.holidayAvailable
      : dayRules.holidayAvailable,
    needReservation: reservationRequired,
    reservationLeadTimeHours: incomingLeadTime !== null
      ? incomingLeadTime
      : (formLeadTime !== null ? formLeadTime : (reservationRequired ? 12 : 0)),
    refundType,
    storeLimit: boundedText(
      isTextValue(incoming.storeLimit)
        ? incoming.storeLimit
        : (form.storeLimit || (notes.match(/仅限([^，。；\n]+)/) || [])[1] || ""),
      500,
    ),
    notes,
  };
}

function buildRefundInfo(form = {}) {
  form = form && typeof form === "object" && !Array.isArray(form) ? form : {};
  const incoming = form.refundInfo && typeof form.refundInfo === "object" && !Array.isArray(form.refundInfo)
    ? form.refundInfo
    : {};
  const notes = boundedText(form.ruleNotes || form.note || "", 1000);
  const incomingRefundType = boundedText(incoming.refundType, 32);
  const formRefundType = boundedText(form.refundType, 32);
  let refundType = REFUND_TYPES.has(incomingRefundType) ? incomingRefundType : formRefundType;
  if (incoming.non_refundable === true) refundType = "non_refundable";

  if (!refundType || refundType === "unknown") {
    const matchedRule = REFUND_TYPE_RULES.find((r) => r.pattern.test(notes));
    refundType = matchedRule ? matchedRule.type : "unknown";
  }
  if (!REFUND_TYPES.has(refundType)) refundType = "unknown";

  const isLoss = refundType === "non_refundable" || refundType === "partial";
  const incomingLossAmount = boundedNumber(incoming.lossAmount, 0, 1000000000);
  const formLossAmount = boundedNumber(form.lossAmount, 0, 1000000000);
  const price = boundedNumber(form.price, 0, 1000000000, 0);
  const normalizedLossAmount = incomingLossAmount !== null
    ? incomingLossAmount
    : (formLossAmount !== null ? formLossAmount : price);
  const lossAmount = isLoss || refundType === "unknown" ? normalizedLossAmount : 0;
  const refundDeadline = normalizeDateText(incoming.refundDeadline)
    || normalizeDateText(form.refundDeadline)
    || normalizeDateText(form.expireDate);

  return {
    refundable: refundType === "unknown"
      ? (typeof incoming.refundable === "boolean" ? incoming.refundable : null)
      : (refundType === "auto" || refundType === "manual"),
    refundType,
    refundDeadline,
    lossAmount,
    // Backward-compatible derived flag used by old imported snapshots.
    non_refundable: incoming.non_refundable === true || refundType === "non_refundable",
  };
}

module.exports = {
  normalizePeopleCount,
  sanitizeAvailableTimeRanges,
  buildUsageRules,
  buildRefundInfo,
};
