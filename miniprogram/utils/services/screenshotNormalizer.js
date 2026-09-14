const privacyService = require("../privacyService.js");
const { getWx } = require("../wechatRuntime.js");
const {
  MAX_SCREENSHOT_BYTES,
  MAX_ENCRYPTED_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_PIXELS,
  MAX_SCREENSHOTS,
  MAX_STORED_COUPON_RECORDS,
  MAX_PERSIST_CONCURRENCY,
  PREVIEW_TTL_MS,
  ORPHAN_ATTACHMENT_GRACE_MS,
  BINARY_SCREENSHOT_MAGIC,
  previewCleanupTimers,
  previewPathCache,
  previewResolutionPromises,
  previewOwnerPaths,
  createScreenshotId,
  getFs,
  getUserDataPath,
} = require("./screenshotContext.js");

function getPreviewUrl(item = {}) {
  return item.previewUrl || item.tempFilePath || item.savedFilePath || (!item.encrypted && (item.fileID || item.url || item.path)) || "";
}

function boundedText(value, maxLength) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength);
}

function boundedPath(value) {
  if (typeof value !== "string" || !value || value !== value.trim()
    || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return "";
  return value;
}

function normalizeScreenshotId(value, fallbackSource, index = 0) {
  const candidate = typeof value === "string" ? value : "";
  if (candidate === candidate.trim()
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(candidate)) return candidate;
  return `shot_${index}_${Math.abs(hashText(fallbackSource))}`;
}

function getStoredPath(item = {}) {
  return item.encryptedPath || item.savedFilePath || item.fileID || item.url || item.path || "";
}

function normalizeScreenshot(item, index = 0) {
  if (!item) return null;
  if (typeof item === "string") {
    const path = boundedPath(item);
    if (!path) return null;
    return {
      id: `shot_${index}_${Math.abs(hashText(path))}`,
      name: `截图${index + 1}`,
      source: path.indexOf("cloud://") === 0 ? "cloud" : "local",
      encrypted: false,
      encryptionVersion: 0,
      encryptedPath: "",
      path,
      previewUrl: path,
      savedFilePath: "",
      fileID: path.indexOf("cloud://") === 0 ? path : "",
      url: "",
      tempFilePath: "",
      tempPreviewPath: "",
      extension: getExtension(path),
      createdAt: "",
    };
  }
  if (typeof item !== "object" || Array.isArray(item)) return null;
  const previewUrl = getPreviewUrl(item);
  const storedPath = getStoredPath(item);
  if (!previewUrl && !storedPath) return null;
  const encrypted = item.encrypted === true;
  const normalizedStoredPath = boundedPath(storedPath);
  const normalizedPreviewUrl = boundedPath(previewUrl);
  if (!normalizedPreviewUrl && !normalizedStoredPath) return null;
  const fallbackIdSource = normalizedPreviewUrl || normalizedStoredPath;
  const rawExtension = boundedText(item.extension || getExtension(fallbackIdSource), 12).toLowerCase();
  const extension = /^[a-z0-9]{1,12}$/.test(rawExtension) ? rawExtension : "jpg";
  return {
    id: normalizeScreenshotId(item.id, fallbackIdSource, index),
    name: boundedText(item.name, 80) || `截图${index + 1}`,
    source: encrypted
      ? "local_encrypted"
      : (item.fileID || normalizedPreviewUrl.indexOf("cloud://") === 0 ? "cloud" : "local"),
    encrypted,
    encryptionVersion: encrypted && Number(item.encryptionVersion) === 2 ? 2 : (encrypted ? 1 : 0),
    encryptedPath: encrypted ? boundedPath(item.encryptedPath || normalizedStoredPath) : "",
    path: boundedPath(item.path || normalizedStoredPath || normalizedPreviewUrl),
    previewUrl: encrypted ? boundedPath(item.previewUrl) : normalizedPreviewUrl,
    savedFilePath: boundedPath(item.savedFilePath),
    fileID: boundedPath(item.fileID),
    url: boundedPath(item.url),
    tempFilePath: boundedPath(item.tempFilePath),
    tempPreviewPath: boundedPath(item.tempPreviewPath),
    extension,
    createdAt: boundedText(item.createdAt, 40),
  };
}

function normalizeScreenshots(list = []) {
  return (Array.isArray(list) ? list.slice(0, MAX_SCREENSHOTS) : []).map(normalizeScreenshot).filter(Boolean);
}

function hashText(text) {
  return String(text || "").split("").reduce((sum, char) => ((sum << 5) - sum) + char.charCodeAt(0), 0);
}

function getExtension(filePath) {
  const matched = String(filePath || "").match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  return matched && matched[1].length <= 12 ? matched[1].toLowerCase() : "jpg";
}

module.exports = {
  getPreviewUrl,
  boundedText,
  boundedPath,
  normalizeScreenshotId,
  getStoredPath,
  normalizeScreenshot,
  normalizeScreenshots,
  hashText,
  getExtension,
};
