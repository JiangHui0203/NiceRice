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

function parseExactDateParts(dateText) {
  const matched = boundedText(dateText, 32).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const exactDate = new Date(year, month - 1, day);
  if (exactDate.getFullYear() !== year
    || exactDate.getMonth() !== month - 1
    || exactDate.getDate() !== day) return null;
  return {
    year,
    month,
    day,
    text: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function normalizeDateText(dateText) {
  const parts = parseExactDateParts(dateText);
  return parts ? parts.text : "";
}

function getExactDateTimestamp(dateText, endOfDay = false) {
  const parts = parseExactDateParts(dateText);
  if (!parts) return null;
  return new Date(
    parts.year,
    parts.month - 1,
    parts.day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  ).getTime();
}

function daysBetween(dateText) {
  const parts = parseExactDateParts(dateText);
  if (!parts) return null;
  const now = new Date();
  const targetDay = Date.UTC(parts.year, parts.month - 1, parts.day);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((targetDay - today) / (24 * 60 * 60 * 1000));
}

function expireText(dateText) {
  const days = daysBetween(dateText);
  if (days === null) return "有效期待补充";
  if (days < 0) return "已过期";
  if (days === 0) return "今天过期";
  if (days === 1) return "明天过期";
  return `${days}天后过期`;
}

function formatUsedAt(value) {
  const raw = boundedText(value, 80);
  if (!raw) return "";
  const pad = (number) => String(number).padStart(2, "0");
  const dateOnlyMatched = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatched) {
    const normalizedDate = normalizeDateText(raw);
    return normalizedDate === raw ? normalizedDate : "";
  }

  const zonedMatched = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))$/
  );
  if (zonedMatched) {
    const normalizedDate = normalizeDateText(`${zonedMatched[1]}-${zonedMatched[2]}-${zonedMatched[3]}`);
    const hour = Number(zonedMatched[4]);
    const minute = Number(zonedMatched[5]);
    const second = Number(zonedMatched[6] || 0);
    const offsetHour = zonedMatched[8] === undefined ? 0 : Number(zonedMatched[8]);
    const offsetMinute = zonedMatched[9] === undefined ? 0 : Number(zonedMatched[9]);
    if (!normalizedDate || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
      return "";
    }
    const timestamp = Date.parse(raw);
    if (!Number.isFinite(timestamp)) return "";
    const parsed = new Date(timestamp);
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
  }

  const localMatched = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/
  );
  if (!localMatched) return "";
  const normalizedDate = normalizeDateText(`${localMatched[1]}-${localMatched[2]}-${localMatched[3]}`);
  const hour = Number(localMatched[4]);
  const minute = Number(localMatched[5]);
  const second = Number(localMatched[6] || 0);
  if (!normalizedDate || hour > 23 || minute > 59 || second > 59) return "";
  return `${normalizedDate} ${pad(hour)}:${pad(minute)}`;
}

function normalizeStatus(status) {
  return STATUS_ALIAS_MAP[boundedText(status, 32)] || "pending";
}

function normalizeClockText(value) {
  const matched = boundedText(value, 32).replace(/\s/g, "").match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return "";
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function validateUsableTimeText(text) {
  const raw = boundedText(text, 500).replace(/：/g, ":");
  if (!raw) return true;

  // Match the complete numeric clock token instead of a valid-looking suffix.
  // For example, `123:00` must not be accepted as `23:00`.
  if (/\d+\s*:\s*\d*\s*:\s*\d*/.test(raw)) return false;
  const clockCandidates = raw.match(/\d+\s*:\s*\d*/g) || [];
  if (clockCandidates.some((clock) => !normalizeClockText(clock))) return false;
  if (clockCandidates.length && (/[-~～—–至到]\s*$/.test(raw) || /^\s*[-~～—–至到]/.test(raw))) return false;

  const rangeMatched = raw.match(/(\d+\s*:\s*\d*)\s*[-至到~～—–]\s*(\d+\s*:\s*\d*)/);
  if (!rangeMatched) return true;
  const startTime = normalizeClockText(rangeMatched[1]);
  const endTime = normalizeClockText(rangeMatched[2]);
  return Boolean(startTime && endTime && startTime !== endTime);
}

function parseTimeRange(text) {
  const originalText = boundedText(text, 160);
  const raw = originalText.replace(/：/g, ":");
  const isValid = validateUsableTimeText(raw);
  const matched = isValid
    ? raw.match(/(\d{1,2}\s*:\s*\d{2})\s*[-至到~～—–]\s*(\d{1,2}\s*:\s*\d{2})/)
    : null;
  const startTime = matched ? normalizeClockText(matched[1]) : "";
  const endTime = matched ? normalizeClockText(matched[2]) : "";

  if (!matched && isValid) {
    if (/午市|午餐|中午/.test(raw)) {
      return { type: "lunch", text: originalText || "午市", startTime: "11:00", endTime: "14:00" };
    }
    if (/晚市|晚餐|晚上/.test(raw)) {
      return { type: "dinner", text: originalText || "晚市", startTime: "17:00", endTime: "22:00" };
    }
  }

  const startHour = startTime ? Number(startTime.split(":")[0]) : null;
  const isLunch = startHour !== null && startHour >= 11 && startHour <= 13;
  const isDinner = startHour !== null && startHour >= 17 && startHour <= 22;

  return {
    type: isLunch ? "lunch" : (isDinner ? "dinner" : "custom"),
    text: originalText || "待补充",
    startTime,
    endTime,
  };
}

function getDefaultDuration(type) {
  return DEFAULT_DURATIONS[type] || 120;
}

function expandDayRange(startLabel, endLabel) {
  const start = DAY_MAP[startLabel];
  const end = DAY_MAP[endLabel];
  const startIndex = DAY_ORDER.indexOf(start);
  const endIndex = DAY_ORDER.indexOf(end);
  if (startIndex === -1 || endIndex === -1) return [];
  if (startIndex <= endIndex) return DAY_ORDER.slice(startIndex, endIndex + 1);
  return DAY_ORDER.slice(startIndex).concat(DAY_ORDER.slice(0, endIndex + 1));
}

function parseDayRules(text) {
  const notes = boundedText(text, 2000);
  const result = {
    availableDays: [],
    unavailableDays: [],
    holidayAvailable: !/节假日不可用|法定节假日不可用/.test(notes),
  };

  const matchedDay = DAY_MATCHERS.find((m) => m.pattern.test(notes));
  if (matchedDay) result.availableDays = matchedDay.days;

  const rangeMatched = notes.match(/周([一二三四五六日天])\s*[至到-]\s*周?([一二三四五六日天])/);
  if (rangeMatched) {
    result.availableDays = expandDayRange(rangeMatched[1], rangeMatched[2]);
  }

  UNAVAILABLE_DAY_MATCHERS.forEach((m) => {
    if (m.pattern.test(notes)) result.unavailableDays.push(...m.days);
  });

  return result;
}

module.exports = {
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
};
