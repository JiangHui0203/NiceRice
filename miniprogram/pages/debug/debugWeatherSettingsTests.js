const assert = require("assert");

const storage = new Map();
const previousWx = global.wx;
const previousPage = global.Page;
const hadWx = Object.prototype.hasOwnProperty.call(global, "wx");
const hadPage = Object.prototype.hasOwnProperty.call(global, "Page");

global.wx = new Proxy({
  getStorageSync(key) { return storage.has(key) ? storage.get(key) : ""; },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
  showToast() {},
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
const settingsStore = require("../../utils/services/weatherApiSettingsStore.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

try {
  delete require.cache[pagePath];
  require(pagePath);
  assert.ok(pageConfig);
  const page = Object.assign({}, pageConfig, {
    data: clone(pageConfig.data),
    hidden: false,
    unloaded: false,
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (typeof callback === "function") callback.call(this);
    },
    refresh() {},
  });
  page.data.apiHostDraft = "abc123.def.qweatherapi.com";
  page.data.apiKeyDraft = "LOCAL_TEST_KEY_1234";
  page.data.directWeatherApiEnabled = true;
  const settings = page.persistWeatherApiSettings(false);
  assert.strictEqual(settings.enabled, true);
  assert.deepStrictEqual(settingsStore.getEnabledCredential(), {
    apiHost: "https://abc123.def.qweatherapi.com",
    apiKey: "LOCAL_TEST_KEY_1234",
  });
  assert.strictEqual(page.data.apiKeyDraft, "", "the plaintext key draft must be dropped from Page data after save");
  console.log("debug weather API settings tests ok");
} finally {
  settingsStore.clearSettings();
  delete require.cache[pagePath];
  if (hadWx) global.wx = previousWx;
  else delete global.wx;
  if (hadPage) global.Page = previousPage;
  else delete global.Page;
}
