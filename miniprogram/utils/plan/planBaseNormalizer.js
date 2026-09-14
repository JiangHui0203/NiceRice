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

function boundedText(value, maxLength = 160) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return Array.from(String(value).slice(0, maxLength * 2).trim()).slice(0, maxLength).join("");
}

function normalizeExactId(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || text !== value || Array.from(text).length > 96
    || ["__proto__", "constructor", "prototype"].includes(text)) return "";
  return text;
}

function hasProvidedIdentity(value) {
  return value !== undefined && value !== null && value !== "";
}

function boundedNumber(value, minimum, maximum, fallback = null) {
  if (value === "" || value === null || value === undefined) return fallback;
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  if (typeof value === "string" && value.length > 64) return fallback;
  const number = Number(typeof value === "string" ? value.trim() : value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback;
}

function normalizeRevision(value) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && value.length > 64) return null;
  const number = Number(typeof value === "string" ? value.trim() : value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function normalizeBoundedCoordinate(value, minimum, maximum) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && value.length > 64) return null;
  const coordinate = normalizeCoordinate(value);
  return coordinate !== null && coordinate >= minimum && coordinate <= maximum ? coordinate : null;
}

function normalizeInviteId(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (text !== value || Array.from(text).length > 96) return "";
  return /^[A-Za-z0-9_-]{6,96}$/.test(text) ? text : "";
}

function boundedTextList(value, maxItems = 20, maxLength = 160) {
  const seen = new Set();
  return (Array.isArray(value) ? value.slice(0, maxItems * 2) : []).reduce((result, item) => {
    if (result.length >= maxItems) return result;
    const text = boundedText(item, maxLength);
    if (!text || seen.has(text)) return result;
    seen.add(text);
    result.push(text);
    return result;
  }, []);
}

function isTextValue(value) {
  return typeof value === "string" || typeof value === "number";
}

function normalizeExactDate(value) {
  const matched = boundedText(value, 32).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!matched) return "";
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeClock(value) {
  const matched = boundedText(value, 16).match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return "";
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeSelectedTime(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const date = normalizeExactDate(source.date);
  const startTime = normalizeClock(source.startTime);
  const normalizedEndTime = normalizeClock(source.endTime);
  const endTime = normalizedEndTime && normalizedEndTime !== startTime ? normalizedEndTime : "";
  const directWeekday = boundedText(source.weekday, 8).replace("星期", "周").replace("周天", "周日");
  const weekday = date
    ? WEEKDAYS[new Date(`${date}T00:00:00`).getDay()]
    : (WEEKDAYS.includes(directWeekday) ? directWeekday : "");
  return {
    date,
    label: boundedText(source.label, 64),
    weekday,
    startTime,
    endTime,
    scene: boundedText(source.scene, 32),
    range: startTime ? `${startTime}${endTime ? ` - ${endTime}` : ""}` : "",
  };
}

function normalizeParticipants(value) {
  const seen = new Set();
  const participants = (Array.isArray(value) ? value.slice(0, 50) : []).reduce((result, item, index) => {
    if (result.length >= 50 || !item || typeof item !== "object" || Array.isArray(item)) return result;
    const hasExplicitId = item.id !== undefined && item.id !== null && item.id !== "";
    const id = hasExplicitId ? normalizeExactId(item.id) : `participant_${index}`;
    const name = boundedText(item.name, 48);
    if (!id || !name || seen.has(id)) return result;
    seen.add(id);
    const rawStatus = boundedText(item.status, 24);
    const participantStatus = rawStatus === "accepted"
      ? "confirmed"
      : (rawStatus === "declined" ? "rejected" : rawStatus);
    result.push({
      id,
      name,
      status: PARTICIPANT_STATUSES.has(participantStatus) ? participantStatus : "pending",
      isSelf: item.isSelf === true || id === "self",
    });
    return result;
  }, []);
  return participants.length ? participants : [{ id: "self", name: "我", status: "confirmed", isSelf: true }];
}

function normalizeLocation(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const rawLatitude = normalizeBoundedCoordinate(
    source.latitude !== undefined ? source.latitude : source.lat,
    -90,
    90,
  );
  const rawLongitude = normalizeBoundedCoordinate(
    source.longitude !== undefined ? source.longitude : source.lng,
    -180,
    180,
  );
  const hasCoordinatePair = rawLatitude !== null && rawLongitude !== null;
  const latitude = hasCoordinatePair ? rawLatitude : null;
  const longitude = hasCoordinatePair ? rawLongitude : null;
  return {
    name: boundedText(source.name, 96),
    address: boundedText(source.address, 500),
    latitude,
    longitude,
    lat: latitude,
    lng: longitude,
    distanceText: boundedText(source.distanceText, 64),
    distanceMeters: boundedNumber(source.distanceMeters, 0, 100000000),
    durationMinutes: boundedNumber(source.durationMinutes, 0, 10080),
    source: boundedText(source.source, 48),
    selectedAt: boundedText(source.selectedAt, 40),
    resolved: source.resolved === true ? true : (source.resolved === false ? false : null),
  };
}

function normalizeRoutePoint(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const location = normalizeLocation(source);
  const hasCoordinatePair = location.latitude !== null && location.longitude !== null;
  const hasAddress = Boolean(location.address);
  const role = ["gps", "work", "home", "friend", "custom"].includes(source.role) ? source.role : "";
  return Object.assign({}, location, {
    id: source.id ? normalizeExactId(source.id) : "",
    role,
    hasAddress,
    hasCoordinates: hasCoordinatePair,
    label: boundedText(source.label, 160)
      || `${location.name || location.address || "常用地点"} · ${hasCoordinatePair ? "已选地图点" : (hasAddress ? "待补地图点" : "暂无地址")}`,
  });
}

function hasLocationValue(location = {}) {
  if (!location || typeof location !== "object" || Array.isArray(location)) return false;
  return Boolean(location.name || location.address || hasCoordinates(location));
}

function normalizeRoute(value = {}, location = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    source: boundedText(source.source, 48),
    distanceText: boundedText(source.distanceText, 64),
    distanceMeters: boundedNumber(source.distanceMeters, 0, 100000000),
    durationMinutes: boundedNumber(source.durationMinutes, 0, 10080),
    transportType: ["walking", "transit", "driving", "cycling", "bicycling"].includes(source.transportType)
      ? source.transportType
      : "",
    origin: normalizeRoutePoint(source.origin),
    destination: normalizeRoutePoint(source.destination && hasLocationValue(source.destination) ? source.destination : location),
  };
}

module.exports = {
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
};
