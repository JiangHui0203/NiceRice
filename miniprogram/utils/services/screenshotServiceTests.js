const assert = require("assert");

const previousWx = global.wx;
const hadWx = Object.prototype.hasOwnProperty.call(global, "wx");

global.wx = {
  getStorageSync() { return ""; },
  setStorageSync() {},
};

const screenshotService = require("./screenshotService.js");
const couponEditHelper = require("../../pages/coupon-edit/couponEditHelper.js");

async function run() {
  const screenshots = [
    {
      id: "legacy_encrypted_without_path",
      encrypted: true,
      path: "/private/legacy.enc",
    },
    {
      id: "regular_preview",
      path: "/private/second.jpg",
      previewUrl: "/private/second.jpg",
    },
  ];

  const urls = await screenshotService.resolvePreviewUrls(screenshots);
  assert.deepStrictEqual(urls, ["", "/private/second.jpg"], "预览 URL 应保留与截图相同的索引");

  const resolved = await couponEditHelper.resolveScreenshotPreviews(screenshots);
  assert.strictEqual(resolved.length, 2);
  assert.strictEqual(typeof resolved[0], "object", "编辑页应保留截图元数据对象");
  assert.strictEqual(resolved[0].id, "legacy_encrypted_without_path");
  assert.strictEqual(resolved[1].previewUrl, "/private/second.jpg");

  console.log("screenshot service preview tests ok");
}

run().finally(() => {
  if (hadWx) global.wx = previousWx;
  else delete global.wx;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
