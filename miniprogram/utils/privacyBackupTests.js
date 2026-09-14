const assert = require("assert");

const storage = new Map();
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  showToast() {},
};

const nativeBuffer = global.Buffer;
const { decodeBase64, encodeBase64 } = require("./base64Codec.js");
const backupService = require("./backupService.js");
const couponStore = require("./couponStore.js");
const friendStore = require("./friendStore.js");
const locationPreferenceStore = require("./locationPreferenceStore.js");
const planStore = require("./planStore.js");
const preferenceStore = require("./preferenceStore.js");
const privacyService = require("./privacyService.js");
const scheduleStore = require("./scheduleStore.js");

assert.strictEqual(encodeBase64("中文 🐰"), nativeBuffer.from("中文 🐰", "utf8").toString("base64"));
assert.strictEqual(decodeBase64("7aC97bCw"), "🐰"); // Legacy storageManager used CESU-8 for surrogate pairs.

function resetStorage() {
  storage.clear();
  privacyService.clearMemoryCache();
}

// The canonical exporter must work in the Mini Program runtime where Buffer is absent.
preferenceStore.savePreferences({ homeCity: "杭州", likedFoods: ["拉面"] });
friendStore.saveFriends([{ id: "friend_export", name: "导出好友 🐰", slots: ["周五 18:00-20:00"] }]);
scheduleStore.saveSchedules([{ id: "schedule_export", weekday: "周二", startTime: "19:00", endTime: "20:00", title: "导出日程" }]);
locationPreferenceStore.saveLocations([{
  id: "home",
  role: "home",
  name: "导出地点",
  address: "测试路 1 号",
  latitude: 30.1,
  longitude: 120.2,
}]);
couponStore.importCouponSnapshot({
  id: "coupon_attachment_export",
  title: "含截图的券",
  expireDate: "2099-12-31",
  screenshots: [{
    id: "shot_local_only",
    encrypted: true,
    encryptedPath: "/device-a/shot.enc",
    path: "/device-a/shot.enc",
  }],
});
global.Buffer = undefined;
const exported = backupService.exportBackupPayload();
global.Buffer = nativeBuffer;
assert.strictEqual(exported.success, true);
assert.strictEqual(exported.payload.startsWith("{"), false);
const decodedExport = JSON.parse(decodeBase64(exported.payload));
assert.strictEqual(decodedExport.format, backupService.BACKUP_FORMAT);
assert.strictEqual(decodedExport.preferences.homeCity, "杭州");
assert.strictEqual(decodedExport.friends[0].name, "导出好友 🐰");
assert.strictEqual(decodedExport.schedules[0].id, "schedule_export");
assert.strictEqual(decodedExport.locations[0].name, "导出地点");
assert.strictEqual(decodedExport.attachments.policy, "local_files_excluded");
assert.ok(decodedExport.attachments.omittedCount >= 1);
assert.deepStrictEqual(
  decodedExport.coupons.find((coupon) => coupon.id === "coupon_attachment_export").screenshots,
  [],
  "a portable backup must not retain device-local screenshot paths",
);

resetStorage();
const roundTrip = backupService.importBackupPayload(exported.payload);
assert.strictEqual(roundTrip.success, true);
assert.strictEqual(roundTrip.importedPreferences, 1);
assert.strictEqual(preferenceStore.readPreferences().homeCity, "杭州");
assert.strictEqual(friendStore.readFriends().some((friend) => friend.id === "friend_export"), true);
assert.strictEqual(scheduleStore.readSchedules()[0].id, "schedule_export");
assert.strictEqual(locationPreferenceStore.readLocations()[0].name, "导出地点");

// Raw v1 JSON remains importable and merges friends by id instead of duplicating them.
resetStorage();
friendStore.saveFriends([{ id: "friend_merge", name: "备份好友", slots: ["旧时段"] }]);
const rawV1 = {
  version: 1,
  coupons: [],
  plans: [],
  preferences: { homeCity: "成都" },
  friends: [{ id: "friend_merge", name: "备份好友", slots: ["周五 18:00-20:00"], restrictions: ["不吃辣"] }],
};
const rawResult = backupService.importBackupPayload(JSON.stringify(rawV1));
assert.strictEqual(rawResult.success, true);
assert.strictEqual(rawResult.importedFriends, 1);
const merged = friendStore.readFriends().filter((friend) => friend.id === "friend_merge");
assert.strictEqual(merged.length, 1);
assert.deepStrictEqual(merged[0].slots, ["周五 18:00-20:00"]);
assert.deepStrictEqual(merged[0].restrictions, ["不吃辣"]);
assert.strictEqual(preferenceStore.readPreferences().homeCity, "成都");

// Restoring terminal plans must not relink their coupons back to planned.
resetStorage();
const terminalResult = backupService.importBackupPayload(JSON.stringify({
  version: 1,
  coupons: [
    {
      id: "coupon_used_backup",
      title: "已使用券",
      statusCode: "used",
      expireDate: "2099-12-31",
      usedAt: "2026-08-01 12:00",
      planId: "plan_completed_backup",
      createdAt: "2026-07-01T08:00:00.000Z",
      source: "backup_round_trip",
      usageRules: { unavailableDays: ["周一"], notes: "需提前预约" },
      refundInfo: { non_refundable: true, lossAmount: 88 },
    },
    { id: "coupon_expired_backup", title: "已过期券", statusCode: "expired", expireDate: "2020-01-01" },
  ],
  plans: [
    { id: "plan_completed_backup", couponId: "coupon_used_backup", title: "已完成计划", statusCode: "completed" },
    { id: "plan_cancelled_backup", couponId: "coupon_expired_backup", title: "已取消计划", statusCode: "cancelled" },
  ],
  friends: [],
}));
assert.strictEqual(terminalResult.success, true);
assert.strictEqual(couponStore.findCoupon("coupon_used_backup").statusCode, "used");
assert.strictEqual(couponStore.findCoupon("coupon_expired_backup").statusCode, "expired");
const restoredUsedCoupon = couponStore.findCoupon("coupon_used_backup");
assert.strictEqual(restoredUsedCoupon.venue, "待补充店名", "legacy coupons without a merchant must remain restorable");
assert.strictEqual(restoredUsedCoupon.usedAt, "2026-08-01 12:00");
assert.strictEqual(restoredUsedCoupon.planId, "plan_completed_backup");
assert.strictEqual(restoredUsedCoupon.createdAt, "2026-07-01T08:00:00.000Z");
assert.strictEqual(restoredUsedCoupon.source, "backup_round_trip");
assert.deepStrictEqual(restoredUsedCoupon.usageRules.unavailableDays, ["周一"]);
assert.strictEqual(restoredUsedCoupon.usageRules.notes, "需提前预约");
assert.strictEqual(restoredUsedCoupon.refundInfo.non_refundable, true);
assert.strictEqual(restoredUsedCoupon.refundInfo.lossAmount, 88);
assert.strictEqual(planStore.getStoredPlans().find((plan) => plan.id === "plan_completed_backup").statusCode, "completed");
assert.strictEqual(planStore.getStoredPlans().find((plan) => plan.id === "plan_cancelled_backup").statusCode, "cancelled");

// A restored snapshot must replace any stale local override for the same coupon id.
resetStorage();
couponStore.importCouponSnapshot({
  id: "coupon_stale_override",
  title: "覆盖测试券",
  statusCode: "pending",
  expireDate: "2099-12-31",
});
couponStore.updateCouponStatus("coupon_stale_override", "planned");
const overrideResult = backupService.importBackupPayload(JSON.stringify({
  version: 1,
  coupons: [{
    id: "coupon_stale_override",
    title: "覆盖测试券",
    statusCode: "used",
    usedAt: "2026-08-02 18:30",
    expireDate: "2099-12-31",
  }],
  plans: [],
  friends: [],
}));
assert.strictEqual(overrideResult.success, true);
privacyService.clearMemoryCache();
assert.strictEqual(couponStore.findCoupon("coupon_stale_override").statusCode, "used");
assert.strictEqual(couponStore.findCoupon("coupon_stale_override").usedAt, "2026-08-02 18:30");

// Standard Base64 produced by the old Buffer-based exporter remains compatible.
resetStorage();
const bufferV1 = nativeBuffer.from(JSON.stringify({
  version: 1,
  coupons: [],
  plans: [],
  friends: [{ id: "friend_buffer", name: "Buffer 好友 🐼", slots: [] }],
}), "utf8").toString("base64");
const bufferResult = backupService.importBackupPayload(bufferV1);
assert.strictEqual(bufferResult.success, true);
assert.strictEqual(friendStore.readFriends().some((friend) => friend.name === "Buffer 好友 🐼"), true);

// The old storage-key v2 envelope still restores all whitelisted local data.
resetStorage();
const legacyV2 = {
  version: 2,
  exportTime: "2026-08-30T00:00:00.000Z",
  data: {
    life_helper_coupons: [],
    life_helper_plans_v2: [],
    life_helper_profile_preferences: { homeCity: "西安" },
    life_helper_friends: [{ id: "friend_legacy", name: "旧版好友", slots: [] }],
    life_helper_user_schedules: [{ id: "legacy_schedule", weekday: "周一", startTime: "09:00", endTime: "10:00", title: "旧日程" }],
  },
};
const legacyResult = backupService.importBackupPayload(encodeBase64(JSON.stringify(legacyV2)));
assert.strictEqual(legacyResult.success, true);
assert.strictEqual(legacyResult.legacyFormat, true);
assert.strictEqual(legacyResult.importedPreferences, 1);
assert.strictEqual(preferenceStore.readPreferences().homeCity, "西安");
assert.strictEqual(friendStore.readFriends().some((friend) => friend.id === "friend_legacy"), true);
assert.strictEqual(privacyService.readLocalData("life_helper_user_schedules", [])[0].id, "legacy_schedule");

// A legacy envelope containing only the old plans key is migrated into the active v2 repository.
resetStorage();
const oldPlansOnly = {
  version: 2,
  data: {
    life_helper_plans_v2: [],
    life_helper_plans: [{ id: "legacy_plan_v1", title: "旧键计划", statusCode: "cancelled" }],
  },
};
const oldPlansResult = backupService.importBackupPayload(encodeBase64(JSON.stringify(oldPlansOnly)));
assert.strictEqual(oldPlansResult.success, true);
assert.strictEqual(oldPlansResult.importedPlans, 1);
assert.strictEqual(planStore.getStoredPlans().some((plan) => plan.id === "legacy_plan_v1"), true);

// Invalid input is rejected before any storage write occurs.
const beforeInvalidImport = JSON.stringify(Array.from(storage.entries()));
const invalidResult = backupService.importBackupPayload("not a backup payload");
assert.strictEqual(invalidResult.success, false);
assert.strictEqual(JSON.stringify(Array.from(storage.entries())), beforeInvalidImport);

const foreignFormatResult = backupService.importBackupPayload(JSON.stringify({
  format: "different-product-backup",
  version: 1,
  coupons: [],
}));
assert.strictEqual(foreignFormatResult.success, false, "foreign backup formats must be rejected");

const futureVersionResult = backupService.importBackupPayload(JSON.stringify({
  format: backupService.BACKUP_FORMAT,
  version: backupService.BACKUP_VERSION + 1,
  coupons: [],
}));
assert.strictEqual(futureVersionResult.success, false, "future incompatible backup versions must be rejected");

const excessiveItemsResult = backupService.importBackupPayload(JSON.stringify({
  format: backupService.BACKUP_FORMAT,
  version: backupService.BACKUP_VERSION,
  friends: Array.from({ length: (backupService.MAX_COLLECTION_ITEMS || 1000) + 1 }, (_, index) => ({
    id: `friend_excess_${index}`,
    name: `好友${index}`,
  })),
}));
assert.strictEqual(excessiveItemsResult.success, false, "oversized backup collections must be rejected");

const excessiveTextResult = backupService.importBackupPayload(JSON.stringify({
  format: backupService.BACKUP_FORMAT,
  version: backupService.BACKUP_VERSION,
  preferences: { note: "x".repeat((backupService.MAX_BACKUP_TEXT_CHARS || (2 * 1024 * 1024)) + 1) },
}));
assert.strictEqual(excessiveTextResult.success, false, "oversized backup text must be rejected before import");

console.log("privacy backup tests ok");
