const assert = require("assert");

const previousGlobals = {
  wx: global.wx,
  Page: global.Page,
  getApp: global.getApp,
  hadWx: Object.prototype.hasOwnProperty.call(global, "wx"),
  hadPage: Object.prototype.hasOwnProperty.call(global, "Page"),
  hadGetApp: Object.prototype.hasOwnProperty.call(global, "getApp"),
};

const wxDefaults = {
  env: { USER_DATA_PATH: "/tmp" },
  getStorageSync() { return ""; },
  getDeviceInfo() { return { platform: "devtools" }; },
  getWindowInfo() { return { windowWidth: 375, windowHeight: 812, pixelRatio: 2 }; },
};
global.wx = new Proxy(wxDefaults, {
  get(target, key) {
    if (Object.prototype.hasOwnProperty.call(target, key)) return target[key];
    return function noop() {};
  },
});
global.getApp = () => ({ globalData: {} });

let pageConfig = null;
global.Page = (config) => { pageConfig = config; };
const pagePath = require.resolve("./index.js");
delete require.cache[pagePath];
require(pagePath);
assert.ok(pageConfig, "home page should register its Page config");

const page = Object.assign({}, pageConfig, {
  data: JSON.parse(JSON.stringify(pageConfig.data || {})),
  setDataCalls: 0,
  setData(patch, callback) {
    this.setDataCalls += 1;
    Object.assign(this.data, patch || {});
    if (typeof callback === "function") callback.call(this);
  },
});

page.unloaded = false;
page.pageVisible = false;
page.renderDashboard();
assert.strictEqual(page.setDataCalls, 0, "a hidden page must ignore late dashboard callbacks");

page.unloaded = true;
page.pageVisible = true;
page.renderDashboard();
assert.strictEqual(page.setDataCalls, 0, "an unloaded page must ignore late dashboard callbacks");

page.onUnload();
assert.strictEqual(page.setDataCalls, 0, "onUnload must not call setData");
assert.strictEqual(page.pageVisible, false);

delete require.cache[pagePath];
if (previousGlobals.hadWx) global.wx = previousGlobals.wx;
else delete global.wx;
if (previousGlobals.hadPage) global.Page = previousGlobals.Page;
else delete global.Page;
if (previousGlobals.hadGetApp) global.getApp = previousGlobals.getApp;
else delete global.getApp;

console.log("home page lifecycle tests ok");
