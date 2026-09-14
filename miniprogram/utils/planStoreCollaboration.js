/**
 * planStore.js
 * 计划履约数据层（Facade 门面）
 * 串联 planNormalizer (模型转换与清洗)、planRiskEvaluator (风险评估规则链) 与 planRepository (本地仓储与缓存)
 */

const normalizer = require("./plan/planNormalizer.js");
const riskEvaluator = require("./plan/planRiskEvaluator.js");
const repository = require("./plan/planRepository.js");
const eventLogger = require("./eventLogger.js");
const {
  VALID_TRANSITIONS,
  VALID_STATUS_CODES,
  asValidStatusCode,
  canTransitionPlanStatus,
  getPlans,
  getStoredPlans,
  saveStoredPlans,
  findPlan,
  findStoredPlan,
  getPlanById,
  getPlan,
} = require("./planStoreCore.js");
const {
  createPlan,
  restoreCouponSnapshots,
  bulkUpsertPlans,
} = require("./planStoreTransaction.js");
const {
  upsertStoredPlan,
  savePlan,
  buildPlanFromRecommendation,
  createPlanFromRecommendation,
  restorePlanSnapshot,
  removeTemporaryDirectUsePlan,
  removeImportedPlan,
  createManualPlanFromSpin,
} = require("./planStoreBuilders.js");
const {
  updatePlan,
  updatePlanStatus,
  completePlan,
  cancelPlan,
  reschedulePlan,
} = require("./planStoreLifecycle.js");

function updateReservationStatus(id, status = "confirmed") {
  const plan = findPlan(id);
  if (!plan || !["confirmed", "rescheduled"].includes(plan.statusCode)) return null;
  if (!["confirmed", "failed"].includes(status)) return null;

  const logText = status === "confirmed" ? "商家预约已确认。" : "预约未成功，建议重新协调。";
  return updatePlan(id, {
    reservationStatus: status,
    changeLogs: (plan.changeLogs || []).concat({
      type: "reservation_updated",
      text: logText,
      createdAt: normalizer.nowText(),
    }),
  });
}

function markFriendConfirmed(id) {
  const plan = findPlan(id);
  if (!plan) return null;
  // Re-applying a confirmed invite is an idempotent participant update, not a
  // state transition. Terminal plans must never be revived by a late cloud
  // response, even if another administrative transition permits reopening.
  if (plan.statusCode !== "confirmed"
    && !["pending", "rescheduled"].includes(plan.statusCode)) return null;

  const participants = (plan.participants || []).map((p) => (p.id !== "self" ? Object.assign({}, p, { status: "confirmed" }) : p));
  return updatePlan(id, {
    updatedAt: new Date().toISOString(),
    participants,
    statusCode: "confirmed",
    status: normalizer.statusLabel("confirmed"),
    statusClass: normalizer.statusClass("confirmed"),
    changeLogs: (plan.changeLogs || []).concat({
      type: "friend_confirmed",
      text: "朋友已确认参与，计划正式生效！",
      createdAt: normalizer.nowText(),
    }),
  });
}

function markFriendRejected(id, reason = "") {
  const plan = findPlan(id);
  if (!plan || !["pending", "rescheduled"].includes(plan.statusCode)) return null;

  const participants = (plan.participants || []).map((p) => (p.id !== "self" ? Object.assign({}, p, { status: "rejected" }) : p));
  return updatePlan(id, {
    updatedAt: new Date().toISOString(),
    participants,
    changeLogs: (plan.changeLogs || []).concat({
      type: "friend_rejected",
      text: `朋友暂时不方便。${reason ? `原因：${reason}` : ""}`,
      createdAt: normalizer.nowText(),
    }),
  });
}

function attachInvite(id, invite = {}) {
  const plan = findPlan(id);
  if (!plan) return null;
  const inviteId = invite && (invite.inviteId || invite.id) || "";
  // Detaching a stale invite is valid even after a plan becomes terminal, but
  // an asynchronous invite response must not become attached after completion
  // or cancellation.
  if (inviteId && !["draft", "pending", "confirmed", "rescheduled"].includes(plan.statusCode)) {
    return null;
  }
  return updatePlan(id, {
    inviteId,
    inviteSnapshot: inviteId ? invite : null,
  });
}

function updateFeedback(id, feedback = {}) {
  const plan = findPlan(id);
  if (!plan || plan.statusCode !== "completed") return null;
  return updatePlan(id, {
    feedback,
  });
}

module.exports = {
  updateReservationStatus,
  markFriendConfirmed,
  markFriendRejected,
  attachInvite,
  updateFeedback,
};
