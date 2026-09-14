const assert = require("assert");
const {
  getOfflineEstimateAddress,
  reverseGeocode,
} = require("./reverseGeocodeService.js");

assert.ok(getOfflineEstimateAddress(39.9928, 116.4782));
assert.ok(getOfflineEstimateAddress(22.5401, 113.9547));

reverseGeocode(39.9928, 116.4782).then((location) => {
  assert.strictEqual(location.latitude, 39.9928);
  assert.strictEqual(location.longitude, 116.4782);
  assert.ok(location.name || location.address);
  console.log("reverse geocode service tests ok");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
