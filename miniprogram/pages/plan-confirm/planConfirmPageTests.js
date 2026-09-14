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
  navigateBack() {},
};

const couponStore = require("../../utils/couponStore.js");
const planStore = require("../../utils/planStore.js");
const recommendation = require("../../utils/recommendation.js");
const weatherService = require("../../utils/services/weatherService.js");
const friendStore = require("../../utils/friendStore.js");

const originals = {
  findCoupon: couponStore.findCoupon,
  getPlans: planStore.getPlans,
  buildRecommendationContext: recommendation.buildRecommendationContext,
  generateRecommendation: recommendation.generateRecommendation,
  generateTimeOptions: recommendation.generateTimeOptions,
  mergeCouponRecommendation: recommendation.mergeCouponRecommendation,
  evaluateCustomSlot: recommendation.evaluateCustomSlot,
  getWeather: weatherService.getWeather,
  readFriends: friendStore.readFriends,
};

const coupon = {
  id: "coupon_date",
  title: "指定日期套餐",
  type: "美食",
  people: "1人",
  travelTime: "20分钟",
  usageRules: {},
  refundInfo: {},
};
const generatedOption = {
  optionId: "generated",
  date: "2040-01-02",
  weekday: "周一",
  startTime: "18:30",
  endTime: "20:00",
  label: "默认推荐",
  range: "18:30-20:00",
  recommendation: { score: 80 },
};

couponStore.findCoupon = () => coupon;
planStore.getPlans = () => [];
recommendation.buildRecommendationContext = () => ({});
recommendation.generateRecommendation = () => ({ score: 80, warnings: [] });
recommendation.generateTimeOptions = () => [generatedOption];
recommendation.mergeCouponRecommendation = (item) => Object.assign({}, item);
recommendation.evaluateCustomSlot = (item, date, startTime) => ({
  optionId: "custom",
  date,
  weekday: "周五",
  startTime,
  endTime: "20:00",
  label: "指定时间",
  range: `${startTime}-20:00`,
  recommendation: { score: 88, warnings: [] },
});
weatherService.getWeather = () => ({ title: "晴", tips: ["适合出行"] });
friendStore.readFriends = () => [];

let pageConfig = null;
global.Page = (config) => { pageConfig = config; };
const pageModulePath = require.resolve("./index.js");
delete require.cache[pageModulePath];
require(pageModulePath);
assert.ok(pageConfig, "plan-confirm should register a Page config");

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
  const requestedPage = createPage();
  requestedPage.onLoad({ id: coupon.id, date: "2030-05-17", startTime: "14:30" });
  assert.strictEqual(requestedPage.data.isCustomMode, true, "a valid route date must be selected explicitly");
  assert.strictEqual(requestedPage.data.customDate, "2030-05-17");
  assert.strictEqual(requestedPage.data.selectedTime.date, "2030-05-17");
  assert.strictEqual(requestedPage.data.selectedTime.startTime, "14:30");

  const dateOnlyPage = createPage();
  dateOnlyPage.onLoad({ id: coupon.id, date: "2030-05-18" });
  assert.strictEqual(dateOnlyPage.data.isCustomMode, true, "the add-today flow only supplies a date and must still select it");
  assert.strictEqual(dateOnlyPage.data.selectedTime.date, "2030-05-18");
  assert.strictEqual(dateOnlyPage.data.selectedTime.startTime, "18:30");

  const invalidPage = createPage();
  invalidPage.onLoad({ id: coupon.id, date: "2030-02-30", startTime: "99:99" });
  assert.strictEqual(invalidPage.data.isCustomMode, false, "an impossible calendar date must be ignored");
  assert.strictEqual(invalidPage.data.selectedTime.date, generatedOption.date);
} finally {
  couponStore.findCoupon = originals.findCoupon;
  planStore.getPlans = originals.getPlans;
  recommendation.buildRecommendationContext = originals.buildRecommendationContext;
  recommendation.generateRecommendation = originals.generateRecommendation;
  recommendation.generateTimeOptions = originals.generateTimeOptions;
  recommendation.mergeCouponRecommendation = originals.mergeCouponRecommendation;
  recommendation.evaluateCustomSlot = originals.evaluateCustomSlot;
  weatherService.getWeather = originals.getWeather;
  friendStore.readFriends = originals.readFriends;
  delete require.cache[pageModulePath];
  if (previousGlobals.hadWx) global.wx = previousGlobals.wx;
  else delete global.wx;
  if (previousGlobals.hadPage) global.Page = previousGlobals.Page;
  else delete global.Page;
}

console.log("plan-confirm route date tests ok");
