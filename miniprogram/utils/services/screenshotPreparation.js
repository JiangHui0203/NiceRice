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

function compressScreenshot(filePath) {
  const api = getWx();
  if (!api || typeof api.compressImage !== "function") return Promise.resolve(filePath);
  return new Promise((resolve) => {
    api.compressImage({
      src: filePath,
      quality: 72,
      success(res) {
        resolve(res && res.tempFilePath || filePath);
      },
      fail() {
        resolve(filePath);
      },
    });
  });
}

function validateImageDimensions(filePath) {
  const api = getWx();
  if (!api || typeof api.getImageInfo !== "function") return Promise.resolve(filePath);
  return new Promise((resolve, reject) => {
    api.getImageInfo({
      src: filePath,
      success(res) {
        const width = Number(res && res.width);
        const height = Number(res && res.height);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          const error = new Error("无法确认图片尺寸，请重新选择后重试");
          error.code = "screenshot_dimensions_unavailable";
          reject(error);
          return;
        }
        if (width * height > MAX_SCREENSHOT_PIXELS) {
          const error = new Error("图片分辨率过高，请缩小后重试");
          error.code = "screenshot_dimensions_too_large";
          reject(error);
          return;
        }
        resolve(filePath);
      },
      fail() {
        const error = new Error("无法确认图片尺寸，请重新选择后重试");
        error.code = "screenshot_dimensions_unavailable";
        reject(error);
      },
    });
  });
}

function prepareScreenshot(filePath) {
  return validateImageDimensions(filePath).then(compressScreenshot).then((preparedPath) => (
    validateImageDimensions(preparedPath).then(() => getFileSize(preparedPath).then((size) => {
      if (!Number.isFinite(size) || size < 0) {
        const error = new Error("无法确认图片大小，请重新选择后重试");
        error.code = "screenshot_size_unavailable";
        throw error;
      }
      if (size > MAX_SCREENSHOT_BYTES) {
        const error = new Error("图片过大，请压缩后重试");
        error.code = "screenshot_too_large";
        throw error;
      }
      return preparedPath;
    }))
  ));
}

module.exports = {
  compressScreenshot,
  validateImageDimensions,
  prepareScreenshot,
};
