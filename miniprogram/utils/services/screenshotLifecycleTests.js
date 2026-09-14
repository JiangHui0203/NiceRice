const assert = require("assert");

const storage = new Map();
const privacyService = require("../privacyService.js");
const screenshotService = require("./screenshotService.js");

function waitForImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function run() {
  let chooseOptions = null;
  let activeSaves = 0;
  let maxActiveSaves = 0;
  storage.set("life_helper_privacy_settings", { encryptAttachments: false });

  global.wx = {
    env: { USER_DATA_PATH: "/user" },
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    chooseMedia(options) {
      chooseOptions = options;
      options.success({
        tempFiles: ["a", "b", "c", "d"].map((name) => ({ tempFilePath: `/tmp/${name}.jpg` })),
      });
    },
    compressImage(options) {
      setImmediate(() => options.success({ tempFilePath: options.src.replace("/tmp/", "/tmp/compressed-") }));
    },
    getFileInfo(options) {
      options.success({ size: 1024 });
    },
    getFileSystemManager() {
      return {
        readFile(options) {
          options.success({ data: new Uint8Array([1, 2, 3, 4]).buffer });
        },
        writeFile(options) {
          activeSaves += 1;
          maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
          setImmediate(() => {
            activeSaves -= 1;
            options.success();
          });
        },
        unlink(options) { options.success(); },
        stat(options) { options.success({ stats: { size: 1024 } }); },
      };
    },
    saveFile(options) {
      activeSaves += 1;
      maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
      setImmediate(() => {
        activeSaves -= 1;
        options.success({ savedFilePath: options.tempFilePath.replace("/tmp/", "/saved/") });
      });
    },
  };

  const added = await screenshotService.addScreenshots([], 6);
  assert.deepStrictEqual(chooseOptions.sizeType, ["compressed"], "image selection should request compressed media");
  assert.ok(maxActiveSaves <= screenshotService.MAX_PERSIST_CONCURRENCY, "screenshot persistence must be concurrency-limited");
  assert.strictEqual(new Set(added.map((item) => item.id)).size, added.length, "concurrent screenshot ids must be unique");

  global.wx.chooseMedia = (options) => options.success({ tempFiles: [{ tempFilePath: "/tmp/huge.jpg" }] });
  global.wx.getFileInfo = (options) => options.success({ size: screenshotService.MAX_SCREENSHOT_BYTES + 1 });
  await assert.rejects(
    () => screenshotService.addScreenshots([], 1),
    (error) => error && error.code === "screenshot_too_large",
    "oversized compressed screenshots must be rejected before Base64 encryption",
  );

  const unlinked = [];
  const written = [];
  const encrypted = privacyService.encryptText("ZmFrZS1pbWFnZQ==", "coupon_screenshot");
  let encryptedPayload = JSON.stringify({ encrypted });
  global.wx.getFileSystemManager = () => ({
    readFile(options) {
      if (options.encoding === "utf8") {
        options.success({ data: encryptedPayload });
        return;
      }
      options.success({ data: new TextEncoder().encode(encryptedPayload).buffer });
    },
    writeFile(options) {
      written.push(options.filePath);
      options.success();
    },
    unlink(options) {
      unlinked.push(options.filePath);
      options.success();
    },
    readdir(options) {
      options.success({ files: [] });
    },
  });

  const resolved = await screenshotService.resolveScreenshotPreviews([{
    id: "encrypted_lifecycle",
    encrypted: true,
    encryptedPath: "/user/shot_encrypted_lifecycle.jpg.enc",
    path: "/user/shot_encrypted_lifecycle.jpg.enc",
    extension: "jpg",
  }]);
  assert.ok(resolved[0].tempPreviewPath.includes("/user/preview_"));
  assert.ok(written.includes(resolved[0].tempPreviewPath));
  await screenshotService.releaseScreenshotPreviews(resolved);
  assert.ok(unlinked.includes(resolved[0].tempPreviewPath), "plaintext preview must be releasable on page hide/unload");

  const writesBeforeInvalidDecrypt = written.length;
  encryptedPayload = JSON.stringify({ encrypted: "" });
  const invalidPreview = await screenshotService.resolveScreenshotPreviews([{
    id: "invalid_encrypted_payload",
    encrypted: true,
    encryptedPath: "/user/shot_invalid.enc",
    path: "/user/shot_invalid.enc",
  }]);
  assert.strictEqual(invalidPreview[0].tempPreviewPath, "", "failed decryption must not expose a non-existent preview path");
  assert.strictEqual(written.length, writesBeforeInvalidDecrypt);

  await screenshotService.deleteScreenshot({
    id: "legacy_local_file",
    source: "local",
    path: "wxfile://usr/legacy-local.jpg",
    previewUrl: "wxfile://usr/legacy-local.jpg",
  });
  assert.strictEqual(unlinked.includes("wxfile://usr/legacy-local.jpg"), false, "unmanaged paths must never be deleted");
  await screenshotService.deleteScreenshot({
    id: "managed_local_file",
    source: "local",
    savedFilePath: "/user/shot_managed_local.jpg",
    path: "/user/shot_managed_local.jpg",
    previewUrl: "/user/shot_managed_local.jpg",
  });
  assert.ok(unlinked.includes("/user/shot_managed_local.jpg"), "managed local paths should be deleted with their metadata");

  await waitForImmediate();
}

run().then(() => {
  console.log("screenshot lifecycle tests ok");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
