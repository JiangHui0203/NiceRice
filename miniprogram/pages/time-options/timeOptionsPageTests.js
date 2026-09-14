const assert = require("assert");
const fs = require("fs");
const path = require("path");

const previousGlobals = {
  wx: global.wx,
  Page: global.Page,
  setTimeout: global.setTimeout,
  clearTimeout: global.clearTimeout,
  hadWx: Object.prototype.hasOwnProperty.call(global, "wx"),
  hadPage: Object.prototype.hasOwnProperty.call(global, "Page"),
};

let nextTimerId = 1;
const timers = new Map();
global.setTimeout = (callback) => {
  const timerId = nextTimerId;
  nextTimerId += 1;
  timers.set(timerId, callback);
  return timerId;
};
global.clearTimeout = (timerId) => timers.delete(timerId);

const redirectCalls = [];
global.wx = {
  getDeviceInfo() { return { platform: "devtools" }; },
  showToast() {},
  showModal() {},
  navigateBack() {},
  redirectTo(options) {
    redirectCalls.push(options.url);
  },
};

const couponStore = require("../../utils/couponStore.js");
const planStore = require("../../utils/planStore.js");
const eventLogger = require("../../utils/eventLogger.js");
const inviteService = require("../../utils/services/inviteService.js");
const notificationService = require("../../utils/services/notificationService.js");
const helper = require("./timeOptionsHelper.js");

const originals = {
  findCoupon: couponStore.findCoupon,
  updateCouponStatus: couponStore.updateCouponStatus,
  findPlan: planStore.findPlan,
  getPlanById: planStore.getPlanById,
  getPlans: planStore.getPlans,
  reschedulePlan: planStore.reschedulePlan,
  attachInvite: planStore.attachInvite,
  logEvent: eventLogger.logEvent,
  createInvite: inviteService.createInvite,
  updateInvitePlan: inviteService.updateInvitePlan,
  requestPlanSubscriptions: notificationService.requestPlanSubscriptions,
  generateTimeOptionsList: helper.generateTimeOptionsList,
  evaluateCustomTimeSlot: helper.evaluateCustomTimeSlot,
};

const coupon = { id: "coupon_1", title: "双人套餐", type: "美食", people: "2人" };
const option = {
  optionId: "slot_1",
  date: "2030-05-17",
  weekday: "周五",
  startTime: "18:30",
  endTime: "20:00",
  label: "周五晚餐",
  range: "18:30-20:00",
  score: 90,
  recommendation: { score: 90 },
};
let currentPlan = null;
let rescheduleCount = 0;

couponStore.findCoupon = () => coupon;
couponStore.updateCouponStatus = () => coupon;
planStore.findPlan = () => currentPlan;
planStore.getPlanById = () => currentPlan;
planStore.getPlans = () => currentPlan ? [currentPlan] : [];
planStore.reschedulePlan = () => {
  rescheduleCount += 1;
  return Object.assign({}, currentPlan, { couponId: coupon.id, selectedTime: option });
};
planStore.attachInvite = () => {};
eventLogger.logEvent = () => {};
inviteService.createInvite = () => Promise.resolve({ id: "invite_1" });
inviteService.updateInvitePlan = () => Promise.resolve({ success: true });
notificationService.requestPlanSubscriptions = () => Promise.resolve({ success: true });
helper.generateTimeOptionsList = () => [option];
helper.evaluateCustomTimeSlot = () => ({ selectedOption: option, selectedIndex: 0 });

let pageConfig = null;
global.Page = (config) => { pageConfig = config; };
const pageModulePath = require.resolve("./index.js");
delete require.cache[pageModulePath];
require(pageModulePath);
assert.ok(pageConfig, "time-options should register a Page config");

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
  const wxml = fs.readFileSync(path.join(__dirname, "index.wxml"), "utf8");
  assert.ok(wxml.includes('wx:if="{{plan || coupon}}"'), "a coupon-only visit must render the time chooser");

  currentPlan = null;
  const couponOnlyPage = createPage();
  couponOnlyPage.onLoad({ couponId: coupon.id });
  assert.strictEqual(couponOnlyPage.data.plan, null);
  assert.strictEqual(couponOnlyPage.data.coupon.id, coupon.id);
  couponOnlyPage.confirmChange();
  couponOnlyPage.confirmChange();
  assert.strictEqual(redirectCalls.length, 1, "double-tapping a coupon-only choice must start one planning flow");
  assert.ok(redirectCalls[0].includes(`/pages/plan-confirm/index?id=${coupon.id}`));
  assert.ok(redirectCalls[0].includes("date=2030-05-17"));
  assert.ok(redirectCalls[0].includes("startTime=18%3A30"));

  currentPlan = {
    id: "plan_1",
    couponId: coupon.id,
    statusCode: "confirmed",
    participants: [{ id: "self", name: "我" }],
    selectedTime: option,
  };
  timers.clear();
  const reschedulePage = createPage();
  reschedulePage.onLoad({ planId: currentPlan.id });
  reschedulePage.confirmChange();
  reschedulePage.confirmChange();
  assert.strictEqual(rescheduleCount, 1, "double-tapping must reschedule exactly once");
  assert.strictEqual(reschedulePage.data.submitting, true, "the visible action must stay disabled until navigation");
  assert.strictEqual(timers.size, 1, "only one delayed navigation should be owned by the page");
  reschedulePage.onUnload();
  assert.strictEqual(timers.size, 0, "unloading must cancel delayed navigation");
  assert.strictEqual(reschedulePage.isSubmitting, false);
} finally {
  couponStore.findCoupon = originals.findCoupon;
  couponStore.updateCouponStatus = originals.updateCouponStatus;
  planStore.findPlan = originals.findPlan;
  planStore.getPlanById = originals.getPlanById;
  planStore.getPlans = originals.getPlans;
  planStore.reschedulePlan = originals.reschedulePlan;
  planStore.attachInvite = originals.attachInvite;
  eventLogger.logEvent = originals.logEvent;
  inviteService.createInvite = originals.createInvite;
  inviteService.updateInvitePlan = originals.updateInvitePlan;
  notificationService.requestPlanSubscriptions = originals.requestPlanSubscriptions;
  helper.generateTimeOptionsList = originals.generateTimeOptionsList;
  helper.evaluateCustomTimeSlot = originals.evaluateCustomTimeSlot;
  delete require.cache[pageModulePath];
  if (previousGlobals.hadWx) global.wx = previousGlobals.wx;
  else delete global.wx;
  if (previousGlobals.hadPage) global.Page = previousGlobals.Page;
  else delete global.Page;
  global.setTimeout = previousGlobals.setTimeout;
  global.clearTimeout = previousGlobals.clearTimeout;
}

console.log("time-options Page flow tests ok");
