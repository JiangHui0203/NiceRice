const assert = require("assert");
const {
  buildCustomOrigin,
  buildGpsOrigin,
  buildLocationActionItems,
  buildSavedRoleOrigin,
  hasSavedLocation,
  resolveGpsLocationName,
} = require("./locationFlowHelper.js");

const actionState = buildLocationActionItems([
  { role: "work", name: "一个非常非常长的工作地点名称", latitude: 30, longitude: 120 },
  { role: "home", address: "幸福小区" },
]);
assert.strictEqual(actionState.itemList.length, 4);
assert.ok(actionState.itemList[2].includes("..."));

assert.strictEqual(resolveGpsLocationName({}, { name: "当前位置" }, "离线地址"), "离线地址");
const gps = buildGpsOrigin({ latitude: 22.5, longitude: 113.9 }, { name: "南山区", city: "深圳市" }, "离线地址");
assert.strictEqual(gps.name, "南山区");
assert.strictEqual(gps.lat, 22.5);

const home = buildSavedRoleOrigin("home", { name: "我的家", lat: 1, lng: 2 });
assert.strictEqual(home.id, "loc_home");
assert.strictEqual(home.latitude, 1);
assert.strictEqual(hasSavedLocation(home), true);
assert.strictEqual(hasSavedLocation({ latitude: 0, longitude: 0 }), true);
assert.strictEqual(hasSavedLocation({ address: "只有文字地址" }), false);
assert.strictEqual(hasSavedLocation({}), false);

const custom = buildCustomOrigin({ name: "咖啡店", latitude: 3, longitude: 4 }, () => 123);
assert.strictEqual(custom.id, "loc_custom_123");

console.log("index location flow helper tests ok");
