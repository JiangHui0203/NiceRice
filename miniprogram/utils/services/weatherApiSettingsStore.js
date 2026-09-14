const privacyService = require("../privacyService.js");

const WEATHER_API_SETTINGS_KEY = "life_helper_weather_api_settings";
const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  apiHost: "",
  apiKey: "",
  updatedAt: "",
});

function normalizeApiHost(value) {
  let host = typeof value === "string" ? value.trim() : "";
  if (!host) return "";
  if (!/^https?:\/\//i.test(host)) host = `https://${host}`;
  const match = host.match(/^https:\/\/([a-z0-9.-]+)\/?$/i);
  if (!match) return "";
  const hostname = match[1].toLowerCase();
  if (hostname.includes("..") || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname)) return "";
  const isDedicatedHost = hostname.endsWith(".qweatherapi.com");
  const isLegacyHost = [
    "api.qweather.com",
    "devapi.qweather.com",
    "geoapi.qweather.com",
  ].includes(hostname);
  if (!isDedicatedHost && !isLegacyHost) return "";
  return `https://${hostname}`;
}

function normalizeApiKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (key.length < 8 || key.length > 512 || !/^[A-Za-z0-9._-]+$/.test(key)) return "";
  return key;
}

function normalizeStoredSettings(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const apiHost = normalizeApiHost(source.apiHost);
  const apiKey = normalizeApiKey(source.apiKey);
  return {
    enabled: source.enabled === true && Boolean(apiHost && apiKey),
    apiHost,
    apiKey,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt.slice(0, 40) : "",
  };
}

function validateSettings(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const rawHost = typeof source.apiHost === "string" ? source.apiHost.trim() : "";
  const rawKey = typeof source.apiKey === "string" ? source.apiKey.trim() : "";
  const apiHost = normalizeApiHost(rawHost);
  const apiKey = normalizeApiKey(rawKey);
  if (rawHost && !apiHost) {
    return { valid: false, error: "请输入和风天气控制台中的专属 HTTPS API Host" };
  }
  if (rawKey && !apiKey) {
    return { valid: false, error: "API Key 格式不正确" };
  }
  if (source.enabled === true && (!apiHost || !apiKey)) {
    return { valid: false, error: "开启直连前，请填写专属 API Host 和 API Key" };
  }
  return {
    valid: true,
    settings: {
      enabled: source.enabled === true,
      apiHost,
      apiKey,
      updatedAt: new Date().toISOString(),
    },
  };
}

function readSettings() {
  return normalizeStoredSettings(
    privacyService.readLocalData(WEATHER_API_SETTINGS_KEY, DEFAULT_SETTINGS),
  );
}

function saveSettings(value = {}) {
  const validation = validateSettings(value);
  if (!validation.valid) return false;
  return privacyService.writeLocalData(WEATHER_API_SETTINGS_KEY, validation.settings);
}

function clearSettings() {
  return privacyService.removeLocalData(WEATHER_API_SETTINGS_KEY);
}

function getEnabledCredential() {
  const settings = readSettings();
  if (!settings.enabled || !settings.apiHost || !settings.apiKey) return null;
  return { apiHost: settings.apiHost, apiKey: settings.apiKey };
}

function isDirectAccessEnabled() {
  return Boolean(getEnabledCredential());
}

function maskApiKey(value) {
  const key = normalizeApiKey(value);
  if (!key) return "";
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

module.exports = {
  WEATHER_API_SETTINGS_KEY,
  clearSettings,
  getEnabledCredential,
  isDirectAccessEnabled,
  maskApiKey,
  normalizeApiHost,
  normalizeApiKey,
  readSettings,
  saveSettings,
  validateSettings,
};
