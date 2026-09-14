const assert = require("assert");
const fs = require("fs");
const path = require("path");

const indexModulePath = require.resolve("./index.js");
const hadWx = Object.prototype.hasOwnProperty.call(global, "wx");
const hadPage = Object.prototype.hasOwnProperty.call(global, "Page");
const previousWx = global.wx;
const previousPage = global.Page;
const screenshotService = require("../../utils/services/screenshotService.js");
const originalPreviewScreenshots = screenshotService.previewScreenshots;

function formatLocalDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function expectedDateAfter(days, baseDate) {
  const target = new Date(baseDate.getTime());
  target.setDate(target.getDate() + days);
  return formatLocalDate(target);
}

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

function assignDataPath(data, key, value) {
  const segments = key.split(".");
  let cursor = data;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!cursor[segment] || typeof cursor[segment] !== "object") cursor[segment] = {};
    cursor = cursor[segment];
  }
  cursor[segments[segments.length - 1]] = value;
}

function createPageInstance(pageConfig) {
  const page = Object.assign({}, pageConfig, { data: cloneData(pageConfig.data) });
  page.setData = function setData(patch, callback) {
    Object.keys(patch || {}).forEach((key) => assignDataPath(this.data, key, patch[key]));
    if (typeof callback === "function") callback.call(this);
  };
  return page;
}

function readWxmlEventHandlers() {
  const wxmlPath = path.join(__dirname, "index.wxml");
  const wxml = fs.readFileSync(wxmlPath, "utf8");
  const handlerPattern = /\b(?:bind|catch)(?:[:A-Za-z0-9_-]+)\s*=\s*["']([A-Za-z_$][\w$]*)["']/g;
  return [...new Set(Array.from(wxml.matchAll(handlerPattern), (match) => match[1]))];
}

try {
  let previewRequest = null;
  screenshotService.previewScreenshots = (screenshots, index) => {
    previewRequest = { screenshots, index };
  };
  const storage = new Map([
    ["life_helper_reorder_coupon_temp", {
      id: "old_coupon_id",
      title: "再买一张测试券",
      venue: "测试门店",
      type: "烧烤",
      platform: "美团",
      people: "2人",
      price: "88",
      originalPrice: "128",
      dishes: "烤肉 2份",
    }],
  ]);

  global.wx = {
    getStorageSync(key) {
      return storage.has(key) ? storage.get(key) : "";
    },
    removeStorageSync(key) {
      storage.delete(key);
    },
    showToast() {},
    vibrateShort() {},
  };

  let pageConfig = null;
  global.Page = (config) => {
    pageConfig = config;
  };

  delete require.cache[indexModulePath];
  require(indexModulePath);
  assert.ok(pageConfig, "coupon-edit/index.js should register a Page config");

  const eventHandlers = readWxmlEventHandlers();
  assert.ok(eventHandlers.length > 0, "coupon-edit/index.wxml should declare event handlers");
  const missingHandlers = eventHandlers.filter((name) => typeof pageConfig[name] !== "function");
  assert.deepStrictEqual(
    missingHandlers,
    [],
    `all WXML bind/catch handlers should exist on the composed Page: ${missingHandlers.join(", ")}`,
  );

  const page = createPageInstance(pageConfig);
  const reorderBaseDate = new Date();
  assert.doesNotThrow(() => page.onLoad({ mode: "reorder" }));
  assert.strictEqual(page.data.form.id, "", "reorder mode should create a new coupon id");
  assert.strictEqual(page.data.form.title, "再买一张测试券");
  assert.strictEqual(page.data.form.expireDate, expectedDateAfter(14, reorderBaseDate));
  assert.strictEqual(storage.has("life_helper_reorder_coupon_temp"), false);

  const quickDateBase = new Date();
  page.applyQuickDate({ currentTarget: { dataset: { days: "7" } } });
  assert.strictEqual(
    page.data.form.expireDate,
    expectedDateAfter(7, quickDateBase),
    "the data-days=7 shortcut should move the expiry date forward by seven days",
  );

  page.refreshLocationSummary({
    venue: "零度坐标测试店",
    latitude: 0,
    longitude: 0,
  });
  assert.strictEqual(page.data.locationSummary, "零度坐标测试店");
  assert.strictEqual(
    page.data.locationBadge,
    "坐标已保存",
    "zero latitude/longitude should still be treated as valid coordinates",
  );

  page.data.form.screenshots = [
    { id: "shot_first", previewUrl: "/first.jpg" },
    { id: "shot_second", previewUrl: "/second.jpg" },
  ];
  page.previewScreenshot({ currentTarget: { dataset: { index: "1" } } });
  assert.strictEqual(previewRequest.index, 1, "点击第二张缩略图应从第二张开始预览");
  assert.strictEqual(previewRequest.screenshots[1].id, "shot_second");

  console.log("coupon edit composed Page contract tests ok");
} finally {
  screenshotService.previewScreenshots = originalPreviewScreenshots;
  delete require.cache[indexModulePath];
  if (hadWx) global.wx = previousWx;
  else delete global.wx;
  if (hadPage) global.Page = previousPage;
  else delete global.Page;
}
