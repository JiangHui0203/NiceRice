const {
  PREVIEW_TTL_MS,
  previewCleanupTimers,
  previewPathCache,
  previewOwnerPaths,
} = require("./screenshotContext.js");
const { unlinkFile } = require("./screenshotFileCodec.js");
const { isManagedPreviewPath } = require("./screenshotPathPolicy.js");

function forgetPreviewPath(filePath) {
  Object.keys(previewPathCache).forEach((encryptedPath) => {
    if (previewPathCache[encryptedPath] === filePath) delete previewPathCache[encryptedPath];
  });
}

function isPreviewOwned(filePath) {
  return Object.keys(previewOwnerPaths).some((ownerId) => previewOwnerPaths[ownerId].has(filePath));
}

function releasePreviewPath(filePath) {
  if (!isManagedPreviewPath(filePath)) return Promise.resolve(false);
  if (isPreviewOwned(filePath)) return Promise.resolve(false);
  if (previewCleanupTimers[filePath]) {
    clearTimeout(previewCleanupTimers[filePath]);
    delete previewCleanupTimers[filePath];
  }
  forgetPreviewPath(filePath);
  return unlinkFile(filePath);
}

function schedulePreviewCleanup(filePath) {
  if (!isManagedPreviewPath(filePath) || isPreviewOwned(filePath)) return;
  if (previewCleanupTimers[filePath]) clearTimeout(previewCleanupTimers[filePath]);
  const timer = setTimeout(() => {
    delete previewCleanupTimers[filePath];
    forgetPreviewPath(filePath);
    unlinkFile(filePath);
  }, PREVIEW_TTL_MS);
  if (timer && typeof timer.unref === "function") timer.unref();
  previewCleanupTimers[filePath] = timer;
}

module.exports = {
  forgetPreviewPath,
  isPreviewOwned,
  releasePreviewPath,
  schedulePreviewCleanup,
};
