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

function updatePlan(id, patch = {}) {
  // Mutations must be based on the durable record, not fetchAllPlans()'s
  // context-dependent risk view. Otherwise a transient derived `expired`
  // state can be written back permanently by an unrelated edit.
  const plan = findStoredPlan(id);
  if (!plan) return null;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return null;
  if (Object.prototype.hasOwnProperty.call(patch, "id")
    && String(patch.id === undefined || patch.id === null ? "" : patch.id).trim() !== plan.id) {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "couponId")
    && String(patch.couponId === undefined || patch.couponId === null ? "" : patch.couponId).trim()
      !== String(plan.couponId || "")) {
    // Changing the linked coupon requires a two-domain relink transaction;
    // the ordinary plan patch API must never leave the old/new coupon stale.
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "statusCode")) {
    const targetStatus = asValidStatusCode(patch.statusCode);
    if (!targetStatus) return null;
    if (targetStatus !== plan.statusCode && !canTransitionPlanStatus(plan.statusCode, targetStatus)) return null;
  }

  const updated = normalizer.normalizePlan(Object.assign({}, plan, patch));
  if (!updated) return null;
  const current = repository.getStoredPlans();
  const index = current.findIndex((item) => item.id === id);

  if (index > -1) {
    current[index] = updated;
  } else {
    current.unshift(updated);
  }

  if (!repository.saveStoredPlans(current)) return null;
  return updated;
}

function updatePlanStatus(id, newStatus, reason = "") {
  const plan = findPlan(id);
  if (!plan) return null;

  const targetStatus = asValidStatusCode(newStatus);
  if (!targetStatus || !canTransitionPlanStatus(plan.statusCode, targetStatus)) return null;
  const logText = reason || `计划状态更新为${normalizer.statusLabel(targetStatus)}。`;

  return updatePlan(id, {
    statusCode: targetStatus,
    status: normalizer.statusLabel(targetStatus),
    statusClass: normalizer.statusClass(targetStatus),
    changeLogs: (plan.changeLogs || []).concat({
      type: "status_changed",
      text: logText,
      createdAt: normalizer.nowText(),
    }),
  });
}

function completePlan(id, options = {}) {
  const original = repository.getStoredPlans().find((item) => item.id === id);
  if (!original) return null;
  const updated = updatePlanStatus(id, "completed", "已完成打卡。");
  if (!updated) return null;

  let completedCoupon = null;
  if (updated.couponId) {
    try {
      const couponStore = require("./couponStore.js");
      completedCoupon = couponStore.markUsed(updated.couponId, options.usedAt || normalizer.nowText(), {
        skipActivityLog: true,
        usageNote: options.usageNote || "",
      });
    } catch (error) {
      console.warn("Plan completion coupon update threw:", error);
    }
    if (!completedCoupon) {
      if (!restorePlanSnapshot(original)) {
        console.warn("Coupon update failed and plan rollback could not be persisted:", updated.id);
      }
      return null;
    }
  }

  // Completion side effects are deliberately delayed until both the plan and
  // linked coupon have reached their terminal state.
  try {
    eventLogger.logEvent("plan_completed", { planId: updated.id, couponId: updated.couponId });
  } catch (error) {
    console.warn("plan_completed log failed:", error);
  }
  try {
    const activityLogStore = require("./activityLogStore.js");
    const couponStore = require("./couponStore.js");
    const coupon = completedCoupon || (updated.couponId ? couponStore.findCoupon(updated.couponId) : null);
    const loc = updated.location || (coupon && coupon.location) || {};
    const origPrice = coupon && Number(coupon.originalPrice) > 0 ? Number(coupon.originalPrice) : 0;
    const actualPaid = coupon && Number(coupon.price) > 0 ? Number(coupon.price) : Number(updated.price || 0);
    const savedAmount = origPrice > actualPaid ? (origPrice - actualPaid) : 0;

    activityLogStore.recordActivityLog({
      entityType: "plan",
      entityId: updated.id,
      action: "completed",
      title: updated.title,
      category: (coupon && (coupon.type || coupon.category)) || updated.category || "类型待补充",
      platform: (coupon && coupon.platform) || updated.platform || (coupon ? "平台待补充" : "日程"),
      finance: {
        originalPrice: origPrice,
        actualPaid,
        savedAmount,
        participantCount: (updated.participants || []).length || 1,
      },
      executionSnapshot: {
        venue: loc.name || updated.venue || (coupon && coupon.venue) || "",
        address: loc.address || updated.address || (coupon && coupon.address) || "",
        latitude: loc.latitude !== undefined ? loc.latitude : (coupon && coupon.latitude),
        longitude: loc.longitude !== undefined ? loc.longitude : (coupon && coupon.longitude),
        dishes: (coupon && coupon.dishes) || "",
        people: (coupon && coupon.people) || "人数待补充",
        type: (coupon && (coupon.type || coupon.category)) || updated.category || "类型待补充",
        platform: (coupon && coupon.platform) || updated.platform || (coupon ? "平台待补充" : "日程"),
        scheduledDate: (updated.selectedTime && updated.selectedTime.date) || updated.date || "",
        scheduledTime: (updated.selectedTime && updated.selectedTime.startTime) || updated.time || "已完成",
        participants: (updated.participants || []).map((p) => p.name || p),
        note: updated.note || "",
        // ActivityLogStore only needs cross-domain identities. Avoid creating
        // two full transient snapshots (including media/recommendation data)
        // during every completion before the log normalizer compacts them.
        couponSnapshot: coupon ? { id: coupon.id } : null,
        planSnapshot: { couponId: updated.couponId || "" },
      },
    });
  } catch (error) {
    console.warn("Completed activity snapshot failed:", error);
  }
  return updated;
}

function cancelPlan(id, reason = "用户取消计划") {
  const original = repository.getStoredPlans().find((item) => item.id === id);
  if (!original) return null;
  const updated = updatePlanStatus(id, "cancelled", `已取消计划。原因：${reason}`);
  if (updated) {
    if (updated.couponId) {
      try {
        const couponStore = require("./couponStore.js");
        const coupon = couponStore.findCoupon(updated.couponId);
        if (coupon && !couponStore.unlinkPlan(updated.couponId, updated.id)) {
          if (!restorePlanSnapshot(original)) {
            console.warn("Plan cancellation rollback failed:", updated.id, updated.couponId);
          }
          return null;
        }
      } catch (error) {
        if (!restorePlanSnapshot(original)) console.warn("Plan cancellation rollback threw:", updated.id, error);
        return null;
      }
    }
    try {
      eventLogger.logEvent("plan_cancelled", { planId: updated.id, couponId: updated.couponId, reason });
    } catch (error) {
      console.warn("plan_cancelled log failed:", error);
    }
  }
  return updated;
}

function reschedulePlan(id, newTimeOption = {}, rec = {}) {
  const plan = findPlan(id);
  if (!plan) return null;

  const nextStatus = "rescheduled";
  if (!canTransitionPlanStatus(plan.statusCode, nextStatus)) return null;

  const selectedTime = {
    date: newTimeOption.date || plan.date,
    weekday: newTimeOption.weekday || "",
    startTime: newTimeOption.startTime || plan.time,
    endTime: newTimeOption.endTime || "",
    scene: newTimeOption.scene || "",
    label: newTimeOption.label || `${newTimeOption.weekday || ""} ${newTimeOption.startTime || ""}`,
  };

  const previousRecommendation = plan.recommendationSnapshot || {};
  const hasRecScore = rec.score !== undefined && rec.score !== null && rec.score !== "";
  const hasOptionScore = newTimeOption.score !== undefined && newTimeOption.score !== null && newTimeOption.score !== "";
  const recommendationSnapshot = Object.assign({}, previousRecommendation, {
    weatherView: rec.weatherView || previousRecommendation.weatherView,
  });
  if (hasRecScore || hasOptionScore) {
    const score = Number(hasRecScore ? rec.score : newTimeOption.score);
    if (Number.isFinite(score)) recommendationSnapshot.score = score;
  }
  const updated = updatePlan(id, {
    updatedAt: new Date().toISOString(),
    selectedTime,
    date: selectedTime.date,
    time: selectedTime.startTime,
    statusCode: nextStatus,
    status: normalizer.statusLabel(nextStatus),
    statusClass: normalizer.statusClass(nextStatus),
    recommendationSnapshot,
    changeLogs: (plan.changeLogs || []).concat({
      type: "rescheduled",
      text: `已改期至 ${selectedTime.label}。`,
      createdAt: normalizer.nowText(),
    }),
  });

  if (!updated || !updated.couponId) return updated;
  try {
    const couponStore = require("./couponStore.js");
    const coupon = couponStore.findCoupon(updated.couponId);
    if (coupon && !couponStore.linkPlan(updated.couponId, updated.id)) {
      if (!restorePlanSnapshot(plan)) console.warn("Plan reschedule rollback failed:", updated.id);
      return null;
    }
  } catch (error) {
    if (!restorePlanSnapshot(plan)) console.warn("Plan reschedule rollback threw:", updated.id, error);
    return null;
  }
  return updated;
}

module.exports = {
  updatePlan,
  updatePlanStatus,
  completePlan,
  cancelPlan,
  reschedulePlan,
};
