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
  compressScreenshot,
  validateImageDimensions,
  prepareScreenshot,
} = require("./screenshotPreparation.js");
const { mapWithConcurrency } = require("./screenshotTaskRunner.js");

function chooseScreenshots(count = 6) {
  return new Promise((resolve, reject) => {
    const safeCount = Math.min(MAX_SCREENSHOTS, Math.max(0, Number(count) || 0));
    if (!safeCount) {
      resolve([]);
      return;
    }
    const api = getWx();
    if (!api) {
      reject(new Error("当前环境不支持选择图片"));
      return;
    }
    if (typeof api.chooseMedia === "function") {
      api.chooseMedia({
        count: safeCount,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        sizeType: ["compressed"],
        success(res) {
          resolve((res.tempFiles || []).map((file) => file.tempFilePath || file.path).filter(Boolean));
        },
        fail: reject,
      });
      return;
    }
    api.chooseImage({
      count: safeCount,
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success(res) {
        resolve(res.tempFilePaths || []);
      },
      fail: reject,
    });
  });
}

function saveLocal(tempFilePath) {
  const id = createScreenshotId();
  const extension = getExtension(tempFilePath);
  const userPath = getUserDataPath();
  if (!userPath) return Promise.reject(new Error("缺少本地私有目录"));
  const savedFilePath = `${userPath}/${id}.${extension}`;
  return readFileArrayBuffer(tempFilePath)
    .then((buffer) => writeFile(savedFilePath, buffer, ""))
    .then(() => ({
      id,
      source: "local",
      encrypted: false,
      encryptionVersion: 0,
      savedFilePath,
      path: savedFilePath,
      previewUrl: savedFilePath,
      extension,
      createdAt: new Date().toISOString(),
    }))
    .catch((error) => unlinkFile(savedFilePath).then(() => { throw error; }));
}

function saveEncryptedLocal(tempFilePath) {
  const extension = getExtension(tempFilePath);
  const id = createScreenshotId();
  const userPath = getUserDataPath();
  if (!userPath) return Promise.reject(new Error("缺少本地私有目录"));
  const encryptedPath = `${userPath}/${id}.${extension}.enc`;
  return readFileArrayBuffer(tempFilePath)
    .then(packEncryptedScreenshotBuffer)
    .then((payload) => writeFile(encryptedPath, payload, ""))
    .then(() => ({
      id,
      name: "券截图",
      source: "local_encrypted",
      encrypted: true,
      encryptionVersion: 2,
      encryptedPath,
      path: encryptedPath,
      previewUrl: tempFilePath,
      extension,
      createdAt: new Date().toISOString(),
    }))
    .catch((error) => unlinkFile(encryptedPath).then(() => { throw error; }));
}

function persistScreenshot(tempFilePath) {
  return prepareScreenshot(tempFilePath).then((preparedPath) => {
    const settings = privacyService.getSettings();
    if (settings.encryptAttachments !== false) {
      return saveEncryptedLocal(preparedPath);
    }
    return saveLocal(preparedPath);
  });
}

function addScreenshots(current = [], maxCount = 6) {
  const normalized = normalizeScreenshots(current);
  const safeMaxCount = Math.min(MAX_SCREENSHOTS, Math.max(0, Number(maxCount) || 0));
  const remain = Math.max(0, safeMaxCount - normalized.length);
  if (!remain) return Promise.resolve(normalized);
  return chooseScreenshots(remain)
    .then((paths) => mapWithConcurrency(paths, MAX_PERSIST_CONCURRENCY, persistScreenshot))
    .catch((error) => {
      const { deleteScreenshot } = require("./screenshotStorageLifecycle.js");
      return Promise.all((error.partialResults || []).map(deleteScreenshot))
        .then(() => { throw error; });
    })
    .then((added) => normalized.concat(normalizeScreenshots(added)).slice(0, safeMaxCount));
}

module.exports = {
  mapWithConcurrency,
  chooseScreenshots,
  saveLocal,
  saveEncryptedLocal,
  persistScreenshot,
  addScreenshots,
};
