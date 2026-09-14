const assert = require("assert");

const storage = new Map();
const app = {
  globalData: {
    activeRouteOrigin: { latitude: 1, longitude: 2 },
    userLocation: { latitude: 1, longitude: 2 },
  },
};
global.getApp = () => app;
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
};

const privacyService = require("./privacyService.js");
const storageManager = require("./storageManager.js");

assert.strictEqual(storageManager.ENCRYPTED_STORAGE_KEYS.includes("life_helper_weather_api_settings"), true);
assert.strictEqual(
  storageManager.BACKUP_STORAGE_KEYS.includes("life_helper_weather_api_settings"),
  false,
  "weather provider credentials must never enter portable backups",
);

const inviteText = JSON.stringify({ name: "小李 🐰", slots: ["周五 18:00-20:00"] });
const urlSafeInvite = storageManager.encodeBase64Url(inviteText);
assert.strictEqual(/[+/=]/.test(urlSafeInvite), false);
assert.strictEqual(storageManager.decodeBase64(urlSafeInvite), inviteText);

privacyService.writeLocalData("life_helper_coupons", [{ id: "cached" }]);
privacyService.writeLocalData("life_helper_weather_api_settings", {
  enabled: true,
  apiHost: "https://abc123.def.qweatherapi.com",
  apiKey: "LOCAL_TEST_KEY_1234",
});
storage.set("life_helper_active_origin", { latitude: 1, longitude: 2 });
storage.set("life_helper_coupon_deleted", ["c1"]);
storage.set("life_helper_self_slots", ["周五 18:00-20:00"]);
assert.strictEqual(privacyService.readLocalData("life_helper_coupons", []).length, 1);

storageManager.resetLocalPrototypeData();

assert.strictEqual(storage.has("life_helper_active_origin"), false);
assert.strictEqual(storage.has("life_helper_coupon_deleted"), false);
assert.strictEqual(storage.has("life_helper_self_slots"), false);
assert.strictEqual(storage.has("life_helper_weather_api_settings"), false);
assert.deepStrictEqual(privacyService.readLocalData("life_helper_coupons", []), []);
assert.strictEqual(app.globalData.activeRouteOrigin, null);
assert.strictEqual(app.globalData.userLocation, null);
assert.strictEqual(storage.get("life_helper_schema_version"), storageManager.CURRENT_SCHEMA_VERSION);

const originalSetStorageSync = global.wx.setStorageSync;
global.wx.setStorageSync = (key, value) => {
  if (key === "life_helper_friends") throw new Error("quota exceeded");
  originalSetStorageSync(key, value);
};
const failedLegacyImport = storageManager.importBackup(storageManager.encodeBase64(JSON.stringify({
  version: 2,
  data: { life_helper_friends: [{ id: "friend_failed", name: "写失败好友" }] },
})));
assert.strictEqual(failedLegacyImport.success, false, "legacy import must surface a durable write failure");
global.wx.setStorageSync = originalSetStorageSync;

console.log("storage manager tests ok");
