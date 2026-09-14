const couponStore = require("../../../utils/couponStore.js");
const planStore = require("../../../utils/planStore.js");
const inviteService = require("../../../utils/services/inviteService.js");
const {
  formatPlanForView,
  buildActionState,
  completePlanAction,
  cancelPlanAction,
  postponePlanAction,
  markReservationConfirmedAction,
  markReservationFailedAction,
  openLocationMap,
  addPlanToCalendarService,
  requestReminderService,
} = require("../planDetailHelper.js");

const MISSING_INVITE_CODES = new Set(["missing_invite", "not_found", "invite_expired"]);
const CONFLICT_INVITE_CODES = new Set([
  "invite_changed",
  "invite_conflict",
  "invite_already_claimed",
  "invite_terminal",
  "unauthorized",
  "invalid_role",
  "invalid_status",
  "invalid_plan",
  "invalid_plan_version",
  "invalid_invite_id",
  "missing_plan",
]);

function isPageActive(page) {
  return !page.hidden && !page.unloaded;
}

function beginPlanAction(page, action) {
  if (page.planActionPending) return false;
  page.planActionPending = action;
  return true;
}

function finishPlanAction(page, action) {
  if (page.planActionPending === action) page.planActionPending = "";
}

function showActiveToast(page, options) {
  if (!isPageActive(page)) return;
  try {
    wx.showToast(options);
  } catch (error) {
    console.warn("plan action toast failed:", error);
  }
}

function renderStoredPlan(page, plan, extra = {}) {
  if (!isPageActive(page) || !plan) return;
  try {
    const patch = Object.assign({
      plan: formatPlanForView(plan),
      actionState: buildActionState(plan, false, page.data.isRecipient),
    }, extra);
    page.setData(patch);
  } catch (error) {
    console.warn("plan action render failed:", error);
  }
}

function reloadActivePlan(page) {
  if (!isPageActive(page)) return;
  try {
    page.loadPlan();
  } catch (error) {
    console.warn("plan reload failed:", error);
  }
}

function findCouponSafely(couponId) {
  if (!couponId) return null;
  try {
    return couponStore.findCoupon(couponId);
  } catch (error) {
    console.warn("plan action coupon read failed:", couponId, error);
    return null;
  }
}

function samePlanSnapshot(left, right) {
  try {
    return JSON.stringify(left || {}) === JSON.stringify(right || {});
  } catch (error) {
    return false;
  }
}

function restorePlanIfUnchanged(originalPlan, appliedPlan) {
  if (!originalPlan || !appliedPlan) return { restored: false, superseded: false };
  try {
    const currentPlan = planStore.findPlan(appliedPlan.id);
    if (!samePlanSnapshot(currentPlan, appliedPlan)) {
      return { restored: false, superseded: true };
    }
    return {
      restored: Boolean(planStore.savePlan(originalPlan, { linkCoupon: false })),
      superseded: false,
    };
  } catch (error) {
    return { restored: false, superseded: false };
  }
}

function getPlanInviteId(page, plan = {}) {
  return plan.inviteId
    || (plan.inviteSnapshot && (plan.inviteSnapshot.inviteId || plan.inviteSnapshot.id))
    || page.inviteId
    || "";
}

function revokePlanInvite(page, plan, fallbackInviteId = "") {
  const inviteId = fallbackInviteId || getPlanInviteId(page, plan);
  if (!inviteId) {
    return Promise.resolve({ updated: plan, cleaned: true, detached: true, deleteResult: { success: true } });
  }

  return Promise.resolve().then(() => inviteService.deleteInvite(inviteId)).catch(() => ({
    success: false,
    code: "invite_delete_failed",
  })).then((deleteResult) => {
    // Do not discard the only retry reference when even the local revocation
    // marker could not be persisted. A recorded tombstone/local deletion is
    // sufficient to detach the plan while remote cleanup retries separately.
    const revocationRecorded = Boolean(deleteResult && (deleteResult.success || deleteResult.localDeleted));
    let detached = null;
    if (revocationRecorded) {
      try {
        detached = planStore.attachInvite(plan.id, {});
      } catch (error) {}
    }
    if (detached) {
      page.inviteId = "";
      page.pendingInvite = null;
    }
    return {
      updated: detached || plan,
      cleaned: Boolean(deleteResult && deleteResult.success && detached),
      detached: Boolean(detached),
      deleteResult: deleteResult || { success: false },
    };
  });
}

function syncPlanInviteUpdate(page, action, originalPlan, updatedPlan, successMessage) {
  const inviteId = getPlanInviteId(page, updatedPlan);
  if (!inviteId) {
    showActiveToast(page, { title: successMessage, icon: "success" });
    reloadActivePlan(page);
    finishPlanAction(page, action);
    return Promise.resolve(updatedPlan);
  }

  return Promise.resolve().then(() => inviteService.updateInvitePlan(inviteId, updatedPlan)).then((syncResult) => {
    if (syncResult && syncResult.success) {
      showActiveToast(page, {
        title: syncResult.localOnly ? `${successMessage}，邀请仅保存在本机` : successMessage,
        icon: syncResult.localOnly ? "none" : "success",
      });
      reloadActivePlan(page);
      return updatedPlan;
    }

    const code = syncResult && syncResult.code || "invite_failed";
    if (MISSING_INVITE_CODES.has(code)) {
      return revokePlanInvite(page, updatedPlan, inviteId).then((cleanup) => {
        showActiveToast(page, {
          title: cleanup.cleaned ? `${successMessage}，旧邀请已失效` : `${successMessage}，旧邀请清理待重试`,
          icon: "none",
        });
        reloadActivePlan(page);
        return cleanup.updated;
      });
    }

    if (CONFLICT_INVITE_CODES.has(code)) {
      const rollback = restorePlanIfUnchanged(originalPlan, updatedPlan);
      showActiveToast(page, {
        title: rollback.superseded
          ? "计划已在其他页面更新，本次修改未覆盖，请重新打开"
          : (rollback.restored
            ? (syncResult && syncResult.message || "邀请已变化，本次修改未保存")
            : "邀请已变化，且本地状态恢复失败，请重新打开"),
        icon: "none",
      });
      reloadActivePlan(page);
      return rollback.restored ? originalPlan : updatedPlan;
    }

    showActiveToast(page, {
      title: syncResult && syncResult.remoteUpdated
        ? `${successMessage}，本地邀请缓存待修复`
        : `${successMessage}，邀请待同步`,
      icon: "none",
    });
    reloadActivePlan(page);
    return updatedPlan;
  }).catch(() => {
    showActiveToast(page, { title: `${successMessage}，邀请待同步`, icon: "none" });
    reloadActivePlan(page);
    return updatedPlan;
  }).then((result) => {
    finishPlanAction(page, action);
    return result;
  }, (error) => {
    finishPlanAction(page, action);
    throw error;
  });
}

module.exports = {
  couponStore,
  planStore,
  beginPlanAction,
  finishPlanAction,
  showActiveToast,
  renderStoredPlan,
  reloadActivePlan,
  findCouponSafely,
  getPlanInviteId,
  revokePlanInvite,
  syncPlanInviteUpdate,
  completePlanAction,
  cancelPlanAction,
  postponePlanAction,
  markReservationConfirmedAction,
  markReservationFailedAction,
  openLocationMap,
  addPlanToCalendarService,
  requestReminderService,
  buildActionState,
};
