const assert = require("assert");

const previousGlobals = {
  wx: global.wx,
  Page: global.Page,
  hadWx: Object.prototype.hasOwnProperty.call(global, "wx"),
  hadPage: Object.prototype.hasOwnProperty.call(global, "Page"),
};

global.wx = {
  getDeviceInfo() { return { platform: "devtools" }; },
  showToast() {},
};

const couponStore = require("../../utils/couponStore.js");
const planStore = require("../../utils/planStore.js");
const recommendation = require("../../utils/recommendation.js");
const routeService = require("../../utils/services/routeService.js");

const originals = {
  getAllCoupons: couponStore.getAllCoupons,
  normalizeCoupon: couponStore.normalizeCoupon,
  getPlans: planStore.getPlans,
  buildRecommendationContext: recommendation.buildRecommendationContext,
  getTopRecommendations: recommendation.getTopRecommendations,
  getActiveRouteOrigin: routeService.getActiveRouteOrigin,
  getDynamicDistance: routeService.getDynamicDistance,
};

couponStore.getAllCoupons = () => [];
couponStore.normalizeCoupon = (coupon) => coupon;
planStore.getPlans = () => [];
recommendation.buildRecommendationContext = () => ({});
recommendation.getTopRecommendations = () => [];
routeService.getActiveRouteOrigin = () => null;
routeService.getDynamicDistance = () => ({ distanceKmText: "", travelTimeText: "" });

let pageConfig = null;
global.Page = (config) => { pageConfig = config; };
const pageModulePath = require.resolve("./index.js");
delete require.cache[pageModulePath];
require(pageModulePath);
assert.ok(pageConfig, "coupons should register a composed Page config");

function createPage() {
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data || {})),
  });
  page.setData = function setData(patch, callback) {
    Object.assign(this.data, patch || {});
    if (typeof callback === "function") callback.call(this);
  };
  return page;
}

try {
  const page = createPage();
  assert.strictEqual(page.data.couponDataReady, false, "empty state must stay hidden before the first repository read");
  page.loadCoupons();
  assert.strictEqual(page.data.couponDataReady, true, "a valid repository read must unlock the real empty state");
  assert.deepStrictEqual(page.data.coupons, [], "a valid empty repository must remain empty");
  assert.deepStrictEqual(page.data.filteredCoupons, []);

  page.onHide();
  assert.strictEqual(page.data.couponDataReady, false, "hidden pages must not expose cleared data as a real empty repository");
  page.onShow();
  assert.strictEqual(page.data.couponDataReady, true, "returning to the coupon tab must reveal empty state only after reloading");

  page.data.showFilters = false;
  page.toggleFilters({ type: "beforeleave" });
  assert.strictEqual(page.data.showFilters, false, "beforeleave must close idempotently instead of reopening");
  page.toggleFilters({ type: "tap" });
  assert.strictEqual(page.data.showFilters, true, "the filter entry should still toggle the drawer open");
} finally {
  couponStore.getAllCoupons = originals.getAllCoupons;
  couponStore.normalizeCoupon = originals.normalizeCoupon;
  planStore.getPlans = originals.getPlans;
  recommendation.buildRecommendationContext = originals.buildRecommendationContext;
  recommendation.getTopRecommendations = originals.getTopRecommendations;
  routeService.getActiveRouteOrigin = originals.getActiveRouteOrigin;
  routeService.getDynamicDistance = originals.getDynamicDistance;
  delete require.cache[pageModulePath];
  if (previousGlobals.hadWx) global.wx = previousGlobals.wx;
  else delete global.wx;
  if (previousGlobals.hadPage) global.Page = previousGlobals.Page;
  else delete global.Page;
}

console.log("coupons empty-state and drawer tests ok");
