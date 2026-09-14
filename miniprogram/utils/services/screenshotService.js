const part1 = require("./screenshotContext.js");
const part2 = require("./screenshotNormalizer.js");
const part3 = require("./screenshotFileCodec.js");
const part4 = require("./screenshotPreparation.js");
const part5 = require("./screenshotAcquisition.js");
const part6 = require("./screenshotPreviewResolver.js");
const part7 = require("./screenshotPreviewLifecycle.js");
const part8 = require("./screenshotStorageLifecycle.js");

const parts = Object.assign({}, part1, part2, part3, part4, part5, part6, part7, part8);

module.exports = {
  MAX_ENCRYPTED_SCREENSHOT_BYTES: parts.MAX_ENCRYPTED_SCREENSHOT_BYTES,
  MAX_PERSIST_CONCURRENCY: parts.MAX_PERSIST_CONCURRENCY,
  MAX_SCREENSHOTS: parts.MAX_SCREENSHOTS,
  MAX_SCREENSHOT_BYTES: parts.MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_PIXELS: parts.MAX_SCREENSHOT_PIXELS,
  PREVIEW_TTL_MS: parts.PREVIEW_TTL_MS,
  addScreenshots: parts.addScreenshots,
  cleanupOrphanedPreviews: parts.cleanupOrphanedPreviews,
  deleteScreenshot: parts.deleteScreenshot,
  normalizeScreenshot: parts.normalizeScreenshot,
  normalizeScreenshots: parts.normalizeScreenshots,
  persistTempScreenshot: parts.persistTempScreenshot,
  resolveScreenshotPreviews: parts.resolveScreenshotPreviews,
  previewScreenshots: parts.previewScreenshots,
  retainScreenshotPreviews: parts.retainScreenshotPreviews,
  releaseScreenshotPreviews: parts.releaseScreenshotPreviews,
  resolvePreviewUrls: parts.resolvePreviewUrls,
  serializeScreenshots: parts.serializeScreenshots,
};
