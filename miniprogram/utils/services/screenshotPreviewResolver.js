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
  createPreviewId,
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
const { validateImageDimensions } = require("./screenshotPreparation.js");
const { mapWithConcurrency } = require("./screenshotTaskRunner.js");
const { isManagedStoredPath } = require("./screenshotPathPolicy.js");
const {
  forgetPreviewPath,
  schedulePreviewCleanup,
} = require("./screenshotPreviewState.js");

function resolveEncryptedPreview(item = {}) {
  if (!item.encrypted || !item.encryptedPath) return Promise.resolve(getPreviewUrl(item));
  if (!isManagedStoredPath(item.encryptedPath)) return Promise.resolve("");
  const reusablePath = previewPathCache[item.encryptedPath];
  const resolveFresh = () => {
    if (previewResolutionPromises[item.encryptedPath]) return previewResolutionPromises[item.encryptedPath];
    const pending = decryptScreenshotToPreview(item).finally(() => {
      if (previewResolutionPromises[item.encryptedPath] === pending) {
        delete previewResolutionPromises[item.encryptedPath];
      }
    });
    previewResolutionPromises[item.encryptedPath] = pending;
    return pending;
  };
  if (!reusablePath) return resolveFresh();
  return fileExists(reusablePath).then((exists) => {
    if (!exists) {
      forgetPreviewPath(reusablePath);
      return resolveFresh();
    }
    previewPathCache[item.encryptedPath] = reusablePath;
    schedulePreviewCleanup(reusablePath);
    return reusablePath;
  });
}

function resolvePreviewUrls(screenshots = []) {
  const normalized = normalizeScreenshots(screenshots);
  const api = getWx();
  const encryptedItems = normalized.filter((item) => item.encrypted && item.encryptedPath);
  if (encryptedItems.length) {
    return mapWithConcurrency(normalized, MAX_PERSIST_CONCURRENCY, (item) => (
      item.encrypted ? resolveEncryptedPreview(item) : Promise.resolve(getPreviewUrl(item))
    ))
      .then((urls) => urls);
  }
  const cloudItems = normalized.filter((item) => item.fileID || item.previewUrl.indexOf("cloud://") === 0);
  if (!privacyService.isCloudUploadAllowed() || !cloudItems.length || !api || !api.cloud || typeof api.cloud.getTempFileURL !== "function") {
    return Promise.resolve(normalized.map(getPreviewUrl));
  }
  return new Promise((resolve) => {
    api.cloud.getTempFileURL({
      fileList: cloudItems.map((item) => item.fileID || item.previewUrl),
      success(res) {
        const map = {};
        (res.fileList || []).forEach((file) => {
          map[file.fileID] = file.tempFileURL;
        });
        resolve(normalized.map((item) => map[item.fileID || item.previewUrl] || getPreviewUrl(item)));
      },
      fail() {
        resolve(normalized.map(getPreviewUrl));
      },
    });
  });
}

function resolveScreenshotPreviews(screenshots = []) {
  const normalized = normalizeScreenshots(screenshots);
  return resolvePreviewUrls(normalized).then((urls) => normalized.map((item, index) => Object.assign({}, item, {
    previewUrl: urls[index] || getPreviewUrl(item),
    tempPreviewPath: item.encrypted ? urls[index] || item.tempPreviewPath || "" : item.tempPreviewPath || "",
  })));
}

function decryptScreenshotToPreview(item = {}) {
  if (!item.encrypted || !item.encryptedPath) return Promise.resolve(getPreviewUrl(item));
  if (!isManagedStoredPath(item.encryptedPath)) return Promise.resolve("");
  const extension = item.extension || "jpg";
  const userPath = getUserDataPath();
  if (!userPath) return Promise.resolve("");
  const previewId = createPreviewId();
  const attachmentHash = Math.abs(hashText(`${item.id || ""}|${item.encryptedPath}`));
  const previewPath = `${userPath}/preview_${previewId}_${attachmentHash}.${extension}`;
  return getFileSize(item.encryptedPath).then((size) => {
    if (!Number.isFinite(size) || size < 0 || size > MAX_ENCRYPTED_SCREENSHOT_BYTES) return "";
    // encryptionVersion was absent in legacy records and may be stripped by
    // older coupon normalizers. Detect v2 from its on-disk magic so both
    // metadata shapes remain readable after an upgrade or downgrade cycle.
    return readFileArrayBuffer(item.encryptedPath).then((buffer) => {
      if (hasBinaryScreenshotMagic(buffer)) {
        if (size > MAX_SCREENSHOT_BYTES + 512) return "";
        return Promise.resolve(unpackEncryptedScreenshotBuffer(buffer))
          .then((plainBuffer) => writeFile(previewPath, plainBuffer, ""));
      }
      return readFileUtf8(item.encryptedPath).then((text) => {
        if (!text) return "";
        const payload = JSON.parse(text || "{}");
        const base64 = privacyService.decryptText(payload.encrypted, "coupon_screenshot");
        return base64 ? writeFile(previewPath, base64, "base64") : "";
      });
    });
  }).then((writtenPath) => {
    if (!writtenPath) return "";
    return validateImageDimensions(writtenPath);
  }).then((resolvedPath) => {
    if (resolvedPath) {
      previewPathCache[item.encryptedPath] = resolvedPath;
      schedulePreviewCleanup(resolvedPath);
    }
    return resolvedPath;
  }).catch(() => unlinkFile(previewPath).then(() => ""));
}

module.exports = {
  resolvePreviewUrls,
  resolveScreenshotPreviews,
  decryptScreenshotToPreview,
  resolveEncryptedPreview,
};
