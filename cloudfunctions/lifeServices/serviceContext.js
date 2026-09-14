const cloud = require("wx-server-sdk");
const https = require("https");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const INVITE_RECORD_ACTIVE = "active";
const INVITE_RECORD_REVOKED = "revoked";
const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;
const MAX_OCR_TEXT_LENGTH = 100000;
const MAX_EVENT_DATA_BYTES = 64 * 1024;
const INVITE_STATUSES = new Set(["pending", "confirmed", "rejected"]);
const SHAREABLE_PLAN_STATUSES = new Set(["pending", "confirmed", "rescheduled"]);
const RESERVATION_STATUSES = new Set(["unknown", "not_required", "required", "pending", "confirmed", "failed"]);
const rateLimitBuckets = new Map();
const serviceErrors = new WeakSet();
const ACTION_DATA_FIELDS = Object.freeze({
  getOpenId: [],
  estimateRoute: ["from", "to", "mode", "city", "destinationCity"],
  reverseGeocode: ["latitude", "longitude", "lat", "lng"],
  recognizeCouponImage: ["fileID"],
  createPlanInvite: ["inviteId", "planId", "couponId", "title", "selectedTime", "planSnapshot", "friendName", "status", "planUpdatedAt"],
  updatePlanInvite: ["inviteId", "couponId", "title", "selectedTime", "planSnapshot", "status", "planUpdatedAt"],
  proposePlanInviteTime: ["inviteId", "selectedTime", "planUpdatedAt"],
  getPlanInvite: ["inviteId"],
  deletePlanInvite: ["inviteId"],
  sendSubscribeMessage: ["templateId", "openid", "page", "messageData", "miniprogramState"],
});

const ROUTE_MODES = {
  transit: "transit",
  driving: "driving",
  walking: "walking",
};

function normalizeRouteMode(value, fallback = "transit") {
  const mode = value === undefined || value === null || value === "" ? fallback : String(value);
  if (!Object.prototype.hasOwnProperty.call(ROUTE_MODES, mode)) {
    throw createError("invalid_route_mode", "出行方式无效");
  }
  return ROUTE_MODES[mode];
}

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  serviceErrors.add(error);
  return error;
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function mergeRecords(...sources) {
  const result = Object.create(null);
  sources.forEach((source) => {
    if (!isRecord(source)) return;
    Object.keys(source).forEach((key) => {
      if (["__proto__", "prototype", "constructor"].includes(key)) return;
      result[key] = source[key];
    });
  });
  return result;
}

function normalizeEvent(event) {
  if (!isRecord(event)) throw createError("invalid_request", "服务请求格式无效");
  const type = boundedText(event.type, 64);
  if (!type || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(type)) {
    throw createError("invalid_request", "服务类型无效");
  }
  const rawData = event.data === undefined || event.data === null ? {} : event.data;
  if (!isRecord(rawData)) throw createError("invalid_request", "服务参数格式无效");
  const data = mergeRecords(rawData);
  if (event.provider !== undefined && event.provider !== null && typeof event.provider !== "string") {
    throw createError("invalid_provider", "地图服务提供方无效");
  }
  const rawProvider = event.provider === undefined || event.provider === null
    ? undefined
    : event.provider.trim();
  if (rawProvider && rawProvider.length > 24) {
    throw createError("invalid_provider", "地图服务提供方无效");
  }
  if (rawProvider && type !== "estimateRoute") {
    throw createError("invalid_request", "当前服务不接受地图提供方参数");
  }
  let serialized;
  try {
    serialized = JSON.stringify({ data, provider: rawProvider });
  } catch (error) {
    throw createError("invalid_request", "服务参数无法解析");
  }
  if (Buffer.byteLength(serialized || "", "utf8") > MAX_EVENT_DATA_BYTES) {
    throw createError("request_too_large", "服务参数过大");
  }
  const allowedFields = Object.prototype.hasOwnProperty.call(ACTION_DATA_FIELDS, type)
    ? ACTION_DATA_FIELDS[type]
    : null;
  if (allowedFields && Object.keys(data).some((key) => !allowedFields.includes(key))) {
    throw createError("invalid_request", "服务参数包含未知字段");
  }
  return { type, data, provider: rawProvider };
}

function boundedText(value, maxLength) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().slice(0, maxLength);
}

module.exports = {
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
};
