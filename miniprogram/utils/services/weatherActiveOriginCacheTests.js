const assert = require("assert");

global.wx = {
  getStorageSync() {
    return null;
  },
  setStorageSync() {},
};
global.getApp = () => ({ globalData: {} });

const config = require("../../config.js");
const privacyService = require("../privacyService.js");
const routeService = require("./routeService.js");
const { buildCoordinateCacheKey } = require("./weatherRemoteService.js");

const originals = {
  getWeatherApiKey: config.getWeatherApiKey,
  readLocalData: privacyService.readLocalData,
  getActiveRouteOrigin: routeService.getActiveRouteOrigin,
};

const cache = new Map();
let activeOrigin = { name: "地点 B", latitude: 31, longitude: 121 };
config.getWeatherApiKey = () => "test-key";
privacyService.readLocalData = (key, fallback) => cache.has(key) ? cache.get(key) : fallback;
routeService.getActiveRouteOrigin = () => activeOrigin;

const weatherService = require("./weatherService.js");
const locationA = { name: "地点 A", latitude: 30, longitude: 120 };
const locationB = { name: "地点 B", latitude: 31, longitude: 121 };
const baseDate = new Date(2026, 7, 30);
const pad = (value) => String(value).padStart(2, "0");
const daily = Array.from({ length: 7 }, (_, index) => {
  const date = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + index);
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    marker: "地点 B 预报",
    temperature: "20-26°",
  };
});

cache.set("life_helper_live_weather_cache", {
  timestamp: Date.now(),
  locationKey: buildCoordinateCacheKey(locationA),
  data: { title: "地点 A 缓存", locationName: "地点 A", temperature: 20, mainCondition: "sunny" },
});
cache.set("life_helper_weekly_weather_cache", {
  timestamp: Date.now(),
  locationKey: buildCoordinateCacheKey(locationA),
  data: daily.map((item) => Object.assign({}, item, { marker: "地点 A 预报" })),
});

assert.strictEqual(weatherService.getWeather().source, "local", "live cache from another origin must be ignored");
assert.ok(weatherService.getWeeklyWeather(baseDate).every((item) => !item.marker), "weekly cache from another origin must be ignored");

cache.set("life_helper_live_weather_cache", {
  timestamp: Date.now(),
  locationKey: buildCoordinateCacheKey(locationB),
  data: { title: "地点 B 缓存", locationName: "地点 B", temperature: 21, mainCondition: "sunny" },
});
cache.set("life_helper_weekly_weather_cache", {
  timestamp: Date.now(),
  locationKey: buildCoordinateCacheKey(locationB),
  data: daily,
});

const matchingLive = weatherService.getWeather();
assert.strictEqual(matchingLive.source, "api");
assert.strictEqual(matchingLive.locationName, "地点 B");
assert.ok(weatherService.getWeeklyWeather(baseDate).every((item) => item.marker === "地点 B 预报"));

cache.set("life_helper_weekly_weather_cache", {
  timestamp: Date.now() - weatherService.__test__.WEEKLY_WEATHER_CACHE_TTL_MS - 1,
  locationKey: buildCoordinateCacheKey(locationB),
  data: daily.map((item) => Object.assign({}, item, { marker: "过期预报" })),
});
assert.ok(
  weatherService.getWeeklyWeather(baseDate).every((item) => !item.marker),
  "expired weekly data must not be relabeled as the current seven days",
);

activeOrigin = { name: "尚未选点" };
assert.strictEqual(weatherService.getWeather().source, "local", "cache must not be used without an active coordinate origin");

config.getWeatherApiKey = originals.getWeatherApiKey;
privacyService.readLocalData = originals.readLocalData;
routeService.getActiveRouteOrigin = originals.getActiveRouteOrigin;

console.log("weather active origin cache tests ok");
