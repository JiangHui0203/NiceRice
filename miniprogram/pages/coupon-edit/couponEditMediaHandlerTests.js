const assert = require("assert");

const screenshotService = require("../../utils/services/screenshotService.js");
const mediaHandlers = require("./handlers/mediaLocationHandlers.js");

const originals = {
  deleteScreenshot: screenshotService.deleteScreenshot,
  releaseScreenshotPreviews: screenshotService.releaseScreenshotPreviews,
  resolveScreenshotPreviews: screenshotService.resolveScreenshotPreviews,
};

function assignDataPath(data, key, value) {
  const parts = key.split(".");
  let cursor = data;
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part]) cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[parts[parts.length - 1]] = value;
}

function createPage(screenshots) {
  return Object.assign({}, mediaHandlers, {
    hidden: false,
    unloaded: false,
    sessionAddedScreenshots: Object.create(null),
    pendingDeletedScreenshots: Object.create(null),
    originalScreenshotIds: new Set(),
    data: { form: { screenshots: screenshots.slice() } },
    setData(patch, callback) {
      Object.keys(patch || {}).forEach((key) => assignDataPath(this.data, key, patch[key]));
      if (callback) callback.call(this);
    },
  });
}

async function run() {
  const deleted = [];
  screenshotService.deleteScreenshot = (item) => {
    deleted.push(item);
    return Promise.resolve(true);
  };
  screenshotService.resolveScreenshotPreviews = (items) => Promise.resolve(items);
  screenshotService.releaseScreenshotPreviews = () => Promise.resolve(true);

  const removePage = createPage([
    { id: "keep", previewUrl: "/keep.jpg" },
    { id: "remove", encrypted: true, encryptedPath: "/remove.enc", path: "/remove.enc" },
  ]);
  removePage.removeScreenshot({ currentTarget: { dataset: { index: "1" } } });
  await Promise.resolve();
  assert.strictEqual(removePage.data.form.screenshots.length, 1);
  assert.strictEqual(deleted[0].id, "remove", "removing screenshot metadata must also delete its physical files");

  const pending = [];
  screenshotService.resolveScreenshotPreviews = (items) => new Promise((resolve) => {
    pending.push({ items, resolve });
  });
  const racePage = createPage([{ id: "old", encrypted: true, encryptedPath: "/old.enc", path: "/old.enc" }]);
  const oldRequest = racePage.refreshScreenshotPreviews();
  racePage.data.form.screenshots = [{ id: "new", encrypted: true, encryptedPath: "/new.enc", path: "/new.enc" }];
  const newRequest = racePage.refreshScreenshotPreviews();

  pending[1].resolve([{ id: "new", tempPreviewPath: "/new-preview.jpg", previewUrl: "/new-preview.jpg" }]);
  await newRequest;
  pending[0].resolve([{ id: "old", tempPreviewPath: "/old-preview.jpg", previewUrl: "/old-preview.jpg" }]);
  await oldRequest;
  assert.strictEqual(racePage.data.form.screenshots[0].id, "new", "an older async preview must not overwrite newer page data");

  let released = null;
  screenshotService.releaseScreenshotPreviews = (items) => {
    released = items;
    return Promise.resolve(true);
  };
  racePage.onHide();
  assert.strictEqual(racePage.hidden, true);
  assert.strictEqual(released[0].id, "new", "page hide must release plaintext preview files");
}

run().finally(() => {
  Object.assign(screenshotService, originals);
}).then(() => {
  console.log("coupon edit media handler tests ok");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
