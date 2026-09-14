const assert = require("assert");
const {
  buildShareDataPackage,
  completePlanAction,
  parseSharedPlanData,
  selectPlanSnapshot,
} = require("./planDetailHelper.js");
const planStore = require("../../utils/planStore.js");
const couponStore = require("../../utils/couponStore.js");

const originalCompletePlan = planStore.completePlan;
const originalMarkUsed = couponStore.markUsed;
const originalUpdateCouponStatus = couponStore.updateCouponStatus;
let helperCouponWriteCalls = 0;
planStore.completePlan = (planId) => ({ id: planId, couponId: "coupon_complete_once", statusCode: "completed" });
couponStore.markUsed = () => {
  helperCouponWriteCalls += 1;
  return { id: "coupon_complete_once", statusCode: "used" };
};
couponStore.updateCouponStatus = () => {
  helperCouponWriteCalls += 1;
  return { id: "coupon_complete_once", statusCode: "used" };
};
try {
  const completion = completePlanAction({ id: "plan_complete_once", couponId: "coupon_complete_once" });
  assert.strictEqual(completion.success, true);
  assert.strictEqual(helperCouponWriteCalls, 0, "planStore.completePlan already completes its coupon; the helper must not mutate it again");
} finally {
  planStore.completePlan = originalCompletePlan;
  couponStore.markUsed = originalMarkUsed;
  couponStore.updateCouponStatus = originalUpdateCouponStatus;
}

const payload = {
  plan: {
    id: "p1",
    title: "双人餐 50% 优惠",
    statusCode: "pending",
    reservationStatus: "unknown",
    selectedTime: { date: "2026-09-01", startTime: "19:00" },
  },
  coupon: null,
  invite: {
    id: "invite_payload_123",
    inviteId: "invite_payload_123",
    planId: "p1",
    status: "pending",
    syncStatus: "local",
  },
};
const raw = JSON.stringify(payload);
const parsedPayload = parseSharedPlanData(raw);
assert.strictEqual(parsedPayload.plan.id, "p1");
assert.strictEqual(parsedPayload.plan.title, "双人餐 50% 优惠");
assert.strictEqual(parsedPayload.invite.inviteId, "invite_payload_123");
assert.deepStrictEqual(parseSharedPlanData(encodeURIComponent(raw)), parsedPayload);
assert.deepStrictEqual(parseSharedPlanData(encodeURIComponent(encodeURIComponent(raw))), parsedPayload);
assert.strictEqual(parseSharedPlanData("%not-valid"), null);

const share = buildShareDataPackage({
  id: "p2",
  date: "2026-08-30",
  title: "聚餐",
  statusCode: "pending",
  reservationStatus: "unknown",
  selectedTime: { date: "2026-08-30", startTime: "18:00" },
}, {}, { inviteId: "invite_share_123", planId: "p2", status: "pending" }, "p2");
assert.ok(share.title.includes("18:00"));

const privateShare = buildShareDataPackage({
  id: "p_private",
  couponId: "coupon_private",
  title: "隐私分享",
  statusCode: "pending",
  selectedTime: { date: "2026-09-01", startTime: "19:00", internal: "drop" },
  reservationStatus: "unknown",
  note: "不应分享的备注",
  dishes: "不应分享的菜品",
  participants: [{ id: "friend-secret", name: "不应分享的名单" }],
  recommendationSnapshot: { internalScore: 99 },
  inviteSnapshot: { secret: true },
}, {
  id: "coupon_private",
  title: "测试券",
  statusCode: "planned",
  screenshots: [{ path: "/private/image.jpg" }],
  note: "不应分享的券备注",
}, {
  inviteId: "inv_private_123",
  planId: "p_private",
  status: "pending",
  planUpdatedAt: "2026-09-01T00:00:00.000Z",
  planSnapshot: { secret: true },
}, "p_private");
assert.ok(privateShare.path.length < 1024, "plan share path must remain within the mini-program path limit");
const privatePayload = parseSharedPlanData(privateShare.path.split("planData=")[1]);
assert.strictEqual(privatePayload.plan.note, undefined);
assert.strictEqual(privatePayload.plan.dishes, undefined);
assert.strictEqual(privatePayload.plan.participants, undefined);
assert.strictEqual(privatePayload.plan.recommendationSnapshot, undefined);
assert.strictEqual(privatePayload.plan.selectedTime.internal, undefined);
assert.strictEqual(privatePayload.coupon.screenshots, undefined);
assert.strictEqual(privatePayload.invite.planSnapshot, undefined);

const revisionWinner = selectPlanSnapshot({
  localPlan: { id: "p3", title: "本地 revision 3", revision: 3, updatedAt: "2026-08-01T00:00:00.000Z", statusCode: "pending" },
  fetchedInvite: {
    syncStatus: "cloud",
    planSnapshot: { id: "p3", title: "远端 revision 2", revision: 2, updatedAt: "2026-08-30T00:00:00.000Z", statusCode: "confirmed" },
  },
});
assert.strictEqual(revisionWinner.plan.title, "本地 revision 3", "revision must take precedence over updatedAt and status");

const timestampWinner = selectPlanSnapshot({
  localPlan: { id: "p4", title: "本地旧快照", updatedAt: "2026-08-01T00:00:00.000Z", statusCode: "confirmed" },
  fetchedInvite: {
    syncStatus: "cloud",
    planSnapshot: { id: "p4", title: "远端新快照", updatedAt: "2026-08-30T00:00:00.000Z", statusCode: "pending" },
  },
});
assert.strictEqual(timestampWinner.source, "remote", "updatedAt must decide when revisions are missing");

const legacyLocalWinner = selectPlanSnapshot({
  sharedPlan: { id: "p5", title: "分享旧状态", statusCode: "pending" },
  localPlan: { id: "p5", title: "本地已确认", statusCode: "confirmed" },
  fetchedInvite: null,
});
assert.strictEqual(legacyLocalWinner.source, "local", "legacy local progress must not be rolled back by a shared snapshot");

const legacyRemoteWinner = selectPlanSnapshot({
  localPlan: { id: "p6", title: "本地待确认", statusCode: "pending" },
  fetchedInvite: {
    syncStatus: "cloud",
    planSnapshot: { id: "p6", title: "远端已改期", statusCode: "rescheduled" },
  },
});
assert.strictEqual(legacyRemoteWinner.source, "remote", "legacy remote progress must be allowed to beat an older local state");

const localChangeLogWinner = selectPlanSnapshot({
  localPlan: {
    id: "p7",
    title: "本地刚改期",
    statusCode: "rescheduled",
    changeLogs: [{ type: "rescheduled", createdAt: "2026-08-30 18:30" }],
  },
  fetchedInvite: {
    syncStatus: "cloud",
    planSnapshot: {
      id: "p7",
      title: "远端旧改期",
      statusCode: "rescheduled",
      changeLogs: [{ type: "rescheduled", createdAt: "2026-08-29 18:30" }],
    },
  },
});
assert.strictEqual(localChangeLogWinner.source, "local", "latest change log time must break same-status legacy ties before source");

const refreshedSharedWinner = selectPlanSnapshot({
  sharedPlan: { id: "p8", title: "卡片中的改期计划", statusCode: "rescheduled" },
  sharedInvite: { inviteId: "i8", planUpdatedAt: "2026-08-30T18:30:00.000Z" },
  fetchedInvite: {
    inviteId: "i8",
    planUpdatedAt: "2026-08-29T18:30:00.000Z",
    planSnapshot: { id: "p8", title: "云端旧计划", statusCode: "rescheduled" },
  },
});
assert.strictEqual(refreshedSharedWinner.source, "shared", "a refreshed re-share must beat an older cloud snapshot for the same invite");

const statusEnvelopeMustNotWin = selectPlanSnapshot({
  localPlan: {
    id: "p9",
    title: "本地已确认",
    statusCode: "confirmed",
    updatedAt: "2026-08-30T12:34:56.300Z",
    changeLogs: [{ type: "friend_confirmed", createdAt: "2026-08-30 12:34" }],
  },
  fetchedInvite: {
    syncStatus: "cloud",
    createdAt: "2026-08-30T12:00:00.000Z",
    planUpdatedAt: "2026-08-30T12:34:30.000Z",
    updatedAt: "2026-08-30T12:34:56.200Z",
    planSnapshot: {
      id: "p9",
      title: "远端旧待确认",
      statusCode: "pending",
      changeLogs: [{ type: "created", createdAt: "2026-08-30 12:00" }],
    },
  },
});
assert.strictEqual(statusEnvelopeMustNotWin.source, "local", "a status-only invite.updatedAt must not make its old plan snapshot newer");

const globalRevisionWinner = selectPlanSnapshot({
  sharedPlan: { id: "p10", title: "shared revision 3", revision: 3, updatedAt: "2026-08-01T00:00:00.000Z" },
  fetchedInvite: {
    syncStatus: "cloud",
    planSnapshot: { id: "p10", title: "unversioned remote", updatedAt: "2026-08-15T00:00:00.000Z" },
  },
  localPlan: { id: "p10", title: "local revision 2", revision: 2, updatedAt: "2026-08-30T00:00:00.000Z" },
});
assert.strictEqual(globalRevisionWinner.plan.title, "shared revision 3", "the highest explicit revision must win globally");

console.log("plan detail helper tests ok");
