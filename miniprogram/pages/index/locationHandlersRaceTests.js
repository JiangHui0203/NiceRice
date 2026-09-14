const assert = require("assert");

global.wx = {
  hideLoading() {
    hideLoadingCalls += 1;
  },
  showLoading() {
    showLoadingCalls += 1;
  },
  showToast() {},
};

let hideLoadingCalls = 0;
let showLoadingCalls = 0;

const routeService = require("../../utils/services/routeService.js");
const weatherService = require("../../utils/services/weatherService.js");
const locationService = require("../../utils/services/locationService.js");
const handlers = require("./handlers/locationHandlers.js");

const originals = {
  saveActiveRouteOrigin: routeService.saveActiveRouteOrigin,
  fetchLiveWeather: weatherService.fetchLiveWeather,
  fetchWeeklyForecast: weatherService.fetchWeeklyForecast,
  clearWeatherOverride: weatherService.clearWeatherOverride,
  getCurrentLocation: locationService.getCurrentLocation,
  reverseGeocode: locationService.reverseGeocode,
};

const pending = new Map();
const savedOrigins = [];
routeService.saveActiveRouteOrigin = (origin) => {
  savedOrigins.push(Object.assign({}, origin));
  return origin;
};
weatherService.fetchLiveWeather = (origin) => new Promise((resolve) => {
  pending.set(origin.name, resolve);
});
weatherService.fetchWeeklyForecast = () => Promise.resolve([]);

async function run() {
  const rendered = [];
  const page = Object.assign({
    data: {},
    pageVisible: true,
    unloaded: false,
    renderDashboard() {
      rendered.push(savedOrigins[savedOrigins.length - 1].name);
    },
  }, handlers);

  const first = page.applyCustomLocation({ name: "地点 A", address: "A", latitude: 30, longitude: 120 });
  const second = page.applyCustomLocation({ name: "地点 B", address: "B", latitude: 31, longitude: 121 });

  pending.get("地点 B")({ locationName: "地点 B", condition: "晴" });
  await second;
  pending.get("地点 A")({ locationName: "地点 A", condition: "雨" });
  await first;

  assert.deepStrictEqual(rendered, ["地点 B"], "only the latest location may refresh the page");
  assert.strictEqual(savedOrigins[savedOrigins.length - 1].name, "地点 B", "stale weather must not restore the old origin");

  let resolveGps;
  locationService.getCurrentLocation = () => new Promise((resolve) => {
    resolveGps = resolve;
  });
  locationService.reverseGeocode = () => Promise.resolve({ name: "GPS 地点" });
  weatherService.clearWeatherOverride = () => true;
  const gpsRefresh = handlers.__test__.refreshGpsLocation(page);
  assert.strictEqual(showLoadingCalls, 1, "GPS refresh should show loading once");
  assert.ok(page.locationLoadingToken, "GPS refresh should own the active loading token");

  page.cancelLocationOperations();
  assert.strictEqual(page.locationLoadingToken, 0, "cancelling GPS refresh must release the loading token");
  assert.strictEqual(hideLoadingCalls, 1, "cancelling GPS refresh must hide its loading UI");
  resolveGps({ latitude: 32, longitude: 122 });
  await gpsRefresh;
  assert.deepStrictEqual(rendered, ["地点 B"], "cancelled GPS result must not refresh the page");

  routeService.saveActiveRouteOrigin = originals.saveActiveRouteOrigin;
  weatherService.fetchLiveWeather = originals.fetchLiveWeather;
  weatherService.fetchWeeklyForecast = originals.fetchWeeklyForecast;
  weatherService.clearWeatherOverride = originals.clearWeatherOverride;
  locationService.getCurrentLocation = originals.getCurrentLocation;
  locationService.reverseGeocode = originals.reverseGeocode;
  console.log("location handler race tests ok");
}

run().catch((error) => {
  routeService.saveActiveRouteOrigin = originals.saveActiveRouteOrigin;
  weatherService.fetchLiveWeather = originals.fetchLiveWeather;
  weatherService.fetchWeeklyForecast = originals.fetchWeeklyForecast;
  weatherService.clearWeatherOverride = originals.clearWeatherOverride;
  locationService.getCurrentLocation = originals.getCurrentLocation;
  locationService.reverseGeocode = originals.reverseGeocode;
  console.error(error);
  process.exitCode = 1;
});
