const assert = require("assert");

const previousGlobals = {
  wx: global.wx,
  Page: global.Page,
  setTimeout: global.setTimeout,
  clearTimeout: global.clearTimeout,
  hadWx: Object.prototype.hasOwnProperty.call(global, "wx"),
  hadPage: Object.prototype.hasOwnProperty.call(global, "Page"),
};

let focusValue = "schedule";
global.wx = new Proxy({
  getStorageSync() { return focusValue; },
  removeStorageSync() { focusValue = ""; },
  getDeviceInfo() { return { platform: "devtools" }; },
}, {
  get(target, key) {
    if (Object.prototype.hasOwnProperty.call(target, key)) return target[key];
    return function noop() {};
  },
});

let pageConfig = null;
global.Page = (config) => { pageConfig = config; };
const pagePath = require.resolve("./index.js");
delete require.cache[pagePath];
require(pagePath);
assert.ok(pageConfig, "profile should register its Page config");
assert.strictEqual(pageConfig.data.activeSections.weather, false, "profile must retain its weather settings section");
assert.strictEqual(typeof pageConfig.selectWeather, "function");
assert.strictEqual(typeof pageConfig.resetWeather, "function");
assert.strictEqual(typeof pageConfig.selectCategory, "function");

const timers = new Map();
let nextTimerId = 1;
global.setTimeout = (callback) => {
  const id = nextTimerId;
  nextTimerId += 1;
  timers.set(id, callback);
  return id;
};
global.clearTimeout = (id) => timers.delete(id);

const page = Object.assign({}, pageConfig, {
  data: JSON.parse(JSON.stringify(pageConfig.data || {})),
  setDataCalls: 0,
  setData() { this.setDataCalls += 1; },
});
page.onLoad();
page.consumeFocusTarget();
assert.strictEqual(timers.size, 1);
page.onUnload();
assert.strictEqual(timers.size, 0, "profile unload must clear its delayed focus scroll");
assert.strictEqual(page.unloaded, true);
assert.strictEqual(page.setDataCalls, 0);

delete require.cache[pagePath];
if (previousGlobals.hadWx) global.wx = previousGlobals.wx;
else delete global.wx;
if (previousGlobals.hadPage) global.Page = previousGlobals.Page;
else delete global.Page;
global.setTimeout = previousGlobals.setTimeout;
global.clearTimeout = previousGlobals.clearTimeout;

console.log("profile page lifecycle tests ok");
