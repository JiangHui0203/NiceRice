const EVENT_KEY = "life_helper_event_logs";
const RECOMMENDATION_LOG_KEY = "life_helper_recommendation_logs";
const MAX_LOG_COUNT = 120;
const privacyService = require("./privacyService.js");

function clipText(value, maxLength = 160) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength);
}

function sanitizePrimitive(value) {
  if (typeof value === "string") return clipText(value, 256);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  return undefined;
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const result = {};
  Object.keys(payload).slice(0, 20).forEach((rawKey) => {
    const key = clipText(rawKey, 48);
    if (!key || key === "__proto__" || key === "constructor" || key === "prototype") return;
    const value = payload[rawKey];
    const primitive = sanitizePrimitive(value);
    if (primitive !== undefined) {
      result[key] = primitive;
      return;
    }
    if (Array.isArray(value)) {
      result[key] = value.slice(0, 20).map(sanitizePrimitive).filter((item) => item !== undefined);
    }
  });
  return result;
}

function normalizeEventLog(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  return {
    id: clipText(item.id, 96),
    type: clipText(item.type, 64) || "unknown",
    payload: sanitizePayload(item.payload),
    createdAt: clipText(item.createdAt, 40),
  };
}

function normalizeRecommendationLog(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const score = Number(item.score);
  const textList = (value) => (Array.isArray(value) ? value : [])
    .map((entry) => clipText(entry, 160)).filter(Boolean).slice(0, 20);
  return {
    id: clipText(item.id, 96),
    couponId: clipText(item.couponId, 96),
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
    level: clipText(item.level, 32),
    statusLabel: clipText(item.statusLabel, 64),
    scoreBreakdown: sanitizePayload(item.scoreBreakdown),
    reasons: textList(item.reasons),
    warnings: textList(item.warnings),
    blockers: textList(item.blockers),
    createdAt: clipText(item.createdAt, 40),
  };
}

function readList(key) {
  const stored = privacyService.readLocalData(key, []);
  const normalizer = key === RECOMMENDATION_LOG_KEY ? normalizeRecommendationLog : normalizeEventLog;
  return (Array.isArray(stored) ? stored.slice(0, MAX_LOG_COUNT) : [])
    .map(normalizer)
    .filter(Boolean);
}

function writeList(key, list) {
  const saved = privacyService.writeLocalData(key, (list || []).slice(0, MAX_LOG_COUNT));
  if (!saved) console.warn("log write failed", key);
  return Boolean(saved);
}

function nowText() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function logEvent(type, payload = {}) {
  const logs = readList(EVENT_KEY);
  logs.unshift({
    id: `evt_${Date.now()}`,
    type: clipText(type, 64) || "unknown",
    payload: sanitizePayload(payload),
    createdAt: nowText(),
  });
  return writeList(EVENT_KEY, logs);
}

function logRecommendation(recommendation) {
  const source = recommendation && typeof recommendation === "object" && !Array.isArray(recommendation)
    ? recommendation
    : {};
  const logs = readList(RECOMMENDATION_LOG_KEY);
  logs.unshift(normalizeRecommendationLog({
    id: `rec_log_${Date.now()}_${clipText(source.couponId, 48) || "unknown"}`,
    couponId: source.couponId,
    score: source.score,
    level: source.level,
    statusLabel: source.statusLabel,
    scoreBreakdown: source.scoreBreakdown,
    reasons: source.reasons,
    warnings: source.warnings,
    blockers: source.blockers,
    createdAt: nowText(),
  }));
  return writeList(RECOMMENDATION_LOG_KEY, logs);
}

function getEventLogs() {
  return readList(EVENT_KEY);
}

function getRecommendationLogs() {
  return readList(RECOMMENDATION_LOG_KEY);
}

function clearLogs() {
  const eventLogs = readList(EVENT_KEY);
  const recommendationLogs = readList(RECOMMENDATION_LOG_KEY);
  if (!writeList(EVENT_KEY, [])) return false;
  if (!writeList(RECOMMENDATION_LOG_KEY, [])) {
    writeList(EVENT_KEY, eventLogs);
    return false;
  }
  return true;
}

module.exports = {
  logEvent,
  logRecommendation,
  getEventLogs,
  getRecommendationLogs,
  clearLogs,
};
