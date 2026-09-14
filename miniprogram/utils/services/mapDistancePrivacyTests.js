const assert = require("assert");

let localOnly = false;
const pendingRequests = [];
global.wx = {
  getStorageSync(key) { return key === "life_helper_custom_map_key" ? "test-key" : ""; },
  request(options) { pendingRequests.push(options); },
};

const privacyService = require("../privacyService.js");
const originalIsLocalOnly = privacyService.isLocalOnly;
privacyService.isLocalOnly = () => localOnly;
const service = require("./mapDistanceService.js");

function succeed(options, distance = 1200) {
  options.success({
    statusCode: 200,
    data: {
      status: 0,
      result: { rows: [{ elements: [{ distance, duration: 600 }] }] },
    },
  });
}

async function run() {
  localOnly = true;
  const blocked = await service.fetchTencentMapDistance({
    from: { lat: 31.2, lng: 121.4 },
    toList: [{ lat: 31.3, lng: 121.5 }],
  });
  assert.strictEqual(blocked, null);
  assert.strictEqual(pendingRequests.length, 0, "local-only privacy mode must never send coordinates to Tencent");

  localOnly = false;
  const clearedRequest = service.fetchTencentMapDistance({
    from: { lat: 31.2, lng: 121.4 },
    toList: [{ lat: 31.3, lng: 121.5 }],
  });
  assert.strictEqual(pendingRequests[0].data.from, "31.2,121.4", "lat/lng aliases must be normalized before the request");
  assert.strictEqual(pendingRequests[0].data.to, "31.3,121.5");
  service.clearDistanceCache();
  succeed(pendingRequests[0]);
  assert.strictEqual(await clearedRequest, null, "a response that predates clearDistanceCache must be discarded");
  assert.strictEqual(service.__test__.getDistanceCacheSize(), 0);

  const privacyChangedRequest = service.fetchTencentMapDistance({
    from: { latitude: 31.2, longitude: 121.4 },
    toList: [{ latitude: 31.3, longitude: 121.5 }],
  });
  localOnly = true;
  succeed(pendingRequests[1]);
  assert.strictEqual(await privacyChangedRequest, null, "a late response must not refill caches after privacy mode is enabled");
  assert.strictEqual(service.__test__.getDistanceCacheSize(), 0);

  localOnly = false;
  const acceptedRequest = service.fetchTencentMapDistance({
    from: { latitude: 31.2, longitude: 121.4 },
    toList: [{ latitude: 31.3, longitude: 121.5 }],
  });
  succeed(pendingRequests[2], 1500);
  const accepted = await acceptedRequest;
  assert.strictEqual(accepted[0].distanceMeters, 1500);
  assert.strictEqual(service.__test__.getDistanceCacheSize(), 1);

  console.log("map distance privacy tests ok");
}

run().finally(() => {
  privacyService.isLocalOnly = originalIsLocalOnly;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
