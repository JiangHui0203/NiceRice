const assert = require("assert");

delete global.wx;
const couponStore = require("./couponStore.js");
const privacyService = require("./privacyService.js");
const couponRepository = require("./coupon/couponRepository.js");

assert.ok(couponStore.getAllCoupons().length > 0, "fresh prototype storage should expose bundled samples");

privacyService.writeLocalData("life_helper_coupons", []);
privacyService.writeLocalData("life_helper_coupon_deleted", []);
const samplesFromStoredEmptyList = couponStore.getAllCoupons();
assert.ok(
  samplesFromStoredEmptyList.length > 0,
  "an accidentally persisted empty list should keep exposing bundled samples",
);

const explicitlyDeletedSampleId = samplesFromStoredEmptyList[0].id;
privacyService.writeLocalData("life_helper_coupon_deleted", [explicitlyDeletedSampleId]);
assert.strictEqual(
  couponStore.getAllCoupons().some((coupon) => coupon.id === explicitlyDeletedSampleId),
  false,
  "the empty-list fallback must still respect explicit sample deletions",
);

const samples = couponStore.resetSampleCoupons();
assert.ok(Array.isArray(samples) && samples.length > 0);
const sampleIds = new Set(samples.map((coupon) => coupon.id));

const shared = couponStore.addCoupon({
  id: "shared_coupon_store_test",
  title: "好友分享双人餐",
  venue: "测试门店",
  dishes: "烤鱼、甜品",
  statusCode: "pending",
});
assert.strictEqual(shared.id, "shared_coupon_store_test");
assert.strictEqual(couponStore.findCoupon(shared.id).dishes, "烤鱼、甜品");
const visibleAfterImport = couponStore.getAllCoupons();
assert.strictEqual(
  samples.every((sample) => visibleAfterImport.some((coupon) => coupon.id === sample.id)),
  true,
  "importing one user coupon must not replace the bundled coupon layer",
);
assert.strictEqual(
  visibleAfterImport.filter((coupon) => sampleIds.has(coupon.id)).length,
  sampleIds.size,
);
assert.deepStrictEqual(
  couponRepository.snapshotCouponStorage().userCoupons.map((coupon) => coupon.id),
  [shared.id],
  "bundled samples must not be copied into durable user storage",
);

console.log("coupon store tests ok");
