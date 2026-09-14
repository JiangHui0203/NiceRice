const {
  cloud,
  https,
  db,
  INVITE_TTL_MS,
  INVITE_RECORD_ACTIVE,
  INVITE_RECORD_REVOKED,
  MAX_PROVIDER_RESPONSE_BYTES,
  MAX_OCR_TEXT_LENGTH,
  MAX_EVENT_DATA_BYTES,
  INVITE_STATUSES,
  SHAREABLE_PLAN_STATUSES,
  RESERVATION_STATUSES,
  rateLimitBuckets,
  serviceErrors,
  ACTION_DATA_FIELDS,
  ROUTE_MODES,
  normalizeRouteMode,
  createError,
  isRecord,
  mergeRecords,
  normalizeEvent,
  boundedText,
} = require("./serviceContext.js");
const {
  toNumber,
  normalizePoint,
  buildQuery,
  requestJson,
  durationToMinutes,
  formatDistance,
  formatRouteText,
  getProviderKey,
  getTencentKey,
  getAmapKey,
  normalizeRouteText,
} = require("./providerHttp.js");
const {
  isAllowedOcrFileId,
  enforceRateLimit,
  enforceEventRateLimit,
} = require("./serviceSecurity.js");

function buildReverseGeocodeLocation(result = {}) {
  const formatted = result.formatted_addresses || {};
  const component = result.address_component || {};
  const pois = Array.isArray(result.pois) ? result.pois : [];
  const nearestPoi = pois[0] || {};
  const address = boundedText(
    result.address
      || nearestPoi.address
      || formatted.recommend
      || formatted.rough
      || "",
    256,
  );
  const name = boundedText(
    nearestPoi.title
      || formatted.recommend
      || formatted.rough
      || (component.district ? `${component.district}${component.street || ""}` : "")
      || address,
    96,
  );
  if (!name && !address) return null;
  return {
    name: name || "当前位置",
    address: address || name,
    city: boundedText(component.city, 64),
    district: boundedText(component.district, 64),
    street: boundedText(component.street, 64),
    source: "tencent_geocoder",
    resolved: true,
  };
}

async function reverseGeocodeTencent(data = {}) {
  const key = getTencentKey();
  if (!key) throw createError("missing_key", "云函数缺少 TENCENT_MAP_KEY 或 QQ_MAP_KEY");
  const point = normalizePoint(data);
  const query = buildQuery({
    location: `${point.latitude},${point.longitude}`,
    key,
    get_poi: 1,
    output: "json",
  });
  const json = await requestJson(`https://apis.map.qq.com/ws/geocoder/v1/?${query}`);
  if (json.status !== 0 || !json.result) {
    throw createError("provider_error", "腾讯位置服务逆地理编码失败");
  }
  const location = buildReverseGeocodeLocation(json.result);
  if (!location) throw createError("empty_location", "腾讯位置服务没有返回附近地点");
  return location;
}

async function estimateTencentRoute(data = {}) {
  const key = getTencentKey();
  if (!key) {
    throw createError("missing_key", "云函数缺少 TENCENT_MAP_KEY 或 QQ_MAP_KEY");
  }
  const from = normalizePoint(data.from);
  const to = normalizePoint(data.to);
  const mode = normalizeRouteMode(data.mode, "transit");
  const query = buildQuery({
    from: `${from.latitude},${from.longitude}`,
    to: `${to.latitude},${to.longitude}`,
    key,
    output: "json",
  });
  const json = await requestJson(`https://apis.map.qq.com/ws/direction/v1/${mode}/?${query}`);
  if (json.status !== 0) {
    throw createError("provider_error", "腾讯位置服务路线估算失败");
  }
  const route = json.result && json.result.routes && json.result.routes[0];
  if (!route) {
    throw createError("empty_route", "腾讯位置服务没有返回可用路线");
  }
  const durationMinutes = durationToMinutes(route.duration, "minutes");
  const distanceMeters = toNumber(route.distance);
  if (durationMinutes === null || distanceMeters === null || distanceMeters < 0 || distanceMeters > 50000000) {
    throw createError("invalid_response", "腾讯位置服务路线字段不完整");
  }
  return {
    source: "tencent",
    provider: "tencent",
    mode,
    distanceText: formatRouteText(durationMinutes, distanceMeters),
    durationMinutes,
    distanceMeters,
    transportType: mode,
  };
}

function getAmapRouteUrl(mode, data, from, to, key) {
  const origin = `${from.longitude},${from.latitude}`;
  const destination = `${to.longitude},${to.latitude}`;
  if (mode === "walking") {
    return `https://restapi.amap.com/v3/direction/walking?${buildQuery({ origin, destination, key })}`;
  }
  if (mode === "transit") {
    return `https://restapi.amap.com/v3/direction/transit/integrated?${buildQuery({
      origin,
      destination,
      city: normalizeRouteText(data.city, 64, "出发城市"),
      cityd: normalizeRouteText(data.destinationCity, 64, "到达城市"),
      key,
    })}`;
  }
  return `https://restapi.amap.com/v3/direction/driving?${buildQuery({ origin, destination, key })}`;
}

async function estimateAmapRoute(data = {}) {
  const key = getAmapKey();
  if (!key) {
    throw createError("missing_key", "云函数缺少 AMAP_MAP_KEY 或 GAODE_MAP_KEY");
  }
  const from = normalizePoint(data.from);
  const to = normalizePoint(data.to);
  const mode = normalizeRouteMode(data.mode, "transit");
  const json = await requestJson(getAmapRouteUrl(mode, data, from, to, key));
  if (json.status !== "1") {
    throw createError("provider_error", "高德地图路线估算失败");
  }
  const route = json.route || {};
  const item = mode === "transit"
    ? route.transits && route.transits[0]
    : route.paths && route.paths[0];
  if (!item) {
    throw createError("empty_route", "高德地图没有返回可用路线");
  }
  const durationMinutes = durationToMinutes(item.duration, "seconds");
  const distanceMeters = toNumber(item.distance);
  if (durationMinutes === null || distanceMeters === null || distanceMeters < 0 || distanceMeters > 50000000) {
    throw createError("invalid_response", "高德地图路线字段不完整");
  }
  return {
    source: "amap",
    provider: "amap",
    mode,
    distanceText: formatRouteText(durationMinutes, distanceMeters),
    durationMinutes,
    distanceMeters,
    transportType: mode,
  };
}

async function estimateRoute(event = {}) {
  const provider = boundedText(event.provider || process.env.MAP_PROVIDER || "tencent", 24).toLowerCase();
  if (provider === "amap" || provider === "gaode") {
    return await estimateAmapRoute(event.data || {});
  }
  if (provider === "tencent") return await estimateTencentRoute(event.data || {});
  throw createError("invalid_provider", "地图服务提供方无效");
}

module.exports = {
  buildReverseGeocodeLocation,
  reverseGeocodeTencent,
  estimateTencentRoute,
  getAmapRouteUrl,
  estimateAmapRoute,
  estimateRoute,
};
