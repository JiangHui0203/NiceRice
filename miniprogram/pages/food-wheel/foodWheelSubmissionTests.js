const assert = require("assert");

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

let navigationMode = "fail";
let navigationCount = 0;
global.wx = {
  getDeviceInfo() { return { platform: "devtools" }; },
  navigateTo(options) {
    navigationCount += 1;
    if (navigationMode === "fail" && typeof options.fail === "function") options.fail({ errMsg: "navigateTo:fail" });
    if (navigationMode === "success" && typeof options.success === "function") options.success({ errMsg: "navigateTo:ok" });
    if (typeof options.complete === "function") options.complete({ errMsg: `navigateTo:${navigationMode}` });
  },
  showToast() {},
};

const planStore = require("../../utils/planStore.js");
const eventLogger = require("../../utils/eventLogger.js");
const originalCreateManualPlanFromSpin = planStore.createManualPlanFromSpin;
const originalLogEvent = eventLogger.logEvent;

let createCount = 0;
planStore.createManualPlanFromSpin = () => {
  createCount += 1;
  return { id: `plan_${createCount}` };
};
eventLogger.logEvent = () => {};

let pageConfig = null;
global.Page = (config) => { pageConfig = config; };
const pageModulePath = require.resolve("./index.js");
delete require.cache[pageModulePath];
require(pageModulePath);
assert.ok(pageConfig, "food-wheel should register its Page config");

function createPage() {
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data || {})),
  });
  page.setData = function setData(patch, callback) {
    Object.assign(this.data, patch || {});
    if (typeof callback === "function") callback.call(this);
  };
  page.onLoad({});
  return page;
}

function runOnlyTimer() {
  assert.strictEqual(timers.size, 1, "only one navigation timer should be pending");
  const [timerId, callback] = timers.entries().next().value;
  timers.delete(timerId);
  callback();
}

try {
  const addPage = createPage();
  addPage.data.result = { id: "candidate_1", title: "拉面", source: "custom" };

  addPage.addResultToPlan();
  addPage.addResultToPlan();
  assert.strictEqual(createCount, 1, "double-tapping add must create exactly one plan");
  assert.strictEqual(addPage.planSubmitting, true);
  assert.strictEqual(addPage.data.planSubmitting, true, "the visible action should be disabled while submitting");
  runOnlyTimer();
  assert.strictEqual(navigationCount, 1);
  assert.strictEqual(addPage.planSubmitting, false, "failed navigation must release the lock");
  assert.strictEqual(addPage.data.planSubmitting, false);

  navigationMode = "success";
  addPage.addResultToPlan();
  assert.strictEqual(createCount, 1, "retrying failed navigation must reuse the plan already created");
  assert.strictEqual(navigationCount, 2);
  assert.strictEqual(addPage.planSubmitting, false);
  assert.strictEqual(timers.size, 0);

  const quickPage = createPage();
  quickPage.data.result = { id: "candidate_2", title: "盖饭", source: "custom" };
  const slotEvent = { currentTarget: { dataset: { slot: "today_dinner" } } };
  quickPage.quickScheduleSlot(slotEvent);
  quickPage.quickScheduleSlot(slotEvent);
  assert.strictEqual(createCount, 2, "double-tapping a quick slot must create exactly one plan");
  assert.strictEqual(timers.size, 1);

  quickPage.onHide();
  assert.strictEqual(timers.size, 0, "hiding must cancel delayed navigation");
  assert.strictEqual(quickPage.planSubmitting, false);
  assert.strictEqual(quickPage.data.planSubmitting, false);
  assert.strictEqual(navigationCount, 2, "a cancelled delayed navigation must not run after hide");
  quickPage.onShow();
  quickPage.quickScheduleSlot(slotEvent);
  assert.strictEqual(createCount, 2, "retrying after lifecycle cancellation must reuse the existing plan");
  assert.strictEqual(navigationCount, 3);

  const unloadPage = createPage();
  unloadPage.data.result = { id: "candidate_3", title: "火锅", source: "custom" };
  unloadPage.addResultToPlan();
  assert.strictEqual(timers.size, 1);
  unloadPage.onUnload();
  assert.strictEqual(timers.size, 0, "unloading must cancel delayed navigation");
  assert.strictEqual(unloadPage.planSubmitting, false, "unloading must release the internal lock without setData");
} finally {
  planStore.createManualPlanFromSpin = originalCreateManualPlanFromSpin;
  eventLogger.logEvent = originalLogEvent;
  delete require.cache[pageModulePath];
  if (previousGlobals.hadWx) global.wx = previousGlobals.wx;
  else delete global.wx;
  if (previousGlobals.hadPage) global.Page = previousGlobals.Page;
  else delete global.Page;
  global.setTimeout = previousGlobals.setTimeout;
  global.clearTimeout = previousGlobals.clearTimeout;
}

console.log("food wheel submission guard tests ok");
