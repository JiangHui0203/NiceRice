const assert = require("assert");

const previousGlobals = {
  wx: global.wx,
  Page: global.Page,
  clearTimeout: global.clearTimeout,
  hadWx: Object.prototype.hasOwnProperty.call(global, "wx"),
  hadPage: Object.prototype.hasOwnProperty.call(global, "Page"),
};

const clearedTimers = [];
global.clearTimeout = (timerId) => clearedTimers.push(timerId);
global.wx = {
  getDeviceInfo() { return { platform: "devtools" }; },
  showToast() {},
};

let pageConfig = null;
global.Page = (config) => { pageConfig = config; };
const pageModulePath = require.resolve("./index.js");
delete require.cache[pageModulePath];
require(pageModulePath);
assert.ok(pageConfig, "food-wheel should register its composed Page config");

function createPage(config) {
  const page = Object.assign({}, config, {
    data: JSON.parse(JSON.stringify(config.data || {})),
  });
  page.setData = function setData(patch, callback) {
    Object.assign(this.data, patch || {});
    if (typeof callback === "function") callback.call(this);
  };
  return page;
}

const page = createPage(pageConfig);
page.data.spinning = true;
page.currentAngleDegrees = 725;
page.tickTimeoutId = 11;
page.spinTimeoutId = 12;
let canvasClears = 0;
page.ctx = { clearRect() { canvasClears += 1; } };
page.canvasWidth = 200;
page.canvasHeight = 200;

page.onHide();
assert.strictEqual(page.data.spinning, false, "leaving during a spin must not leave the page permanently locked");
assert.strictEqual(page.data.wheelRotation, 5);
assert.strictEqual(page.data.wheelTransitionStyle, "none");
assert.deepStrictEqual(clearedTimers, [11, 12]);
assert.strictEqual(canvasClears, 1);

let canvasQueryCallback = null;
global.wx.createSelectorQuery = () => ({
  select() { return this; },
  fields() { return this; },
  exec(callback) { canvasQueryCallback = callback; },
});
const unloadedPage = createPage(pageConfig);
let lateInitCallbackCount = 0;
unloadedPage.initCanvas(() => { lateInitCallbackCount += 1; });
unloadedPage.unloaded = true;
canvasQueryCallback([{ node: { getContext() { return {}; } }, width: 200, height: 200 }]);
assert.strictEqual(lateInitCallbackCount, 0, "a late canvas query must not mutate an unloaded page");
assert.strictEqual(unloadedPage.canvas, undefined);

let unloadSetDataCount = 0;
unloadedPage.data.spinning = false;
unloadedPage.setData = () => { unloadSetDataCount += 1; };
unloadedPage.onUnload();
assert.strictEqual(unloadSetDataCount, 0, "onUnload must not call setData on a destroyed page");

let rafReceiver = null;
let cancelReceiver = null;
let cancelledConfettiFrame = null;
const confettiCanvas = {
  requestAnimationFrame() {
    rafReceiver = this;
    return 77;
  },
  cancelAnimationFrame(frameId) {
    cancelReceiver = this;
    cancelledConfettiFrame = frameId;
  },
};
const confettiPage = createPage(pageConfig);
confettiPage.unloaded = false;
confettiPage.hidden = false;
confettiPage.data.spinning = false;
confettiPage.canvas = confettiCanvas;
confettiPage.canvasWidth = 200;
confettiPage.canvasHeight = 200;
confettiPage.ctx = {
  clearRect() {},
  save() {},
  translate() {},
  rotate() {},
  fillRect() {},
  restore() {},
};
confettiPage.launchConfetti();
assert.strictEqual(rafReceiver, confettiCanvas, "Canvas RAF must retain its native receiver");
assert.strictEqual(confettiPage.confettiFrameId, 77);
confettiPage.onHide();
assert.strictEqual(cancelReceiver, confettiCanvas);
assert.strictEqual(cancelledConfettiFrame, 77, "hiding the page must cancel the scheduled confetti frame");

page.hidden = false;
page.unloaded = false;
page.data.showHistoryDrawer = true;
page.toggleHistoryDrawer({ type: "beforeleave" });
assert.strictEqual(page.data.showHistoryDrawer, false, "beforeleave must close instead of toggling the drawer open again");

const historyItem = { id: "history_1", title: "火锅", source: "custom" };
page.data.showHistoryDrawer = true;
page.quickScheduleFromHistory({ currentTarget: { dataset: { item: historyItem } } });
assert.strictEqual(page.data.result.id, "history_1");
assert.strictEqual(page.data.resultVisible, true);
assert.strictEqual(page.data.showHistoryDrawer, false);

const handlerGroups = [
  require("./handlers/candidateHandlers.js"),
  require("./handlers/planHandlers.js"),
  require("./handlers/historyHandlers.js"),
  require("./handlers/shareHandlers.js"),
];
const handlerNames = handlerGroups.flatMap((handlers) => Object.keys(handlers));
assert.strictEqual(new Set(handlerNames).size, handlerNames.length, "food-wheel handlers must not overwrite each other");

delete require.cache[pageModulePath];
if (previousGlobals.hadWx) global.wx = previousGlobals.wx;
else delete global.wx;
if (previousGlobals.hadPage) global.Page = previousGlobals.Page;
else delete global.Page;
global.clearTimeout = previousGlobals.clearTimeout;

console.log("food wheel Page lifecycle tests ok");
