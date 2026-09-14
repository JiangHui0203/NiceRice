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
const {
  getPreviewUrl,
  boundedText,
  boundedPath,
  normalizeScreenshotId,
  getStoredPath,
  normalizeScreenshot,
  normalizeScreenshots,
  hashText,
  getExtension,
} = require("./screenshotNormalizer.js");
const {
  readFileArrayBuffer,
  readFileUtf8,
  writeFile,
  packEncryptedScreenshotBuffer,
  hasBinaryScreenshotMagic,
  unpackEncryptedScreenshotBuffer,
  unlinkFile,
  fileExists,
  getFileSize,
} = require("./screenshotFileCodec.js");
const {
  resolvePreviewUrls,
  resolveScreenshotPreviews,
  decryptScreenshotToPreview,
  resolveEncryptedPreview,
} = require("./screenshotPreviewResolver.js");
const {
  getDirectChildName,
  getManagedFileName,
  getManagedPreviewFileName,
  isManagedPreviewPath,
  getManagedStoredFileName,
  isManagedStoredPath,
  getManagedStoredPathKey,
} = require("./screenshotPathPolicy.js");
const {
  forgetPreviewPath,
  isPreviewOwned,
  releasePreviewPath,
  schedulePreviewCleanup,
} = require("./screenshotPreviewState.js");

function collectManagedPreviewPaths(screenshots = []) {
  const paths = [];
  normalizeScreenshots(screenshots).forEach((item) => {
    if (!item.encrypted || !item.encryptedPath) return;
    const cachedPath = previewPathCache[item.encryptedPath];
    [item.tempPreviewPath, item.previewUrl].forEach((path) => {
      // Preview paths are process-local capabilities. Persisted/imported
      // metadata must not be able to claim another attachment's plaintext.
      if (path && path === cachedPath) paths.push(path);
    });
  });
  return paths.filter((path, index, list) => isManagedPreviewPath(path) && list.indexOf(path) === index);
}

function retainScreenshotPreviews(screenshots = [], ownerId = "") {
  if (!ownerId) return false;
  const nextPaths = new Set(collectManagedPreviewPaths(screenshots));
  const previousPaths = previewOwnerPaths[ownerId] || new Set();
  previewOwnerPaths[ownerId] = nextPaths;
  nextPaths.forEach((filePath) => {
    if (previewCleanupTimers[filePath]) {
      clearTimeout(previewCleanupTimers[filePath]);
      delete previewCleanupTimers[filePath];
    }
  });
  previousPaths.forEach((filePath) => {
    if (!nextPaths.has(filePath) && !isPreviewOwned(filePath)) releasePreviewPath(filePath);
  });
  return true;
}

function releaseScreenshotPreviews(screenshots = [], ownerId = "") {
  let uniquePaths = collectManagedPreviewPaths(screenshots);
  if (ownerId && previewOwnerPaths[ownerId]) {
    uniquePaths = Array.from(previewOwnerPaths[ownerId]);
    delete previewOwnerPaths[ownerId];
  }
  return Promise.all(uniquePaths.map(releasePreviewPath)).then(() => true);
}

function previewScreenshots(screenshots = [], index = 0, options = {}) {
  const api = getWx();
  if (!api || typeof api.previewImage !== "function") return Promise.resolve(false);
  const isActive = typeof options.isActive === "function" ? options.isActive : () => true;
  return resolvePreviewUrls(screenshots).then((urls) => {
    // Resolutions may be coalesced with an active page request. An inactive
    // caller must not unlink a shared path; page cleanup/TTL owns reclamation.
    if (!isActive()) return false;
    const availableUrls = urls.filter(Boolean);
    if (!availableUrls.length) return false;
    api.previewImage({
      current: urls[index] || availableUrls[0],
      urls: availableUrls,
    });
    return true;
  });
}

module.exports = {
  getDirectChildName,
  getManagedFileName,
  getManagedPreviewFileName,
  isManagedPreviewPath,
  getManagedStoredFileName,
  isManagedStoredPath,
  getManagedStoredPathKey,
  forgetPreviewPath,
  isPreviewOwned,
  collectManagedPreviewPaths,
  retainScreenshotPreviews,
  resolveEncryptedPreview,
  releasePreviewPath,
  schedulePreviewCleanup,
  releaseScreenshotPreviews,
  previewScreenshots,
};
