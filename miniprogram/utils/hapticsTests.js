const assert = require("assert");

global.wx = {
  getDeviceInfo: () => ({ platform: "devtools" }),
  vibrateShort() {},
  vibrateLong() {},
};

const haptics = require("./haptics.js");
["light", "medium", "heavy", "success", "warning"].forEach((method) => {
  assert.strictEqual(typeof haptics[method], "function");
  assert.doesNotThrow(() => haptics[method]());
});

console.log("haptics tests ok");
