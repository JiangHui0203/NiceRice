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

function createPlan(planData, options = {}) {
  const persistedStatusCode = typeof riskEvaluator.getPersistedStatusCode === "function"
    ? asValidStatusCode(riskEvaluator.getPersistedStatusCode(planData))
    : "";
  const normalizationSource = persistedStatusCode && planData && planData.statusCode === "expired"
    ? Object.assign({}, planData, { statusCode: persistedStatusCode })
    : planData;
  const plan = normalizer.normalizePlan(normalizationSource);
  if (!plan) return null;

  const previousPlans = repository.getStoredPlans();
  const current = previousPlans.slice();
  const existingIndex = current.findIndex((item) => item.id === plan.id);

  if (existingIndex > -1) {
    if (String(current[existingIndex].couponId || "") !== String(plan.couponId || "")) {
      // Relinking an existing plan must update both coupons atomically. No
      // current caller performs that transaction, so reject the partial move.
      return null;
    }
    current[existingIndex] = plan;
  } else {
    current.unshift(plan);
  }

  if (!repository.saveStoredPlans(current)) return null;
  if (plan.couponId && options.linkCoupon !== false) {
    try {
      const couponStore = require("./couponStore.js");
      if (!couponStore.linkPlan(plan.couponId, plan.id)) {
        if (!repository.saveStoredPlans(previousPlans)) {
          console.warn("Plan/coupon link failed and plan rollback was not persisted:", plan.id, plan.couponId);
        }
        return null;
      }
    } catch (error) {
      if (!repository.saveStoredPlans(previousPlans)) {
        console.warn("Plan/coupon link threw and plan rollback was not persisted:", plan.id, error);
      }
      return null;
    }
  }
  return plan;
}

function restoreCouponSnapshots(couponStore, snapshots = []) {
  if (couponStore && typeof couponStore.importCouponSnapshots === "function") {
    try {
      const restored = couponStore.importCouponSnapshots(snapshots);
      return Boolean(restored && restored.success === true
        && restored.successIds.length === snapshots.length);
    } catch (error) {
      return false;
    }
  }
  let restored = true;
  snapshots.slice().reverse().forEach((snapshot) => {
    try {
      if (!couponStore.importCouponSnapshot(snapshot)) restored = false;
    } catch (error) {
      restored = false;
    }
  });
  return restored;
}

/**
 * All-or-nothing batch upsert. The plan library is persisted at most once.
 * Coupon links are prevalidated and staged before that single commit; any
 * failed stage restores the coupon snapshots and leaves the plan set untouched.
 */
function bulkUpsertPlans(planDataList = [], options = {}) {
  const settings = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  let transaction;
  try {
    transaction = repository.prepareBulkUpsert(planDataList);
  } catch (error) {
    return { success: false, code: "plan_storage_read_failed", plans: [], successIds: [] };
  }
  if (!transaction || transaction.success !== true) {
    return Object.assign({ plans: [], successIds: [] }, transaction || { success: false, code: "prepare_failed" });
  }

  const shouldLinkCoupons = settings.linkCoupon !== false && settings.linkCoupons !== false;
  const linkedCandidates = shouldLinkCoupons
    ? transaction.candidates.filter((plan) => Boolean(plan.couponId))
    : [];
  let couponStore = null;
  const couponStages = [];
  const couponLinks = [];
  let supportsBatchCouponLink = false;

  if (linkedCandidates.length) {
    try {
      couponStore = require("./couponStore.js");
    } catch (error) {
      return { success: false, code: "coupon_store_unavailable", plans: [], successIds: [] };
    }
    supportsBatchCouponLink = typeof couponStore.linkPlans === "function";

    const candidateByCouponId = new Map();
    const ownerByCouponId = new Map();
    const conflictingOwnerByCouponId = new Map();
    transaction.nextPlans.forEach((item) => {
      if (!item || !item.couponId) return;
      if (!ownerByCouponId.has(item.couponId)) {
        ownerByCouponId.set(item.couponId, item.id);
        return;
      }
      const ownerId = ownerByCouponId.get(item.couponId);
      if (ownerId !== item.id && !conflictingOwnerByCouponId.has(item.couponId)) {
        conflictingOwnerByCouponId.set(item.couponId, item.id);
      }
    });
    for (let index = 0; index < linkedCandidates.length; index += 1) {
      const plan = linkedCandidates[index];
      const previousPlanId = candidateByCouponId.get(plan.couponId);
      if (previousPlanId && previousPlanId !== plan.id) {
        return {
          success: false,
          code: "duplicate_coupon_link",
          couponId: plan.couponId,
          plans: [],
          successIds: [],
        };
      }
      candidateByCouponId.set(plan.couponId, plan.id);

      const ownerId = ownerByCouponId.get(plan.couponId);
      const secondOwnerId = conflictingOwnerByCouponId.get(plan.couponId);
      const conflictingPlanId = ownerId && ownerId !== plan.id
        ? ownerId
        : (secondOwnerId && secondOwnerId !== plan.id ? secondOwnerId : "");
      if (conflictingPlanId) {
        return {
          success: false,
          code: "coupon_already_referenced",
          couponId: plan.couponId,
          planId: conflictingPlanId,
          plans: [],
          successIds: [],
        };
      }

      couponLinks.push({ couponId: plan.couponId, planId: plan.id });
      if (supportsBatchCouponLink) continue;

      let coupon = null;
      try {
        coupon = couponStore.findCoupon(plan.couponId);
      } catch (error) {}
      if (!coupon) {
        return { success: false, code: "coupon_not_found", couponId: plan.couponId, plans: [], successIds: [] };
      }
      if (["used", "expired"].includes(coupon.statusCode)) {
        return { success: false, code: "coupon_not_linkable", couponId: plan.couponId, plans: [], successIds: [] };
      }
      if (coupon.planId && coupon.planId !== plan.id) {
        return {
          success: false,
          code: "coupon_link_conflict",
          couponId: plan.couponId,
          planId: coupon.planId,
          plans: [],
          successIds: [],
        };
      }
      couponStages.push({ coupon, plan });
    }
  }

  const mutatedCouponSnapshots = [];
  let couponRollbackToken = null;
  if (supportsBatchCouponLink && couponLinks.length) {
    let linkedBatch = null;
    try {
      linkedBatch = couponStore.linkPlans(couponLinks);
    } catch (error) {}
    const batchResultValid = linkedBatch && linkedBatch.success === true
      && Array.isArray(linkedBatch.successIds)
      && linkedBatch.successIds.length === couponLinks.length
      && Array.isArray(linkedBatch.linkedCoupons)
      && linkedBatch.linkedCoupons.length === couponLinks.length
      && Array.isArray(linkedBatch.previousCoupons)
      && linkedBatch.successIds.every((id, index) => id === couponLinks[index].couponId)
      && linkedBatch.linkedCoupons.every((coupon, index) => (
        coupon && coupon.id === couponLinks[index].couponId
          && coupon.planId === couponLinks[index].planId
          && coupon.statusCode === "planned"
      ));
    if (!batchResultValid) {
      const reportedCode = linkedBatch && linkedBatch.code;
      const knownCodes = new Set([
        "coupon_not_found",
        "coupon_not_linkable",
        "coupon_link_conflict",
        "duplicate_coupon_link",
        "duplicate_plan_link",
        "coupon_link_failed",
        "coupon_rollback_failed",
      ]);
      let rollbackOk = linkedBatch && typeof linkedBatch.consistencyRestored === "boolean"
        ? linkedBatch.consistencyRestored
        : true;
      if (linkedBatch && linkedBatch.rollbackToken
        && typeof couponStore.rollbackPlanLinks === "function") {
        try {
          rollbackOk = couponStore.rollbackPlanLinks(linkedBatch.rollbackToken);
        } catch (error) {
          rollbackOk = false;
        }
      } else if (linkedBatch && Array.isArray(linkedBatch.previousCoupons)
        && linkedBatch.previousCoupons.length) {
        rollbackOk = restoreCouponSnapshots(couponStore, linkedBatch.previousCoupons);
      }
      const resolvedCode = rollbackOk && knownCodes.has(reportedCode)
        ? reportedCode
        : (rollbackOk ? "coupon_link_failed" : "coupon_rollback_failed");
      const failureResult = {
        success: false,
        code: resolvedCode,
        couponId: linkedBatch && linkedBatch.couponId || couponLinks[0].couponId,
        plans: [],
        successIds: [],
      };
      if (linkedBatch && linkedBatch.planId) failureResult.planId = linkedBatch.planId;
      if (resolvedCode === "coupon_link_failed" || resolvedCode === "coupon_rollback_failed") {
        failureResult.consistencyRestored = rollbackOk;
      }
      return failureResult;
    }
    (linkedBatch.previousCoupons || []).forEach((coupon) => mutatedCouponSnapshots.push(coupon));
    couponRollbackToken = linkedBatch.rollbackToken || null;
  } else {
    for (let index = 0; index < couponStages.length; index += 1) {
      const stage = couponStages[index];
      if (stage.coupon.planId === stage.plan.id && stage.coupon.statusCode === "planned") continue;
      let linked = null;
      try {
        linked = couponStore.linkPlan(stage.coupon.id, stage.plan.id);
      } catch (error) {}
      if (!linked) {
        // Include the current coupon as well: a storage adapter may report a
        // failed write after touching its in-memory cache.
        const rollbackOk = restoreCouponSnapshots(
          couponStore,
          mutatedCouponSnapshots.concat(stage.coupon),
        );
        return {
          success: false,
          code: rollbackOk ? "coupon_link_failed" : "coupon_rollback_failed",
          couponId: stage.coupon.id,
          consistencyRestored: rollbackOk,
          plans: [],
          successIds: [],
        };
      }
      mutatedCouponSnapshots.push(stage.coupon);
    }
  }

  let committed = false;
  try {
    committed = repository.commitPreparedBulkUpsert(transaction);
  } catch (error) {
    committed = false;
  }
  if (!committed) {
    let couponRollbackOk = true;
    if (couponRollbackToken && couponStore && typeof couponStore.rollbackPlanLinks === "function") {
      try {
        couponRollbackOk = couponStore.rollbackPlanLinks(couponRollbackToken);
      } catch (error) {
        couponRollbackOk = false;
      }
    } else if (couponStore) {
      couponRollbackOk = restoreCouponSnapshots(couponStore, mutatedCouponSnapshots);
    }
    let planRollbackOk = false;
    try {
      planRollbackOk = repository.saveStoredPlans(transaction.previousPlans);
    } catch (error) {
      planRollbackOk = false;
    }
    const rollbackOk = Boolean(couponRollbackOk && planRollbackOk);
    return {
      success: false,
      code: couponRollbackOk ? "plan_storage_write_failed" : "coupon_rollback_failed",
      consistencyRestored: rollbackOk,
      plans: [],
      successIds: [],
    };
  }

  return {
    success: true,
    code: "ok",
    plans: transaction.candidates,
    successIds: transaction.candidates.map((plan) => plan.id),
  };
}

// Backward-compatible name used by import and heatmap flows. Callers restoring
// a full snapshot can disable coupon linking to preserve terminal coupon state.

module.exports = {
  createPlan,
  restoreCouponSnapshots,
  bulkUpsertPlans,
};
