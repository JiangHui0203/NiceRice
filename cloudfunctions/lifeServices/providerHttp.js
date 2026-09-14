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
  isAllowedOcrFileId,
  enforceRateLimit,
  enforceEventRateLimit,
} = require("./serviceSecurity.js");

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePoint(point = {}) {
  if (!isRecord(point)) throw createError("invalid_location", "缺少有效的经纬度");
  const primaryLatitude = toNumber(point.latitude);
  const aliasLatitude = toNumber(point.lat);
  const primaryLongitude = toNumber(point.longitude);
  const aliasLongitude = toNumber(point.lng);
  if (primaryLatitude !== null && aliasLatitude !== null && primaryLatitude !== aliasLatitude) {
    throw createError("invalid_location", "纬度字段不一致");
  }
  if (primaryLongitude !== null && aliasLongitude !== null && primaryLongitude !== aliasLongitude) {
    throw createError("invalid_location", "经度字段不一致");
  }
  const latitude = primaryLatitude !== null ? primaryLatitude : aliasLatitude;
  const longitude = primaryLongitude !== null ? primaryLongitude : aliasLongitude;
  if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw createError("invalid_location", "缺少有效的经纬度");
  }
  return { latitude, longitude, lat: latitude, lng: longitude };
}

function buildQuery(params) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      let body = "";
      let bodyBytes = 0;
      let responseTooLarge = false;
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if (responseTooLarge) return;
        bodyBytes += Buffer.byteLength(chunk, "utf8");
        if (bodyBytes > MAX_PROVIDER_RESPONSE_BYTES) {
          responseTooLarge = true;
          response.destroy();
          reject(createError("response_too_large", "地图服务响应体积异常"));
          return;
        }
        body += chunk;
      });
      response.on("end", () => {
        if (responseTooLarge) {
          reject(createError("response_too_large", "地图服务响应体积异常"));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(createError("http_error", `地图服务请求失败：${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(createError("invalid_response", "地图服务返回内容无法解析"));
        }
      });
    });
    request.setTimeout(8000, () => {
      request.destroy(createError("timeout", "地图服务请求超时"));
    });
    request.on("error", reject);
  });
}

function durationToMinutes(value, unit = "auto") {
  const number = toNumber(value);
  if (number === null || number < 0) return null;
  const minutes = unit === "seconds"
    ? Math.max(1, Math.ceil(number / 60))
    : (unit === "minutes"
      ? Math.max(1, Math.ceil(number))
      : (number > 600 ? Math.max(1, Math.ceil(number / 60)) : Math.max(1, Math.ceil(number))));
  return minutes <= 10080 ? minutes : null;
}

function formatDistance(distanceMeters) {
  const meters = toNumber(distanceMeters);
  if (meters === null || meters < 0) return "";
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)}公里`;
  return `${Math.round(meters)}米`;
}

function formatRouteText(durationMinutes, distanceMeters) {
  const distanceText = formatDistance(distanceMeters);
  if (durationMinutes && distanceText) return `约${durationMinutes}分钟 · ${distanceText}`;
  if (durationMinutes) return `约${durationMinutes}分钟`;
  return distanceText || "待估算";
}

function getProviderKey(primaryName, legacyName, label) {
  const value = process.env[primaryName] || process.env[legacyName] || "";
  if (!value) return "";
  if (typeof value !== "string" || value.length > 512 || /[\s\u0000-\u001F\u007F]/.test(value)) {
    throw createError("invalid_cloud_config", `${label}配置无效`);
  }
  return value;
}

function getTencentKey() {
  return getProviderKey("TENCENT_MAP_KEY", "QQ_MAP_KEY", "腾讯地图 Key");
}

function getAmapKey() {
  return getProviderKey("AMAP_MAP_KEY", "GAODE_MAP_KEY", "高德地图 Key");
}

function normalizeRouteText(value, maxLength, label) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" && typeof value !== "number") {
    throw createError("invalid_route", `${label}格式无效`);
  }
  const text = String(value).trim();
  if (text.length > maxLength) throw createError("invalid_route", `${label}过长`);
  return text;
}

module.exports = {
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
};
