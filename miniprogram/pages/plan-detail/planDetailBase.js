function normalizeCoordinate(value, minimum, maximum) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= minimum && numeric <= maximum ? numeric : null;
}

function positiveNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function firstNonEmptyText(...values) {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === null || values[index] === undefined) continue;
    const text = String(values[index]).trim();
    if (text) return text;
  }
  return "";
}

const SCHEDULE_PLACEHOLDERS = new Set(["待定", "时间待定", "时间待补充", "未设置"]);

function firstScheduleText(...values) {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === null || values[index] === undefined) continue;
    const text = String(values[index]).trim();
    if (text && !SCHEDULE_PLACEHOLDERS.has(text)) return text;
  }
  return "";
}

function parseTravelMinutes(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*小时/);
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*分钟/);
  if (!hourMatch && !minuteMatch) return null;
  const hours = hourMatch ? Number(hourMatch[1]) : 0;
  const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
  const total = Math.round(hours * 60 + minutes);
  return total > 0 ? total : null;
}

function formatDistance(distanceMeters) {
  const meters = positiveNumber(distanceMeters);
  if (meters === null) return "";
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`;
}

function extractStoredDistanceText(...values) {
  for (let index = 0; index < values.length; index += 1) {
    const text = String(values[index] || "").trim();
    const matched = text.match(/(\d+(?:\.\d+)?)\s*(公里|千米|km|米|m)(?![a-z])/i);
    if (matched) return `${matched[1]}${matched[2]}`;
  }
  return "";
}

function getPlanCleanupMinutes(plan = {}) {
  const cleanup = plan.cleanup || "";
  const match = String(cleanup).match(/(\d+)\s*分钟/);
  if (match) return Number(match[1]);
  const tags = Array.isArray(plan.tags) ? plan.tags : [];
  if (tags.includes("需要洗澡洗头")) return 45;
  if (tags.includes("需要简单整理")) return 20;
  return 0;
}

module.exports = {
  normalizeCoordinate,
  positiveNumber,
  firstNonEmptyText,
  firstScheduleText,
  parseTravelMinutes,
  formatDistance,
  extractStoredDistanceText,
  getPlanCleanupMinutes,
};
