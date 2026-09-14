const assert = require("assert");

const storage = new Map();
global.wx = {
  getStorageSync(key) { return storage.has(key) ? storage.get(key) : ""; },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
};

const privacyService = require("../privacyService.js");
const settingsStore = require("./weatherApiSettingsStore.js");

assert.strictEqual(settingsStore.isDirectAccessEnabled(), false);
assert.strictEqual(settingsStore.normalizeApiHost("http://abc.def.qweatherapi.com"), "");
assert.strictEqual(settingsStore.normalizeApiHost("https://qweatherapi.com.evil.test"), "");
assert.strictEqual(
  settingsStore.normalizeApiHost("ABC123.DEF.QWEATHERAPI.COM/"),
  "https://abc123.def.qweatherapi.com",
);

const saved = settingsStore.saveSettings({
  enabled: true,
  apiHost: "abc123.def.qweatherapi.com",
  apiKey: "ABCD1234EFGH5678",
});
assert.strictEqual(saved, true);
assert.deepStrictEqual(settingsStore.getEnabledCredential(), {
  apiHost: "https://abc123.def.qweatherapi.com",
  apiKey: "ABCD1234EFGH5678",
});
assert.strictEqual(settingsStore.maskApiKey("ABCD1234EFGH5678"), "ABCD••••5678");
assert.strictEqual(
  privacyService.isEncryptedRecord(storage.get(settingsStore.WEATHER_API_SETTINGS_KEY)),
  true,
  "the local weather credential must be encrypted at rest",
);

const beforeInvalidSave = storage.get(settingsStore.WEATHER_API_SETTINGS_KEY);
assert.strictEqual(settingsStore.saveSettings({
  enabled: true,
  apiHost: "https://evil.test",
  apiKey: "ABCD1234EFGH5678",
}), false);
assert.deepStrictEqual(storage.get(settingsStore.WEATHER_API_SETTINGS_KEY), beforeInvalidSave);

assert.strictEqual(settingsStore.clearSettings(), true);
assert.strictEqual(settingsStore.isDirectAccessEnabled(), false);

console.log("weather API settings store tests ok");
