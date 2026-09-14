const privacyService = require("../privacyService.js");
const { getWx } = require("../wechatRuntime.js");

const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const MAX_ENCRYPTED_SCREENSHOT_BYTES = MAX_SCREENSHOT_BYTES * 3;
const MAX_SCREENSHOT_PIXELS = 12 * 1024 * 1024;
const MAX_SCREENSHOTS = 6;
const MAX_STORED_COUPON_RECORDS = 500;
const MAX_PERSIST_CONCURRENCY = 1;
const PREVIEW_TTL_MS = 2 * 60 * 1000;
const ORPHAN_ATTACHMENT_GRACE_MS = 10 * 60 * 1000;
const BINARY_SCREENSHOT_MAGIC = "LHSHOT2\n";
const previewCleanupTimers = Object.create(null);
const previewPathCache = Object.create(null);
const previewResolutionPromises = Object.create(null);
const previewOwnerPaths = Object.create(null);
let screenshotSequence = 0;
let previewSequence = 0;

function createScreenshotId() {
  screenshotSequence = (screenshotSequence + 1) % 1000000;
  return `shot_${Date.now()}_${screenshotSequence}_${Math.random().toString(36).slice(2, 7)}`;
}

function createPreviewId() {
  previewSequence = (previewSequence + 1) % 1000000;
  return `${Date.now()}_${previewSequence}_${Math.random().toString(36).slice(2, 6)}`;
}

function getFs() {
  const api = getWx();
  return api && typeof api.getFileSystemManager === "function" ? api.getFileSystemManager() : null;
}

function getUserDataPath() {
  const api = getWx();
  const value = api && api.env && api.env.USER_DATA_PATH;
  return typeof value === "string" ? value.replace(/\/+$/, "") : "";
}

module.exports = {
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
  createPreviewId,
  getFs,
  getUserDataPath,
};
