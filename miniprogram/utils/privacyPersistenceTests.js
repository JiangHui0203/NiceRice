const assert = require("assert");

const storage = new Map();
const failedKeys = new Set();

global.wx = {
  getStorageSync(key) {
    return storage.get(key);
  },
  setStorageSync(key, value) {
    if (failedKeys.has(key)) throw new Error(`write failed: ${key}`);
    storage.set(key, value);
  },
};

const privacyService = require("./privacyService.js");
const couponStore = require("./couponStore.js");
const planStore = require("./planStore.js");
const backupService = require("./backupService.js");

assert.strictEqual(privacyService.writeLocalData("test_atomic_key", { value: "old" }), true);
privacyService.clearMemoryCache("test_atomic_key");
assert.deepStrictEqual(privacyService.readLocalData("test_atomic_key", null), { value: "old" });

const detachedRead = privacyService.readLocalData("test_atomic_key", null);
detachedRead.value = "mutated without write";
assert.deepStrictEqual(
  privacyService.readLocalData("test_atomic_key", null),
  { value: "old" },
  "callers must not mutate the durable cache through a shared object reference",
);

failedKeys.add("test_atomic_key");
assert.strictEqual(privacyService.writeLocalData("test_atomic_key", { value: "new" }), false);
assert.deepStrictEqual(
  privacyService.readLocalData("test_atomic_key", null),
  { value: "old" },
  "a failed durable write must not replace the last readable cached value",
);
privacyService.clearMemoryCache("test_atomic_key");
assert.deepStrictEqual(privacyService.readLocalData("test_atomic_key", null), { value: "old" });
failedKeys.delete("test_atomic_key");

const coupon = couponStore.importCouponSnapshot({
  id: "coupon_atomic_write",
  title: "原子写测试券",
  venue: "测试门店",
  statusCode: "pending",
  expireDate: "2099-12-31",
});
assert.ok(coupon);

failedKeys.add("life_helper_plans_v2");
const failedPlan = planStore.createPlan({
  id: "plan_atomic_write",
  couponId: coupon.id,
  title: "不应创建成功的计划",
  statusCode: "confirmed",
});
assert.strictEqual(failedPlan, null, "plan facade must expose a durable write failure");
privacyService.clearMemoryCache();
assert.strictEqual(planStore.getStoredPlans().some((plan) => plan.id === "plan_atomic_write"), false);
assert.strictEqual(couponStore.findCoupon(coupon.id).statusCode, "pending", "failed plan save must not link the coupon");
failedKeys.delete("life_helper_plans_v2");

failedKeys.add("life_helper_coupons");
const failedCoupon = couponStore.saveCoupon({
  id: "coupon_atomic_failure",
  title: "不应保存成功的券",
  venue: "测试门店",
  statusCode: "pending",
  expireDate: "2099-12-31",
});
assert.strictEqual(failedCoupon, null, "coupon facade must expose a durable write failure");
privacyService.clearMemoryCache();
assert.strictEqual(couponStore.findCoupon("coupon_atomic_failure"), null);
failedKeys.delete("life_helper_coupons");

failedKeys.add("life_helper_coupons");
failedKeys.add("life_helper_plans_v2");
const failedImport = backupService.importBackupPayload(JSON.stringify({
  format: backupService.BACKUP_FORMAT,
  version: backupService.BACKUP_VERSION,
  coupons: [{ id: "coupon_failed_import", title: "写失败券", expireDate: "2099-12-31" }],
  plans: [{ id: "plan_failed_import", title: "写失败计划", statusCode: "draft" }],
}));
assert.strictEqual(failedImport.success, false, "backup import must not report success when storage rejects writes");

console.log("privacy persistence tests ok");
