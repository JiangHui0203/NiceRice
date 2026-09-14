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
  chooseScreenshots,
  saveLocal,
  saveEncryptedLocal,
  persistScreenshot,
  addScreenshots,
} = require("./screenshotAcquisition.js");
const { mapWithConcurrency } = require("./screenshotTaskRunner.js");
const {
  resolvePreviewUrls,
  resolveScreenshotPreviews,
  decryptScreenshotToPreview,
} = require("./screenshotPreviewResolver.js");
const {
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
} = require("./screenshotPreviewLifecycle.js");

function persistTempScreenshot(tempFilePath) {
  return persistScreenshot(tempFilePath).then(normalizeScreenshot);
}

function serializeScreenshots(screenshots = []) {
  return normalizeScreenshots(screenshots).map((item) => {
    if (!item.encrypted) return item;
    return {
      id: item.id,
      name: item.name,
      source: "local_encrypted",
      encrypted: true,
      encryptionVersion: item.encryptionVersion === 2 ? 2 : 1,
      encryptedPath: item.encryptedPath,
      path: item.encryptedPath,
      extension: item.extension || "jpg",
      createdAt: item.createdAt || "",
    };
  });
}

function readVerifiedScreenshotStorage(key, fallback) {
  const api = getWx();
  if (!api || typeof api.getStorageSync !== "function") throw new Error("截图元数据存储不可用");
  const raw = api.getStorageSync(key);
  if (raw === undefined || raw === null || raw === "") return fallback;
  const hasEncryptionMarker = raw && typeof raw === "object"
    && Object.prototype.hasOwnProperty.call(raw, "__encrypted");
  if (hasEncryptionMarker) {
    if (raw.__encrypted !== true || !privacyService.isEncryptedRecord(raw)) {
      throw new Error("截图元数据加密格式无效");
    }
    const text = privacyService.decryptText(raw.payload, key);
    if (!text) throw new Error("截图元数据无法解密");
    return JSON.parse(text);
  }
  return raw;
}

function collectLiveManagedScreenshotPaths() {
  try {
    const coupons = readVerifiedScreenshotStorage("life_helper_coupons", []);
    const overrides = readVerifiedScreenshotStorage("life_helper_coupon_overrides", {});
    if (!Array.isArray(coupons) || coupons.length > MAX_STORED_COUPON_RECORDS
      || !overrides || typeof overrides !== "object" || Array.isArray(overrides)) return null;
    const overrideIds = Object.keys(overrides);
    if (overrideIds.length > MAX_STORED_COUPON_RECORDS) return null;
    const records = coupons.concat(overrideIds.map((key) => overrides[key]));
    const paths = new Set();
    for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
      const screenshots = records[recordIndex] && records[recordIndex].screenshots;
      if (screenshots === undefined || screenshots === null) continue;
      if (!Array.isArray(screenshots) || screenshots.length > MAX_SCREENSHOTS) return null;
      screenshots.forEach((screenshot) => {
        const candidates = typeof screenshot === "string"
          ? [screenshot]
          : screenshot && typeof screenshot === "object" && !Array.isArray(screenshot)
            ? [
              screenshot.encryptedPath,
              screenshot.savedFilePath,
              screenshot.path,
              screenshot.fileID,
              screenshot.url,
            ]
            : [];
        candidates.forEach((path) => {
          const key = getManagedStoredPathKey(path);
          if (key) paths.add(key);
        });
      });
    }
    return paths;
  } catch (error) {
    return null;
  }
}

function deleteScreenshot(item = {}) {
  const normalized = normalizeScreenshot(item);
  if (!normalized) return Promise.resolve(false);
  const paths = [normalized.encryptedPath, normalized.savedFilePath]
    .filter((path) => isManagedStoredPath(path));
  const storedPath = getStoredPath(normalized);
  if (isManagedStoredPath(storedPath)) paths.push(storedPath);
  const seenPathKeys = new Set();
  const uniquePaths = paths.filter((path) => {
    const key = getManagedStoredPathKey(path);
    if (!key || seenPathKeys.has(key)) return false;
    seenPathKeys.add(key);
    return true;
  });
  // Do not trust caller assertions that a path is unreferenced. A fresh raw
  // metadata scan is cheap and is the final guard against stale caches or an
  // alias mismatch in a higher-level pre-check.
  const references = collectLiveManagedScreenshotPaths();
  // A failed reference read must fail closed: retaining an orphan is
  // recoverable, while deleting a file still referenced by another coupon is
  // permanent data loss.
  const referenceReadFailed = references === null && uniquePaths.length > 0;
  const deletablePaths = referenceReadFailed
    ? []
    : uniquePaths.filter((path) => !references.has(getManagedStoredPathKey(path)));
  const tasks = deletablePaths.map(unlinkFile);
  collectManagedPreviewPaths([normalized])
    .forEach((path) => tasks.push(releasePreviewPath(path)));
  if (!tasks.length) return Promise.resolve(!referenceReadFailed && uniquePaths.length > 0);
  return Promise.all(tasks)
    .then((results) => !referenceReadFailed && results.every((result) => result === true))
    .catch(() => false);
}

function cleanupOrphanedPreviews() {
  const fs = getFs();
  const userPath = getUserDataPath();
  if (!fs || !userPath || typeof fs.readdir !== "function") return Promise.resolve(false);
  let referencesReady = true;
  let referencedPaths = collectLiveManagedScreenshotPaths();
  if (referencedPaths === null) {
    // If metadata cannot be read, only previews are safe to remove. Never turn
    // a transient storage/decryption failure into attachment loss.
    referencesReady = false;
    referencedPaths = new Set();
  }
  const now = Date.now();
  return new Promise((resolve) => {
    fs.readdir({
      dirPath: userPath,
      success(res) {
        const files = (res && res.files || []).filter((rawName) => {
          const name = String(rawName || "");
          const path = `${userPath}/${name}`;
          const matched = name.match(/(?:^|_)(\d{13})(?:_|\.|$)/);
          const createdAt = matched ? Number(matched[1]) : NaN;
          if (isManagedPreviewPath(path)) {
            // Startup cleanup can overlap a page resolving its first preview.
            // Keep owned or freshly-created previews instead of unlinking a
            // file that is about to be displayed.
            return !isPreviewOwned(path)
              && Number.isFinite(createdAt)
              && now - createdAt >= PREVIEW_TTL_MS;
          }
          if (!referencesReady || !isManagedStoredPath(path)) {
            return false;
          }
          if (referencedPaths.has(getManagedStoredPathKey(path))) return false;
          return Number.isFinite(createdAt) && now - createdAt >= ORPHAN_ATTACHMENT_GRACE_MS;
        });
        mapWithConcurrency(
          files,
          MAX_PERSIST_CONCURRENCY,
          (name) => unlinkFile(`${userPath}/${name}`),
        ).then((results) => resolve(results.every(Boolean))).catch(() => resolve(false));
      },
      fail() { resolve(false); },
    });
  });
}

module.exports = {
  persistTempScreenshot,
  serializeScreenshots,
  readVerifiedScreenshotStorage,
  collectLiveManagedScreenshotPaths,
  deleteScreenshot,
  cleanupOrphanedPreviews,
};
