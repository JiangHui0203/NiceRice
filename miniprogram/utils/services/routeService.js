/**
 * routeService.js
 * 路线与距离测算服务
 * 直接基于起点（GPS 实时定位 / 常用地点）与终点（店铺坐标）进行地图级距离与耗时测算
 * 集成腾讯位置服务 WebService 距离矩阵 API 与本地高性能测算引擎
 */

const { hasCoordinates, normalizeCoordinate } = require("../locationUtils.js");
const mapDistanceService = require("./mapDistanceService.js");
const privacyService = require("../privacyService.js");
const { normalizeExactId } = require("../idUtils.js");
const TRAVEL_MODES = ["transit", "walking", "driving", "cycling"];
const TRAVEL_MODE_LABELS = {
  transit: "公共交通",
  walking: "步行",
  driving: "驾车",
  cycling: "骑行",
};

function normalizeTravelMode(mode) {
  return TRAVEL_MODES.includes(mode) ? mode : "transit";
}

function clipText(value, maxLength) {
  return String(value === undefined || value === null ? "" : value)
    .slice(0, maxLength * 2)
    .trim()
    .slice(0, maxLength);
}

function normalizeNonNegativeNumber(value, max) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(number, max) : null;
}

function parseMinutes(text) {
  const matched = String(text || "").match(/\d+/);
  if (!matched) return null;
  const minutes = Number(matched[0]);
  return Number.isFinite(minutes) && minutes > 0 && minutes <= 1440 ? minutes : null;
}

function isCrossRegionDistance(distanceMeters) {
  return mapDistanceService.isCrossRegionDistance(distanceMeters);
}

function normalizePoint(point = {}) {
  const latitude = normalizeCoordinate(point.latitude !== undefined ? point.latitude : point.lat);
  const longitude = normalizeCoordinate(point.longitude !== undefined ? point.longitude : point.lng);
  if (!hasCoordinates({ latitude, longitude })) return null;
  return { latitude, longitude, lat: latitude, lng: longitude };
}

function normalizeRouteOrigin(origin = {}) {
  const source = origin && typeof origin === "object" && !Array.isArray(origin) ? origin : {};
  const point = normalizePoint(source);
  const name = clipText(source.name, 96);
  const address = clipText(source.address, 200);
  const inferredRole = source.role || (source.id === "loc_gps" || source.source === "wx.getLocation" ? "gps" : "");
  const role = ["gps", "work", "home", "friend", "custom"].includes(inferredRole) ? inferredRole : "";
  const hasAddress = Boolean(address);
  const hasCoordinates = Boolean(point);
  const resolved = source.resolved === true ? true : source.resolved === false ? false : null;
  return {
    id: source.id === undefined || source.id === null || source.id === ""
      ? ""
      : normalizeExactId(source.id),
    role,
    name,
    address,
    latitude: point ? point.latitude : null,
    longitude: point ? point.longitude : null,
    lat: point ? point.latitude : null,
    lng: point ? point.longitude : null,
    source: clipText(source.source, 40),
    selectedAt: clipText(source.selectedAt, 40),
    resolved,
    hasAddress,
    hasCoordinates,
    label: formatOriginLabel({ name, address, hasAddress, hasCoordinates }),
  };
}

const ACTIVE_ORIGIN_STORAGE_KEY = "life_helper_active_origin";

function formatOriginLabel(origin = {}) {
  const name = origin.name || origin.address || "常用地点";
  if (origin.hasCoordinates) return `${name} · 已选地图点`;
  if (origin.hasAddress) return `${name} · 待补地图点`;
  return `${name} · 暂无地址`;
}

function getDefaultRouteOrigin() {
  return normalizeRouteOrigin({
    id: "loc_gps",
    role: "gps",
    name: "当前起点",
    address: "请用微信地图选择位置",
    source: "wx.chooseLocation",
  });
}

function getActiveRouteOrigin() {
  const app = typeof getApp === "function" ? getApp() : null;
  if (app && app.globalData && app.globalData.activeRouteOrigin) {
    return normalizeRouteOrigin(app.globalData.activeRouteOrigin);
  }
  try {
    const stored = privacyService.readLocalData(ACTIVE_ORIGIN_STORAGE_KEY, null);
    if (stored && typeof stored === "object") {
      const normalized = normalizeRouteOrigin(stored);
      if (normalized.name || normalized.address || normalized.role || normalized.hasCoordinates) {
        if (app && app.globalData) {
          app.globalData.activeRouteOrigin = normalized;
        }
        return normalized;
      }
    }
  } catch (e) {}
  return getDefaultRouteOrigin();
}

function saveActiveRouteOrigin(origin = {}) {
  if (origin && origin.id !== undefined && origin.id !== null && origin.id !== ""
    && !normalizeExactId(origin.id)) return null;
  const normalized = normalizeRouteOrigin(origin);
  const app = typeof getApp === "function" ? getApp() : null;
  // Coordinates are sensitive personal data. Persist them through the same
  // encrypted storage boundary as locations and plans, then expose the value
  // in memory only after the durable write succeeds.
  if (!privacyService.writeLocalData(ACTIVE_ORIGIN_STORAGE_KEY, normalized)) return null;
  if (app && app.globalData) {
    app.globalData.activeRouteOrigin = normalized;
  }
  return normalized;
}

function buildRouteOriginView(origin = getDefaultRouteOrigin()) {
  const normalized = normalizeRouteOrigin(origin);
  return {
    name: normalized.name || "常用地点",
    label: normalized.label,
    hasCoordinates: normalized.hasCoordinates,
    desc: normalized.hasCoordinates
      ? "估算会优先使用这个常用起点。"
      : "请先用微信地图选择起点。",
  };
}

function hasStoredCoordinates(location = {}) {
  return Boolean(normalizePoint(location));
}

function buildRoutePlaceholder(coupon = {}, origin = getDefaultRouteOrigin()) {
  const destLocation = (coupon && coupon.location)
    || (coupon && coupon.latitude !== undefined && coupon.longitude !== undefined ? {
      name: coupon.venue, address: coupon.address, latitude: coupon.latitude, longitude: coupon.longitude
    } : null)
    || (coupon && coupon.route && coupon.route.destination)
    || {};
  const hasLocation = hasStoredCoordinates(destLocation);
  const source = clipText(coupon && coupon.route && coupon.route.source, 40)
    || (hasLocation ? "coordinates_available" : "manual");
  const normOrigin = normalizeRouteOrigin(origin);
  const normDest = normalizeRouteOrigin(destLocation);
  const distanceText = clipText(
    (coupon && coupon.travelTime) || (coupon && coupon.route && coupon.route.distanceText),
    80,
  ) || "待估算";
  const distanceMeters = normalizeNonNegativeNumber(coupon && coupon.route && coupon.route.distanceMeters, 50000000);
  const isCrossRegion = Boolean(coupon && coupon.route && coupon.route.isCrossRegion)
    || isCrossRegionDistance(distanceMeters);
  return {
    source,
    distanceText: isCrossRegion ? "异地商户" : distanceText,
    durationMinutes: isCrossRegion
      ? null
      : normalizeNonNegativeNumber(coupon && coupon.route && coupon.route.durationMinutes, 1440),
    distanceMeters,
    transportType: normalizeTravelMode(coupon && coupon.route && coupon.route.transportType),
    origin: normOrigin,
    destination: normDest,
    isCrossRegion,
  };
}

function normalizeRoute(route = {}, fallbackText = "") {
  const source = route && typeof route === "object" && !Array.isArray(route) ? route : {};
  const distanceMeters = normalizeNonNegativeNumber(source.distanceMeters, 50000000);
  const isCrossRegion = Boolean(source.isCrossRegion) || isCrossRegionDistance(distanceMeters);
  const durationMinutes = isCrossRegion
    ? null
    : (normalizeNonNegativeNumber(source.durationMinutes, 1440)
      || parseMinutes(source.distanceText || fallbackText));
  return {
    source: clipText(source.source, 40) || "manual",
    distanceText: isCrossRegion
      ? "异地商户"
      : (clipText(source.distanceText || fallbackText, 80) || (durationMinutes ? `${durationMinutes}分钟` : "待估算")),
    durationMinutes: durationMinutes || null,
    distanceMeters,
    transportType: normalizeTravelMode(source.transportType),
    origin: normalizeRouteOrigin(source.origin),
    destination: normalizeRouteOrigin(source.destination),
    isCrossRegion,
  };
}

/**
 * 核心估算：直接通过地图测距服务计算两点路线距离与耗时
 */
function estimateRoute(coupon, _friendOffset = 7, origin = getDefaultRouteOrigin(), travelMode = "transit") {
  const mode = normalizeTravelMode(travelMode);
  const normOrigin = normalizeRouteOrigin(origin || getDefaultRouteOrigin());
  const destLocation = (coupon && coupon.location)
    || (coupon && coupon.latitude !== undefined && coupon.longitude !== undefined ? {
      name: coupon.venue, address: coupon.address, latitude: coupon.latitude, longitude: coupon.longitude
    } : null)
    || (coupon && coupon.route && coupon.route.destination)
    || {};
  const normDest = normalizeRouteOrigin(destLocation);

  const route = buildRoutePlaceholder(coupon, normOrigin);

  let calculatedMinutes = null;
  let calculatedDistanceText = "待估算";
  let calculatedDistanceMeters = null;
  let calculatedSource = route.source;
  let isCrossRegion = Boolean(route.isCrossRegion);

  if (isCrossRegion) {
    calculatedDistanceMeters = route.distanceMeters;
    calculatedDistanceText = route.distanceMeters
      ? `${(route.distanceMeters / 1000).toFixed(1)}km`
      : "距离过远";
  }

  const lat1 = normOrigin.latitude;
  const lng1 = normOrigin.longitude;
  const lat2 = normDest.latitude;
  const lng2 = normDest.longitude;

  if (lat1 !== null && lng1 !== null && lat2 !== null && lng2 !== null) {
    const mapInfo = mapDistanceService.resolveDistanceInfo({
      from: { latitude: lat1, longitude: lng1 },
      to: { latitude: lat2, longitude: lng2 },
      mode,
    });
    if (mapInfo) {
      calculatedDistanceMeters = mapInfo.distanceMeters;
      isCrossRegion = Boolean(mapInfo.isCrossRegion)
        || isCrossRegionDistance(mapInfo.distanceMeters);
      calculatedMinutes = isCrossRegion ? null : mapInfo.durationMinutes;
      calculatedDistanceText = mapInfo.distanceKmText;
      calculatedSource = mapInfo.source || "local_geo_engine";
    }
  }

  // 若无有效经纬度，则优雅回退至预设时间/文本
  if (calculatedMinutes === null && !isCrossRegion) {
    const staticMinutes = parseMinutes(coupon && coupon.travelTime) || (route && route.durationMinutes);
    if (staticMinutes) {
      calculatedMinutes = staticMinutes;
      // A manually entered duration is useful scheduling context, but it is
      // not evidence of route distance. Keep metric distance explicitly unknown.
      calculatedDistanceMeters = null;
      calculatedDistanceText = "距离待估算";
    }
  }

  const userMinutes = calculatedMinutes;
  const selfDistanceText = isCrossRegion
    ? `异地商户${calculatedDistanceText && calculatedDistanceText !== "距离过远" ? ` (${calculatedDistanceText})` : ""}`
    : (userMinutes
      ? (calculatedDistanceMeters === null
        ? `约${userMinutes}分钟`
        : `${TRAVEL_MODE_LABELS[mode]}约${userMinutes}分钟 (${calculatedDistanceText})`)
      : calculatedDistanceText);

  return {
    source: calculatedSource,
    transportType: mode,
    origin: normOrigin,
    destination: normDest,
    distanceMeters: calculatedDistanceMeters,
    isCrossRegion,
    self: {
      distanceText: selfDistanceText,
      durationMinutes: userMinutes,
    },
    friend: {
      // No friend origin is supplied to this service. Do not manufacture a
      // second commute by adding a fixed offset to the user's own route.
      distanceText: "待好友确认",
      durationMinutes: null,
    },
  };
}

function estimateTravelPlan({
  destination,
  origin = (getActiveRouteOrigin() || getDefaultRouteOrigin()),
  travelMode = "transit",
}) {
  const coupon = { location: destination };
  const routeResult = estimateRoute(coupon, 7, origin, travelMode);
  const minutes = (routeResult.self && typeof routeResult.self.durationMinutes === "number")
    ? routeResult.self.durationMinutes
    : null;
  const distanceText = minutes !== null ? `${minutes}分钟` : (routeResult.self && routeResult.self.distanceText) || "待获取位置";
  const route = {
    source: routeResult.source,
    distanceText,
    durationMinutes: minutes,
    distanceMeters: routeResult.distanceMeters,
    transportType: routeResult.transportType,
    origin: routeResult.origin,
    destination: routeResult.destination,
    isCrossRegion: routeResult.isCrossRegion,
  };
  return Promise.resolve({
    route,
    origin: routeResult.origin,
  });
}

function getDynamicDistance(coupon, origin = (getActiveRouteOrigin() || getDefaultRouteOrigin()), travelMode = "transit") {
  const estimated = estimateRoute(coupon, 7, origin, travelMode);
  const distanceMeters = estimated.distanceMeters;
  let durationMinutes = estimated.self && estimated.self.durationMinutes;
  let distanceKmText = "";
  const isCrossRegion = Boolean(estimated.isCrossRegion)
    || isCrossRegionDistance(distanceMeters);

  if (distanceMeters !== null && distanceMeters !== undefined) {
    distanceKmText = distanceMeters < 1000 ? `${distanceMeters}m` : `${(distanceMeters / 1000).toFixed(1)}km`;
  } else {
    const minutes = isCrossRegion ? null : (durationMinutes || parseMinutes(coupon && coupon.travelTime));
    if (minutes) {
      durationMinutes = minutes;
      distanceKmText = "距离待估算";
    } else {
      distanceKmText = "距离待估算";
      durationMinutes = null;
    }
  }

  const travelTimeText = isCrossRegion
    ? "异地商户"
    : (durationMinutes
      ? `约${durationMinutes}分钟`
      : (coupon && coupon.travelTime) || "待估算");

  return {
    distanceMeters,
    durationMinutes,
    distanceKmText,
    travelTimeText,
    transportType: estimated.transportType,
    isCrossRegion,
  };
}

module.exports = {
  ACTIVE_ORIGIN_STORAGE_KEY,
  buildRoutePlaceholder,
  buildRouteOriginView,
  estimateRoute,
  estimateTravelPlan,
  getActiveRouteOrigin,
  getDefaultRouteOrigin,
  getDynamicDistance,
  getDistanceMeters: mapDistanceService.calculateLocalDistance,
  hasStoredCoordinates,
  normalizeRoute,
  normalizeRouteOrigin,
  normalizePoint,
  isCrossRegionDistance,
  parseMinutes,
  saveActiveRouteOrigin,
};
