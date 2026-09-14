const assert = require("assert");
const activityLogStore = require("./activityLogStore.js");
const planStore = require("./planStore.js");
const couponStore = require("./couponStore.js");

console.log("=== Testing Activity Log Store & Lifecycle Audit ===");

// 1. Clear previous logs
activityLogStore.clearAllLogs();
assert.strictEqual(activityLogStore.getActivityLogs().length, 0, "Activity logs should be empty initially");

// 2. Direct log entry recording
const testEntry = activityLogStore.recordActivityLog({
  entityType: "plan",
  entityId: "p_test_101",
  action: "completed",
  title: "寿喜烧双人餐",
  category: "火锅",
  finance: {
    originalPrice: 288,
    actualPaid: 168,
    savedAmount: 120,
    participantCount: 2,
  },
  executionSnapshot: {
    venue: "一期一会寿喜烧",
    scheduledDate: "2026-08-15",
    scheduledTime: "18:30",
    participants: ["我", "小王"],
  },
  feedback: {
    rating: 5,
    tags: ["肉质好", "性价比高"],
    comment: "和朋友吃得很开心",
  },
});

assert.ok(testEntry.logId, "Log entry should have a unique logId");
assert.strictEqual(testEntry.finance.savedAmount, 120, "Saved amount should be 120");
assert.strictEqual(testEntry.finance.perPersonCost, 84, "Per person cost should be 84");

// 3. Stats computation
const stats = activityLogStore.getStatisticsSummary();
assert.strictEqual(stats.completedCount, 1, "Completed count should be 1");
assert.strictEqual(stats.totalCost, "168.0", "Total cost should be 168.0");
assert.strictEqual(stats.totalSaved, "120.0", "Total saved should be 120.0");
assert.strictEqual(stats.topFriend, "小王", "Top friend should be 小王");

// 4. Integration with couponStore and planStore
// 5. Test Coupon usage, completion snapshot, and deletion isolation
const noodleCoupon = couponStore.saveCoupon({
  title: "精品拉面套餐",
  venue: "一风堂拉面",
  type: "粉面",
  price: "35",
  originalPrice: "68",
  expireDate: "2099-12-31",
});

couponStore.updateCouponStatus(noodleCoupon.id, "used");
const usedLogs = activityLogStore.getActivityLogs({ action: "completed" });
assert.ok(usedLogs.some(l => l.entityId === noodleCoupon.id), "Coupon use should generate immutable log");

// Now delete the coupon from active store
couponStore.deleteCoupon(noodleCoupon.id);
assert.strictEqual(couponStore.findCoupon(noodleCoupon.id), null, "Coupon should be deleted from active store");

// Verify history log still exists with full snapshot even after coupon deletion
const historyLogsAfterDelete = activityLogStore.getActivityLogs({ action: "completed" });
const preservedLog = historyLogsAfterDelete.find(l => l.entityId === noodleCoupon.id);
assert.ok(preservedLog, "History ledger MUST remain completely intact after coupon deletion");
assert.strictEqual(preservedLog.title, "精品拉面套餐", "History snapshot title should match");

// 6. Test re-ordering creates a brand new independent coupon with fresh expiry
const newReorderCoupon = couponStore.saveCoupon({
  id: `c_${Date.now()}_reorder`,
  title: preservedLog.title,
  venue: preservedLog.executionSnapshot.venue,
  type: preservedLog.category,
  price: String(preservedLog.finance.actualPaid),
  originalPrice: String(preservedLog.finance.originalPrice),
  expireDate: "2099-12-31",
  statusCode: "unplanned",
});

assert.notStrictEqual(newReorderCoupon.id, noodleCoupon.id, "Reordered coupon must have a new unique ID");
assert.strictEqual(newReorderCoupon.statusCode, "pending", "Reordered coupon must be in fresh pending state");
assert.strictEqual(newReorderCoupon.expireDate, "2099-12-31", "Reordered coupon must have fresh validity period");

// Completing a plan owns the completion ledger entry. Its internal coupon
// synchronization must not add a second activity record for the same action.
const completionCoupon = couponStore.importCouponSnapshot({
  id: "coupon_plan_completion_log",
  title: "完成日志测试券",
  venue: "测试餐厅",
  statusCode: "pending",
  expireDate: "2099-12-31",
});
const completionPlan = planStore.createPlan({
  id: "plan_completion_log",
  couponId: completionCoupon.id,
  title: "完成日志测试计划",
  statusCode: "confirmed",
  selectedTime: {
    date: "2099-12-31",
    weekday: "周四",
    startTime: "18:00",
    endTime: "20:00",
    scene: "晚餐",
  },
});
activityLogStore.clearAllLogs();
assert.ok(planStore.completePlan(completionPlan.id));
const completionLogs = activityLogStore.getActivityLogs({ action: "completed" });
assert.strictEqual(completionLogs.length, 1, "plan completion must emit one activity record");
assert.strictEqual(completionLogs[0].entityType, "plan");
assert.strictEqual(couponStore.findCoupon(completionCoupon.id).statusCode, "used");

// Clean up test log
activityLogStore.clearAllLogs();
console.log("✔ All Activity Log tests passed successfully!");
