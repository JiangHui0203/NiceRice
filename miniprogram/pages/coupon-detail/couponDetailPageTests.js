const assert = require("assert");

const pageModulePath = require.resolve("./index.js");
const couponStore = require("../../utils/couponStore.js");
const planStore = require("../../utils/planStore.js");
const screenshotService = require("../../utils/services/screenshotService.js");

const previousGlobals = {
  hadWx: Object.prototype.hasOwnProperty.call(global, "wx"),
  hadPage: Object.prototype.hasOwnProperty.call(global, "Page"),
  wx: global.wx,
  Page: global.Page,
  setTimeout: global.setTimeout,
};
const originals = {
  updateCouponStatus: couponStore.updateCouponStatus,
  markUsed: couponStore.markUsed,
  deleteCoupon: couponStore.deleteCoupon,
  getPlans: planStore.getPlans,
  createPlanFromRecommendation: planStore.createPlanFromRecommendation,
  completePlan: planStore.completePlan,
  removeTemporaryDirectUsePlan: planStore.removeTemporaryDirectUsePlan,
  updatePlan: planStore.updatePlan,
  resolveScreenshotPreviews: screenshotService.resolveScreenshotPreviews,
  releaseScreenshotPreviews: screenshotService.releaseScreenshotPreviews,
  previewScreenshots: screenshotService.previewScreenshots,
  deleteScreenshot: screenshotService.deleteScreenshot,
};

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function createPage(config) {
  const page = Object.assign({}, config, { data: cloneData(config.data || {}) });
  page.setData = function setData(patch, callback) {
    Object.keys(patch || {}).forEach((key) => {
      const path = key.split(".");
      let target = this.data;
      path.slice(0, -1).forEach((part) => {
        target[part] = target[part] || {};
        target = target[part];
      });
      target[path[path.length - 1]] = patch[key];
    });
    if (typeof callback === "function") callback.call(this);
  };
  return page;
}

function parseSharePayload(value) {
  return JSON.parse(decodeURIComponent(value)).coupon;
}

try {
  const navigations = [];
  global.setTimeout = () => 0;
  global.wx = {
    navigateTo(options) { navigations.push({ type: "navigateTo", url: options.url }); },
    switchTab(options) { navigations.push({ type: "switchTab", url: options.url }); },
    navigateBack() {},
    showModal(options) { options.success({ confirm: true }); },
    showToast() {},
  };

  let pageConfig = null;
  global.Page = (config) => { pageConfig = config; };
  delete require.cache[pageModulePath];
  require(pageModulePath);
  assert.ok(pageConfig, "coupon-detail should register its Page config");

  const page = createPage(pageConfig);
  page.data.coupon = {
    id: "coupon_contract",
    title: "双人餐",
    venue: "测试门店",
    price: "88",
    statusCode: "pending",
    screenshots: [{ id: "shot_private", previewUrl: "/private/shot.jpg", encryptedPath: "/private/shot.enc" }],
    recommendationSnapshot: { internalScore: 99 },
    secret: "must-not-share",
  };

  let persistedStatus = "pending";
  let terminalWrites = 0;
  couponStore.updateCouponStatus = (id, statusCode) => {
    if (statusCode === "used") terminalWrites += 1;
    persistedStatus = statusCode;
    return Object.assign({}, page.data.coupon, { id, statusCode });
  };
  couponStore.markUsed = (id) => {
    terminalWrites += 1;
    persistedStatus = "used";
    return Object.assign({}, page.data.coupon, { id, statusCode: "used" });
  };
  let directUseOptions = null;
  planStore.createPlanFromRecommendation = (coupon, recommendation, participants, options) => {
    directUseOptions = options;
    return { id: "plan_direct", couponId: "coupon_contract", note: "", changeLogs: [] };
  };
  planStore.completePlan = (id, options) => {
    terminalWrites += 1;
    persistedStatus = "used";
    return { id, couponId: "coupon_contract", statusCode: "completed", completion: options };
  };
  planStore.updatePlan = (id, patch) => Object.assign({ id }, patch);
  page.data.useDate = "2026-08-30";
  page.data.useTime = "19:30";
  page.data.useNote = "到店核销";
  page.onShow = () => {};
  page.submitUseDirectly();
  assert.strictEqual(directUseOptions.linkCoupon, false, "direct-use plan creation must defer coupon completion to the terminal transaction");
  assert.strictEqual(directUseOptions.temporaryDirectUse, true);
  assert.strictEqual(persistedStatus, "used", "direct redemption must leave the coupon in its terminal used state after plan creation");
  assert.strictEqual(terminalWrites, 1, "direct redemption must emit exactly one coupon completion record");

  navigations.length = 0;
  planStore.getPlans = () => [];
  page.changeTime();
  assert.deepStrictEqual(navigations.pop(), {
    type: "navigateTo",
    url: "/pages/plan-confirm/index?id=coupon_contract",
  }, "an unplanned coupon must choose a time through plan confirmation instead of opening an empty reschedule page");

  navigations.length = 0;
  planStore.getPlans = () => [{ id: "plan_linked", couponId: "coupon_contract", statusCode: "confirmed" }];
  page.changeTime();
  assert.deepStrictEqual(navigations.pop(), {
    type: "navigateTo",
    url: "/pages/time-options/index?planId=plan_linked&couponId=coupon_contract",
  }, "a linked coupon must pass the plan id when rescheduling");

  navigations.length = 0;
  planStore.getPlans = () => [];
  page.viewLinkedPlan();
  assert.deepStrictEqual(navigations.pop(), {
    type: "switchTab",
    url: "/pages/plan/index",
  }, "the plan tab fallback must use switchTab");

  let screenshotPreviewRequest = null;
  screenshotService.previewScreenshots = (screenshots, index) => {
    screenshotPreviewRequest = { screenshots, index };
  };
  page.previewScreenshot({ currentTarget: { dataset: { index: 0 } } });
  assert.strictEqual(screenshotPreviewRequest.screenshots[0].id, "shot_private");
  assert.strictEqual(screenshotPreviewRequest.index, 0);

  let releasedPreviewIds = [];
  screenshotService.releaseScreenshotPreviews = (screenshots) => {
    releasedPreviewIds = (screenshots || []).map((item) => item.id);
    return Promise.resolve(true);
  };
  page.navigationTimer = 1;
  page.scrollTimer = 2;
  page.highlightTimer = 3;
  page.longPressTimer = 4;
  page.onHide();
  assert.strictEqual(page.hidden, true, "hiding detail page must invalidate asynchronous preview work");
  assert.deepStrictEqual(releasedPreviewIds, ["shot_private"], "hiding detail page must release decrypted previews");
  assert.strictEqual(page.navigationTimer, null, "hiding detail page must clear navigation timers");
  page.hidden = false;

  page.data.coupon = Object.assign({}, page.data.coupon, {
    title: "超值双人餐".repeat(300),
    venue: "跨设备测试门店".repeat(300),
    address: "北京市很长的测试地址".repeat(300),
    dishes: "不应进入分享的菜品".repeat(300),
    note: "不应进入分享的备注".repeat(300),
    tags: Array(100).fill("不应进入分享的标签"),
  });
  const appShare = page.onShareAppMessage();
  assert.ok(appShare.path.length < 1024, `detail share path must stay below 1024 characters, got ${appShare.path.length}`);
  assert.ok(appShare.title.length < 100, "detail share title must be bounded for oversized coupon input");
  const appQuery = appShare.path.split("couponData=")[1];
  const appCoupon = parseSharePayload(appQuery);
  assert.strictEqual(appCoupon.id, "coupon_contract");
  assert.strictEqual(appCoupon.secret, undefined);
  assert.strictEqual(appCoupon.screenshots, undefined, "private screenshot paths must be cropped from detail shares");
  assert.strictEqual(appCoupon.recommendationSnapshot, undefined, "derived recommendation internals must be cropped from detail shares");
  assert.strictEqual(appCoupon.dishes, undefined);
  assert.strictEqual(appCoupon.note, undefined);
  assert.strictEqual(appCoupon.tags, undefined);

  const timelineShare = page.onShareTimeline();
  assert.ok(timelineShare.query.length < 1024, `timeline query must stay below 1024 characters, got ${timelineShare.query.length}`);
  const timelineParams = Object.fromEntries(timelineShare.query.split("&").map((item) => item.split("=")));
  assert.ok(timelineParams.couponData, "timeline shares must carry a coupon snapshot for another device");
  const timelineCoupon = parseSharePayload(timelineParams.couponData);
  assert.strictEqual(timelineCoupon.id, "coupon_contract");
  assert.strictEqual(timelineCoupon.secret, undefined);

  const deletedScreenshotIds = [];
  let deletedCouponId = "";
  page.data.coupon.screenshots.push({ id: "shot_second", previewUrl: "/private/second.jpg" });
  screenshotService.deleteScreenshot = (item) => {
    deletedScreenshotIds.push(item.id);
    return Promise.resolve(true);
  };
  couponStore.deleteCoupon = (id) => {
    deletedCouponId = id;
    return true;
  };
  page.deleteCoupon();
  assert.strictEqual(deletedCouponId, "coupon_contract", "coupon deletion must not wait for asynchronous file cleanup");
  assert.deepStrictEqual(deletedScreenshotIds, ["shot_private", "shot_second"], "deleting a coupon must clean every persisted screenshot through screenshotService");
  page.hidden = true;

  console.log("coupon detail Page contract tests ok");
} finally {
  couponStore.updateCouponStatus = originals.updateCouponStatus;
  couponStore.markUsed = originals.markUsed;
  couponStore.deleteCoupon = originals.deleteCoupon;
  planStore.getPlans = originals.getPlans;
  planStore.createPlanFromRecommendation = originals.createPlanFromRecommendation;
  planStore.completePlan = originals.completePlan;
  planStore.removeTemporaryDirectUsePlan = originals.removeTemporaryDirectUsePlan;
  planStore.updatePlan = originals.updatePlan;
  screenshotService.resolveScreenshotPreviews = originals.resolveScreenshotPreviews;
  screenshotService.releaseScreenshotPreviews = originals.releaseScreenshotPreviews;
  screenshotService.previewScreenshots = originals.previewScreenshots;
  screenshotService.deleteScreenshot = originals.deleteScreenshot;
  delete require.cache[pageModulePath];
  if (previousGlobals.hadWx) global.wx = previousGlobals.wx;
  else delete global.wx;
  if (previousGlobals.hadPage) global.Page = previousGlobals.Page;
  else delete global.Page;
  global.setTimeout = previousGlobals.setTimeout;
}
