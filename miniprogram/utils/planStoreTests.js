const assert = require("assert");

delete global.wx;
const planStore = require("./planStore.js");

const fromRecommendation = planStore.createPlanFromRecommendation(
  { id: "coupon_plan_store_test", title: "持久化测试券", category: "food" },
  { score: 88, reasons: ["测试"] },
  null,
  { statusCode: "confirmed", linkCoupon: false }
);
assert.ok(fromRecommendation && fromRecommendation.id);
assert.strictEqual(planStore.getStoredPlans().some((plan) => plan.id === fromRecommendation.id), true);
assert.strictEqual(planStore.getPlan(fromRecommendation.id).id, fromRecommendation.id);

const manualDraft = planStore.createManualPlanFromSpin({ title: "拉面", categoryKey: "food" });
assert.strictEqual(manualDraft.statusCode, "draft");
assert.strictEqual(planStore.getStoredPlans().some((plan) => plan.id === manualDraft.id), true);

const manualScheduled = planStore.createManualPlanFromSpin(
  { title: "烧烤", categoryKey: "food" },
  { selectedTime: { date: "2026-08-30", startTime: "18:30", endTime: "20:00", label: "今晚" } }
);
assert.strictEqual(manualScheduled.statusCode, "confirmed");

const saved = planStore.savePlan({ id: "shared_plan_test", title: "好友分享计划", statusCode: "pending" });
assert.strictEqual(planStore.getPlanById(saved.id).title, "好友分享计划");

const rescheduled = planStore.reschedulePlan(saved.id, {
  date: "2026-08-31",
  startTime: "19:30",
  label: "明晚 19:30",
});
assert.ok(rescheduled.updatedAt && Number.isFinite(Date.parse(rescheduled.updatedAt)), "reschedules need precise freshness metadata");

planStore.updatePlan(saved.id, {
  participants: [{ id: "self", name: "我" }, { id: "friend", name: "好友", status: "pending" }],
});
const confirmed = planStore.markFriendConfirmed(saved.id);
assert.ok(confirmed.updatedAt && Number.isFinite(Date.parse(confirmed.updatedAt)), "invite confirmation needs precise freshness metadata");

console.log("plan store tests ok");
