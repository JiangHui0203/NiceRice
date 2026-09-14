const assert = require("assert");
const weatherEngine = require("./weatherEngine.js");
const weatherApiAdapter = require("./weatherApiAdapter.js");
const { resolveRequestCoordinates } = require("./weatherRemoteService.js");

const qweather = weatherApiAdapter.parseWeatherApiResponse({
  code: "200",
  now: {
    temp: "0",
    icon: "100",
    text: "晴",
    windSpeed: "0",
    humidity: "0",
    precip: "0",
    vis: "0",
    cloud: "0",
  },
}, "qweather");
assert.strictEqual(qweather.raw.temperature, 0);
assert.strictEqual(qweather.raw.windSpeed, 0);
assert.strictEqual(qweather.raw.humidity, 0);
assert.strictEqual(qweather.raw.visibility, 0);

const amap = weatherApiAdapter.parseWeatherApiResponse({
  info: "OK",
  lives: [{ temperature: "0", humidity: "0", windpower: "0", weather: "晴" }],
}, "amap");
assert.strictEqual(amap.raw.temperature, 0);
assert.strictEqual(amap.raw.humidity, 0);
assert.strictEqual(amap.raw.windLevel, 0);

const openWeather = weatherApiAdapter.parseWeatherApiResponse({
  name: "测试点",
  weather: [{ id: 800, main: "Clear" }],
  main: { temp: 0, temp_min: 0, temp_max: 0, humidity: 0 },
  wind: { speed: 0 },
}, "openweathermap");
assert.strictEqual(openWeather.raw.temperature, 0);
assert.strictEqual(openWeather.raw.temperatureMin, 0);
assert.strictEqual(openWeather.raw.temperatureMax, 0);

assert.strictEqual(weatherEngine.normalizeWeather({ temperature: 0, visibility: 0 }).visibilityLevel, 0);
assert.deepStrictEqual(resolveRequestCoordinates({ latitude: 0, longitude: 0 }), { lat: 0, lng: 0 });
assert.strictEqual(resolveRequestCoordinates({ latitude: 91, longitude: 0 }), null);

const weatherService = require("./weatherService.js");
weatherService.saveCustomWeatherV2({
  key: "sunny",
  title: "晴",
  temperature: 0,
  visibility: 0,
  windLevel: 0,
});
const zeroWeather = weatherService.getWeather();
assert.strictEqual(zeroWeather.temperatureRange, 0);
assert.strictEqual(zeroWeather.v2Scene.normalized.visibilityLevel, 0);

console.log("weather edge case tests ok");
