const assert = require("assert");
const fs = require("fs");
const path = require("path");

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
  canIUse() { return false; },
};

global.wx = new Proxy(wxDefaults, {
  get(target, key) {
    if (Object.prototype.hasOwnProperty.call(target, key)) return target[key];
    return function noop() {};
  },
});
global.getApp = () => ({ globalData: {} });

function extractHandlers(wxml) {
  const pattern = /\b(?:bind|catch)(?::?[A-Za-z0-9_-]+)\s*=\s*["']([A-Za-z_$][\w$]*)["']/g;
  return [...new Set(Array.from(wxml.matchAll(pattern), (match) => match[1]))]
    .filter((name) => name !== "true" && name !== "false");
}

try {
  const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "../app.json"), "utf8"));
  const failures = [];

  (appConfig.pages || []).forEach((pagePath) => {
    const modulePath = path.join(__dirname, "..", `${pagePath}.js`);
    const wxmlPath = path.join(__dirname, "..", `${pagePath}.wxml`);
    let pageConfig = null;
    global.Page = (config) => { pageConfig = config; };
    delete require.cache[require.resolve(modulePath)];
    require(modulePath);
    assert.ok(pageConfig, `${pagePath} should register a Page config`);

    const handlers = extractHandlers(fs.readFileSync(wxmlPath, "utf8"));
    handlers.forEach((handler) => {
      if (typeof pageConfig[handler] !== "function") {
        failures.push(`${pagePath}: ${handler}`);
      }
    });
  });

  assert.deepStrictEqual(failures, [], `WXML events without Page handlers:\n${failures.join("\n")}`);
  console.log(`page event contract tests ok (${(appConfig.pages || []).length} pages)`);
} finally {
  if (previousGlobals.hadWx) global.wx = previousGlobals.wx;
  else delete global.wx;
  if (previousGlobals.hadPage) global.Page = previousGlobals.Page;
  else delete global.Page;
  if (previousGlobals.hadGetApp) global.getApp = previousGlobals.getApp;
  else delete global.getApp;
}
