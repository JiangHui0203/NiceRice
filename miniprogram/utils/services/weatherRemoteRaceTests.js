const assert = require("assert");
const {
  buildCoordinateCacheKey,
  createWeatherRemoteService,
} = require("./weatherRemoteService.js");

const cache = new Map();
const pendingRequests = [];
global.wx = {
  request(options) {
    pendingRequests.push(options);
  },
};

const privacyService = {
  isLocalOnly() {
    return false;
  },
  readLocalData(key, fallback) {
    return cache.has(key) ? cache.get(key) : fallback;
  },
  writeLocalData(key, value) {
    cache.set(key, value);
    return true;
  },
};

const service = createWeatherRemoteService({
  config: {
    getWeatherApiKey: () => "test-key",
    QWEATHER_API_HOST: "https://example.test",
    WEATHER_CACHE_TTL_MS: 60000,
  },
  liveWeatherCacheKey: "live",
  weeklyWeatherCacheKey: "weekly",
  privacyService,
  weatherApiAdapter: {
    QWEATHER_CODE_MAP: {},
    parseWeatherApiResponse() {
      return {
        condition: "晴",
        summary: "晴朗",
        temperature: 20,
        mainCondition: "clear",
        intensity: 1,
        timePhase: "afternoon",
        tips: [],
        raw: {},
      };
    },
  },
  weatherEngine: {
    generateWeatherScene() {
      return {};
    },
  },
  withMeta(weather) {
    return weather;
  },
});

const locationA = { latitude: 30, longitude: 120, name: "A" };
const locationB = { latitude: 31, longitude: 121, name: "B" };

async function run() {
  cache.set("live", {
    timestamp: Date.now(),
    locationKey: buildCoordinateCacheKey(locationA),
    data: { locationName: "A-cached" },
  });
  const mismatchPromise = service.fetchLiveWeather(locationB, false);
  assert.strictEqual(pendingRequests.length, 2, "a cache from another coordinate must not be reused");
  pendingRequests.forEach((request) => {
    assert.strictEqual(request.header["X-QW-Api-Key"], "test-key");
    assert.strictEqual(request.data.key, undefined, "weather credentials must not be appended to request URLs");
  });
  pendingRequests.splice(0).forEach((request) => {
    if (request.url.includes("/7d")) {
      request.success({ statusCode: 200, data: { code: "200", daily: [] } });
    } else {
      request.success({ statusCode: 200, data: { code: "200", now: { temp: "20" } } });
    }
  });
  await mismatchPromise;

  cache.clear();
  const requestA = service.fetchLiveWeather(locationA, true);
  const requestB = service.fetchLiveWeather(locationB, true);
  const raceRequests = pendingRequests.splice(0);
  const requestsFor = (location) => raceRequests.filter((request) => request.data.location === location);
  requestsFor("121.0000,31.0000").forEach((request) => {
    if (request.url.includes("/7d")) {
      request.success({ statusCode: 200, data: { code: "200", daily: [] } });
    } else {
      request.success({ statusCode: 200, data: { code: "200", now: { temp: "21" } } });
    }
  });
  const latest = await requestB;
  assert.strictEqual(latest.locationName, "B");

  requestsFor("120.0000,30.0000").forEach((request) => {
    if (request.url.includes("/7d")) {
      request.success({ statusCode: 200, data: { code: "200", daily: [] } });
    } else {
      request.success({ statusCode: 200, data: { code: "200", now: { temp: "30" } } });
    }
  });
  assert.strictEqual(await requestA, null, "an older request must not publish stale weather");
  assert.strictEqual(cache.get("live").locationKey, buildCoordinateCacheKey(locationB));
  assert.strictEqual(cache.get("live").data.locationName, "B");

  console.log("weather remote race tests ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
