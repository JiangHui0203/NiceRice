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

function normalizeScreenshotId(value, index) {
  if (typeof value === "string" && value === value.trim()
    && /^[A-Za-z0-9_-]{1,96}$/.test(value)) return value;
  return `shot_${index}`;
}

function sanitizeStoredScreenshots(screenshots = []) {
  const normalized = (Array.isArray(screenshots) ? screenshots : []).slice(0, 6).map((item, index) => {
    if (typeof item === "string") {
      const path = boundedText(item, 2048);
      if (!path) return null;
      return {
        id: `shot_${index}`,
        name: `截图${index + 1}`,
        source: path.indexOf("cloud://") === 0 ? "cloud" : "local",
        encrypted: false,
        encryptedPath: "",
        path,
        previewUrl: path,
        extension: boundedText((path.match(/\.([a-zA-Z0-9]+)(?:\?|$)/) || [])[1] || "jpg", 12),
        createdAt: "",
      };
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const encrypted = item.encrypted === true;
    const encryptedPath = boundedText(item.encryptedPath || (encrypted ? item.path : ""), 2048);
    const path = boundedText(encryptedPath || item.path || item.savedFilePath || item.fileID || item.url, 2048);
    const previewUrl = encrypted ? "" : boundedText(item.previewUrl || item.tempFilePath || path, 2048);
    if (!path && !previewUrl) return null;
    return {
      id: normalizeScreenshotId(item.id, index),
      name: boundedText(item.name, 80, `截图${index + 1}`),
      source: encrypted
        ? "local_encrypted"
        : boundedText(item.source, 32, path.indexOf("cloud://") === 0 ? "cloud" : "local"),
      encrypted,
      encryptedPath,
      path,
      previewUrl,
      extension: boundedText(item.extension, 12, "jpg"),
      createdAt: boundedText(item.createdAt, 40),
    };
  }).filter(Boolean);
  const seenIds = new Set();
  return normalized.map((item, index) => {
    let id = item.id;
    let suffix = 0;
    while (seenIds.has(id)) {
      suffix += 1;
      id = `shot_${index}_${suffix}`;
    }
    seenIds.add(id);
    return id === item.id ? item : Object.assign({}, item, { id });
  });
}

module.exports = {
  normalizeScreenshotId,
  sanitizeStoredScreenshots,
};
