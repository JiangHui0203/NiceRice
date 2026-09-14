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

function boundedText(value, maxLength = 160, fallback = "") {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const raw = String(value).slice(0, maxLength * 2).trim();
  const text = Array.from(raw).slice(0, maxLength).join("");
  return text || fallback;
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

function normalizeLocation(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const rawLatitude = boundedNumber(
    source.latitude !== undefined ? source.latitude : source.lat,
    -90,
    90,
  );
  const rawLongitude = boundedNumber(
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
    source: boundedText(source.source, 48),
    selectedAt: boundedText(source.selectedAt, 40),
    resolved: source.resolved === true ? true : (source.resolved === false ? false : null),
  };
}

function buildCouponLocation(form = {}) {
  const source = form.location && typeof form.location === "object" && !Array.isArray(form.location)
    ? form.location
    : {};
  const latitude = boundedNumber(
    form.latitude !== undefined
      ? form.latitude
      : (source.latitude !== undefined ? source.latitude : source.lat),
    -90,
    90,
  );
  const longitude = boundedNumber(
    form.longitude !== undefined
      ? form.longitude
      : (source.longitude !== undefined ? source.longitude : source.lng),
    -180,
    180,
  );
  const hasCoordinatePair = latitude !== null && longitude !== null;
  return normalizeLocation({
    name: boundedText(form.locationName || source.name || form.venue || form.merchantName, 96, "待补充店名"),
    address: boundedText(form.locationAddress || form.address || source.address, 500, "待补充地址"),
    latitude: hasCoordinatePair ? latitude : null,
    longitude: hasCoordinatePair ? longitude : null,
    source: boundedText(
      form.locationSource || source.source,
      48,
      hasCoordinatePair ? "wx.chooseLocation" : "manual",
    ),
    selectedAt: boundedText(form.locationSelectedAt || source.selectedAt, 40),
    resolved: source.resolved,
  });
}

function normalizeRoutePoint(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const location = normalizeLocation(source);
  const hasCoordinates = location.latitude !== null && location.longitude !== null;
  const hasAddress = Boolean(location.address);
  const role = ["gps", "work", "home", "friend", "custom"].includes(source.role) ? source.role : "";
  return Object.assign({}, location, {
    id: source.id ? normalizeExactId(source.id) : "",
    role,
    hasAddress,
    hasCoordinates,
    label: boundedText(
      source.label,
      160,
      `${location.name || location.address || "常用地点"} · ${hasCoordinates ? "已选地图点" : (hasAddress ? "待补地图点" : "暂无地址")}`,
    ),
  });
}

function normalizeRoute(value = {}, fallbackLocation = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const destinationCandidate = source.destination
    && typeof source.destination === "object"
    && !Array.isArray(source.destination)
    ? source.destination
    : null;
  const normalizedDestination = normalizeLocation(destinationCandidate || {});
  const destinationSource = destinationCandidate
    && (normalizedDestination.name
      || normalizedDestination.address
      || normalizedDestination.latitude !== null)
    ? destinationCandidate
    : fallbackLocation;
  return {
    source: boundedText(source.source, 48, "manual"),
    distanceText: boundedText(source.distanceText, 80, "待估算"),
    durationMinutes: boundedNumber(source.durationMinutes, 0, 1440),
    distanceMeters: boundedNumber(source.distanceMeters, 0, 50000000),
    transportType: ["transit", "walking", "driving", "cycling"].includes(source.transportType)
      ? source.transportType
      : "transit",
    origin: normalizeRoutePoint(source.origin),
    destination: normalizeRoutePoint(destinationSource),
  };
}

function buildNormalizedCouponRoute(coupon = {}, location = {}) {
  const source = coupon && typeof coupon === "object" && !Array.isArray(coupon) ? coupon : {};
  const rawRoute = source.route && typeof source.route === "object" && !Array.isArray(source.route)
    ? source.route
    : {};
  const sanitizedRoute = normalizeRoute(rawRoute, location);
  const sanitizedOrigin = rawRoute.origin && typeof rawRoute.origin === "object" && !Array.isArray(rawRoute.origin)
    ? sanitizedRoute.origin
    : undefined;
  return normalizeRoute(routeService.buildRoutePlaceholder({
    travelTime: boundedText(source.travelTime, 80),
    route: sanitizedRoute,
    location: normalizeLocation(location),
  }, sanitizedOrigin), location);
}

module.exports = {
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
};
