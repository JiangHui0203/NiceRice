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
const queryCallbacks = [];
let queryCount = 0;

global.setTimeout = (callback) => {
  const timerId = nextTimerId;
  nextTimerId += 1;
  timers.set(timerId, callback);
  return timerId;
};
global.clearTimeout = (timerId) => timers.delete(timerId);
global.wx = {
  createSelectorQuery() {
    queryCount += 1;
    return {
      select() { return this; },
      fields() { return this; },
      exec(callback) { queryCallbacks.push(callback); },
    };
  },
  getDeviceInfo() { return { platform: "devtools" }; },
  getWindowInfo() { return { pixelRatio: 2, windowWidth: 375 }; },
  showToast() {},
};

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
  assert.strictEqual(timers.size, 1, "only one canvas initialization timer should be pending");
  const [timerId, callback] = timers.entries().next().value;
  timers.delete(timerId);
  callback();
}

function resolveOnlyQuery(result) {
  assert.strictEqual(queryCallbacks.length, 1, "only one SelectorQuery should be in flight");
  queryCallbacks.shift()(result);
}

try {
  const page = createPage();
  let loadCount = 0;
  page.loadCandidates = function loadCandidates() {
    loadCount += 1;
    this.candidatesLoaded = true;
  };

  page.onReady();
  page.scheduleCanvasInitialization();
  assert.strictEqual(timers.size, 1, "repeated scheduling must not stack timers");
  runOnlyTimer();
  assert.strictEqual(queryCount, 1);
  page.scheduleCanvasInitialization();
  assert.strictEqual(timers.size, 0, "a pending SelectorQuery must block another timer");
  assert.strictEqual(queryCount, 1);

  resolveOnlyQuery([{}]);
  assert.notStrictEqual(page.hasRendered, true, "a missing Canvas node must not mark the page rendered");
  assert.strictEqual(loadCount, 1, "candidates should still load while Canvas retries");
  runOnlyTimer();
  assert.strictEqual(queryCount, 2);
  resolveOnlyQuery([{ node: {} }]);
  assert.notStrictEqual(page.hasRendered, true, "a missing Canvas context must not mark the page rendered");
  runOnlyTimer();
  assert.strictEqual(queryCount, 3);
  resolveOnlyQuery([{ node: { getContext() { return null; } } }]);
  assert.strictEqual(timers.size, 0, "Canvas retries must stop after the configured attempt limit");
  assert.strictEqual(page.canvasInitAttempts, 3);
  assert.notStrictEqual(page.hasRendered, true);

  page.onHide();
  page.onShow();
  assert.strictEqual(timers.size, 1, "the next visible lifecycle should receive a fresh retry budget");
  runOnlyTimer();
  assert.strictEqual(queryCount, 4);

  const context = { scale() {}, clearRect() {} };
  const canvas = { getContext() { return context; } };
  page.onHide();
  resolveOnlyQuery([{ node: canvas }]);
  assert.notStrictEqual(page.hasRendered, true, "a late query callback after hide must be ignored");
  assert.strictEqual(page.canvasInitPending, false);

  page.onShow();
  page.scheduleCanvasInitialization();
  assert.strictEqual(timers.size, 1, "show and manual scheduling must still create one timer");
  runOnlyTimer();
  assert.strictEqual(queryCount, 5);
  resolveOnlyQuery([{ node: canvas }]);
  assert.strictEqual(page.hasRendered, true, "a later valid Canvas should complete initialization");
  assert.strictEqual(page.canvasInitAttempts, 0);
  assert.strictEqual(page.canvas, canvas);
  assert.strictEqual(page.ctx, context);
  assert.strictEqual(timers.size, 0);
  assert.strictEqual(queryCallbacks.length, 0);
} finally {
  delete require.cache[pageModulePath];
  if (previousGlobals.hadWx) global.wx = previousGlobals.wx;
  else delete global.wx;
  if (previousGlobals.hadPage) global.Page = previousGlobals.Page;
  else delete global.Page;
  global.setTimeout = previousGlobals.setTimeout;
  global.clearTimeout = previousGlobals.clearTimeout;
}

console.log("food wheel Canvas retry tests ok");
