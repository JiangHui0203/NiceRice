const planStore = require("../../utils/planStore.js");
const couponStore = require("../../utils/couponStore.js");
const {
  normalizeCoordinate,
  positiveNumber,
  firstNonEmptyText,
  firstScheduleText,
  parseTravelMinutes,
  formatDistance,
  extractStoredDistanceText,
  getPlanCleanupMinutes,
} = require("./planDetailBase.js");

function getPlanId(planOrId) {
  if (!planOrId) return "";
  return typeof planOrId === "object" ? (planOrId.id || "") : String(planOrId);
}

function sameStoredSnapshot(left, right) {
  try {
    return JSON.stringify(left || {}) === JSON.stringify(right || {});
  } catch (error) {
    return false;
  }
}

function recoverFailedPlanMutation(planId, originalPlan) {
  if (!planId || !originalPlan) return true;
  try {
    const currentPlan = planStore.findPlan(planId);
    if (sameStoredSnapshot(currentPlan, originalPlan)) return true;
    return Boolean(planStore.savePlan(originalPlan, { linkCoupon: false }));
  } catch (error) {
    return false;
  }
}

function recoverFailedPlanAndCouponMutation(planId, originalPlan, originalCoupon) {
  const planRestored = recoverFailedPlanMutation(planId, originalPlan);
  let couponRestored = true;
  if (originalCoupon && originalCoupon.id) {
    try {
      const currentCoupon = couponStore.findCoupon(originalCoupon.id);
      couponRestored = sameStoredSnapshot(currentCoupon, originalCoupon)
        || Boolean(couponStore.importCouponSnapshot(originalCoupon));
    } catch (error) {
      couponRestored = false;
    }
  }
  return planRestored && couponRestored;
}

function completePlanAction(planOrId, currentPlan) {
  const planId = getPlanId(planOrId);
  let originalPlan = null;
  let originalCoupon = null;
  let updated = null;
  try {
    originalPlan = planStore.findPlan(planId);
    if (originalPlan && originalPlan.couponId) {
      originalCoupon = couponStore.findCoupon(originalPlan.couponId);
    }
    updated = planStore.completePlan(planId);
  } catch (error) {
    const restored = recoverFailedPlanAndCouponMutation(planId, originalPlan, originalCoupon);
    return {
      success: false,
      error: restored
        ? (error && error.message || "完成状态保存失败")
        : "完成状态保存失败，且本地状态恢复失败，请重新打开",
    };
  }
  if (!updated) {
    const restored = recoverFailedPlanAndCouponMutation(planId, originalPlan, originalCoupon);
    return {
      success: false,
      error: restored ? "操作失败" : "操作失败，且本地状态恢复失败，请重新打开",
    };
  }
  return { success: true, updated };
}

function cancelPlanAction(planOrId, currentPlan, reason) {
  const planId = getPlanId(planOrId);
  let originalPlan = null;
  let originalCoupon = null;
  let updated = null;
  try {
    originalPlan = planStore.findPlan(planId);
    if (originalPlan && originalPlan.couponId) {
      originalCoupon = couponStore.findCoupon(originalPlan.couponId);
    }
    updated = planStore.cancelPlan(planId, reason);
  } catch (error) {
    const restored = recoverFailedPlanAndCouponMutation(planId, originalPlan, originalCoupon);
    return {
      success: false,
      error: restored
        ? (error && error.message || "取消状态保存失败")
        : "取消状态保存失败，且本地状态恢复失败，请重新打开",
    };
  }
  if (!updated) {
    const restored = recoverFailedPlanAndCouponMutation(planId, originalPlan, originalCoupon);
    return {
      success: false,
      error: restored ? "操作失败" : "操作失败，且本地状态恢复失败，请重新打开",
    };
  }
  return { success: true, updated };
}

function confirmFriendActionCore(planOrId, currentCoupon) {
  const planId = getPlanId(planOrId);
  const planObj = typeof planOrId === "object" ? planOrId : null;

  let existing = planStore.findPlan(planId);
  let imported = false;
  let couponBeforeLink = null;
  let couponChanged = false;
  let couponCreated = false;
  if (!existing && planObj) {
    // 跨设备导入：如果本地没有该计划，先保存入本地 planStore
    const planToSave = Object.assign({}, planObj, {
      statusCode: "confirmed",
      status: "已确认",
      participants: [
        { id: "self", name: "我", status: "confirmed" },
        { id: "friend", name: (planObj.friendName || "发起人"), status: "confirmed" }
      ],
      isImported: true,
      importedAt: new Date().toISOString(),
    });
    const savedPlan = planStore.savePlan(planToSave, { linkCoupon: false });
    if (!savedPlan) return { success: false, error: "本地日程保存失败，请重试" };
    existing = savedPlan;
    imported = true;
  }

  if (currentCoupon && currentCoupon.id) {
    const existingCoupon = couponStore.findCoupon(currentCoupon.id);
    if (!existingCoupon) {
      const savedCoupon = couponStore.importCouponSnapshot(Object.assign({}, currentCoupon, {
        statusCode: "planned",
        status: "已安排",
        planId: planId,
        source: "friend_share",
      }));
      if (!savedCoupon) {
        const planRolledBack = !imported || planStore.removeImportedPlan(planId, currentCoupon.id);
        if (!planRolledBack) {
          console.warn("Accepted invite coupon failed and imported plan rollback failed:", planId);
        }
        return {
          success: false,
          error: planRolledBack
            ? "本地优惠券保存失败，请重试"
            : "优惠券保存失败，且本地日程恢复失败，请重新打开",
        };
      }
      couponChanged = true;
      couponCreated = true;
    } else if (!["used", "expired"].includes(existingCoupon.statusCode)
      && (existingCoupon.planId !== planId || existingCoupon.statusCode !== "planned")) {
      couponBeforeLink = existingCoupon;
      if (!couponStore.linkPlan(existingCoupon.id, planId)) {
        const planRolledBack = !imported || planStore.removeImportedPlan(planId, currentCoupon.id);
        if (!planRolledBack) {
          console.warn("Accepted invite coupon link failed and imported plan rollback failed:", planId);
        }
        return {
          success: false,
          error: planRolledBack
            ? "本地优惠券关联失败，请重试"
            : "优惠券关联失败，且本地日程恢复失败，请重新打开",
        };
      }
      couponChanged = true;
    }
  }

  const updated = imported ? existing : planStore.markFriendConfirmed(planId);
  let rollbackFailed = false;
  if (!updated && couponChanged) {
    const rolledBack = couponCreated
      ? couponStore.deleteCoupon(currentCoupon && currentCoupon.id)
      : couponStore.importCouponSnapshot(couponBeforeLink);
    if (!rolledBack) {
      rollbackFailed = true;
      console.warn("Accepted invite plan update failed and coupon rollback failed:", planId);
    }
  }
  if (!updated) {
    return {
      success: false,
      error: rollbackFailed
        ? "本地计划保存失败，且优惠券状态恢复失败，请重新打开"
        : "本地计划保存失败，请重试",
    };
  }
  return { success: true, updated };
}

function restoreAcceptanceState(planId, couponId, originalPlan, originalCoupon) {
  let planRestored = true;
  let couponRestored = true;
  try {
    const currentPlan = planId ? planStore.findPlan(planId) : null;
    if (originalPlan) {
      planRestored = sameStoredSnapshot(currentPlan, originalPlan)
        || Boolean(planStore.savePlan(originalPlan, { linkCoupon: false }));
    } else if (currentPlan) {
      planRestored = Boolean(planStore.removeImportedPlan(planId, couponId));
    }
  } catch (error) {
    planRestored = false;
  }
  try {
    const currentCoupon = couponId ? couponStore.findCoupon(couponId) : null;
    if (originalCoupon) {
      couponRestored = sameStoredSnapshot(currentCoupon, originalCoupon)
        || Boolean(couponStore.importCouponSnapshot(originalCoupon));
    } else if (currentCoupon) {
      couponRestored = currentCoupon.source === "friend_share"
        && currentCoupon.planId === planId
        && Boolean(couponStore.deleteCoupon(couponId));
    }
  } catch (error) {
    couponRestored = false;
  }
  return planRestored && couponRestored;
}

function confirmFriendAction(planOrId, currentCoupon) {
  const planId = getPlanId(planOrId);
  const couponId = currentCoupon && currentCoupon.id || "";
  let originalPlan = null;
  let originalCoupon = null;
  try {
    originalPlan = planId ? planStore.findPlan(planId) : null;
    originalCoupon = couponId ? couponStore.findCoupon(couponId) : null;
  } catch (error) {
    return { success: false, error: "本地计划读取失败，请重试" };
  }

  try {
    const result = confirmFriendActionCore(planOrId, currentCoupon);
    if (result && result.success) return result;
    const restored = restoreAcceptanceState(planId, couponId, originalPlan, originalCoupon);
    return Object.assign({}, result || { success: false }, {
      success: false,
      error: restored
        ? (result && result.error || "本地计划保存失败，请重试")
        : "本地计划保存失败，且部分状态恢复失败，请重新打开",
    });
  } catch (error) {
    const restored = restoreAcceptanceState(planId, couponId, originalPlan, originalCoupon);
    return {
      success: false,
      error: restored
        ? "本地计划保存失败，请重试"
        : "本地计划保存失败，且部分状态恢复失败，请重新打开",
    };
  }
}

function rejectFriendAction(planOrId, reason) {
  const planId = getPlanId(planOrId);
  let originalPlan = null;
  let updated = null;
  try {
    originalPlan = planStore.findPlan(planId);
    updated = planStore.markFriendRejected(planId, reason || "好友表示时间不合适");
  } catch (error) {
    const restored = recoverFailedPlanMutation(planId, originalPlan);
    return {
      success: false,
      error: restored
        ? (error && error.message || "拒绝状态保存失败")
        : "拒绝状态保存失败，且本地计划恢复失败，请重新打开",
    };
  }
  if (!updated) {
    const restored = recoverFailedPlanMutation(planId, originalPlan);
    return {
      success: false,
      error: restored ? "拒绝状态保存失败" : "拒绝状态保存失败，且本地计划恢复失败，请重新打开",
    };
  }
  return { success: true, updated };
}

function markReservationConfirmedAction(planOrId) {
  const planId = getPlanId(planOrId);
  let originalPlan = null;
  let updated = null;
  try {
    originalPlan = planStore.findPlan(planId);
    updated = planStore.updateReservationStatus(planId, "confirmed");
  } catch (error) {
    const restored = recoverFailedPlanMutation(planId, originalPlan);
    return {
      success: false,
      error: restored
        ? (error && error.message || "预约状态保存失败")
        : "预约状态保存失败，且本地计划恢复失败，请重新打开",
    };
  }
  if (updated) return { success: true, updated };
  const restored = recoverFailedPlanMutation(planId, originalPlan);
  return {
    success: false,
    error: restored ? "预约状态保存失败" : "预约状态保存失败，且本地计划恢复失败，请重新打开",
  };
}

function markReservationFailedAction(planOrId) {
  const planId = getPlanId(planOrId);
  let originalPlan = null;
  let updated = null;
  try {
    originalPlan = planStore.findPlan(planId);
    updated = planStore.updateReservationStatus(planId, "failed");
  } catch (error) {
    const restored = recoverFailedPlanMutation(planId, originalPlan);
    return {
      success: false,
      error: restored
        ? (error && error.message || "预约状态保存失败")
        : "预约状态保存失败，且本地计划恢复失败，请重新打开",
    };
  }
  if (updated) return { success: true, updated };
  const restored = recoverFailedPlanMutation(planId, originalPlan);
  return {
    success: false,
    error: restored ? "预约状态保存失败" : "预约状态保存失败，且本地计划恢复失败，请重新打开",
  };
}

module.exports = {
  getPlanId,
  sameStoredSnapshot,
  recoverFailedPlanMutation,
  recoverFailedPlanAndCouponMutation,
  completePlanAction,
  cancelPlanAction,
  confirmFriendActionCore,
  restoreAcceptanceState,
  confirmFriendAction,
  rejectFriendAction,
  markReservationConfirmedAction,
  markReservationFailedAction,
};
