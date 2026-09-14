const assert = require("assert");
const { createWeatherRemoteService } = require("./weatherRemoteService.js");

const requests = [];
global.wx = {
  request(options) {
    requests.push(options);
    if (options.url.endsWith("/v7/weather/now")) {
      options.success({
        statusCode: 200,
        data: {
          code: "200",
          now: { temp: "23", feelsLike: "24", text: "晴", windSpeed: "8" },
        },
      });
      return;
    }
    if (options.url.endsWith("/v7/weather/7d")) {
      options.success({
        statusCode: 200,
        data: {
          code: "200",
          daily: [{
            fxDate: "2026-08-31",
            tempMax: "30",
            tempMin: "22",
            iconDay: "100",
            textDay: "晴",
            textNight: "晴",
            windScaleDay: "2",
          }],
        },
      });
    }
  },
};

const privacyService = {
  isLocalOnly() { return true; },
  readLocalData(key, fallback) { return fallback; },
  writeLocalData() { return true; },
};

function createService(directEnabled) {
  return createWeatherRemoteService({
    config: { QWEATHER_API_HOST: "", QWEATHER_API_KEY: "" },
    liveWeatherCacheKey: "live",
    weeklyWeatherCacheKey: "weekly",
    privacyService,
    weatherApiSettingsStore: {
      isDirectAccessEnabled() { return directEnabled; },
      getEnabledCredential() {
        return directEnabled
          ? { apiHost: "https://abc123.def.qweatherapi.com", apiKey: "LOCAL_TEST_KEY_1234" }
          : null;
      },
    },
    weatherApiAdapter: {
      parseWeatherApiResponse(payload) {
        return payload && payload.now ? {
          condition: payload.now.text,
          summary: "实时天气",
          temperature: Number(payload.now.temp),
          mainCondition: "sunny",
          intensity: 1,
          timePhase: "afternoon",
          tips: [],
          raw: {},
        } : null;
      },
      matchQWeatherCode() { return { condition: "sunny", intensity: 1 }; },
    },
    weatherEngine: { generateWeatherScene() { return {}; } },
    withMeta(weather) { return weather; },
  });
}

async function run() {
  const blocked = await createService(false).testQWeatherApiConnection(
    "https://abc123.def.qweatherapi.com",
    "LOCAL_TEST_KEY_1234",
    { latitude: 30, longitude: 120 },
  );
  assert.strictEqual(blocked.success, false);
  assert.strictEqual(blocked.code, "weather_direct_disabled");
  assert.strictEqual(requests.length, 0);

  const result = await createService(true).testQWeatherApiConnection(
    "https://abc123.def.qweatherapi.com",
    "LOCAL_TEST_KEY_1234",
    { latitude: 30, longitude: 120 },
  );
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.forecastDays, 1);
  assert.strictEqual(requests.length, 2);
  requests.forEach((request) => {
    assert.strictEqual(request.header["X-QW-Api-Key"], "LOCAL_TEST_KEY_1234");
    assert.strictEqual(request.data.key, undefined);
  });
  console.log("weather local direct API tests ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
