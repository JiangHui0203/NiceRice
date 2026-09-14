const planStore = require("../../../utils/planStore.js");
const couponStore = require("../../../utils/couponStore.js");
const inviteService = require("../../../utils/services/inviteService.js");
const {
  formatPlanForView,
  buildActionState,
  confirmFriendAction,
  parseSharedPlanData,
  selectPlanSnapshot,
} = require("../planDetailHelper.js");
const { normalizeExactId } = require("../../../utils/idUtils.js");

const PROPOSAL_CONFLICT_CODES = new Set([
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

function readRouteId(options, keys) {
  const source = options && typeof options === "object" ? options : {};
  const provided = keys
    .filter((key) => source[key] !== undefined && source[key] !== null && source[key] !== "")
    .map((key) => source[key]);
  if (!provided.length) return { value: "", invalid: false };
  const normalized = provided.map((value) => normalizeExactId(value));
  if (normalized.some((value) => !value) || new Set(normalized).size !== 1) {
    return { value: "", invalid: true };
  }
  return { value: normalized[0], invalid: false };
}

function showPageToast(page, options) {
  if (!isPageActive(page)) return;
  try {
    wx.showToast(options);
  } catch (error) {
    console.warn("plan detail toast failed:", error);
  }
}

function attachInviteSafely(planId, invite) {
  try {
    return planStore.attachInvite(planId, invite || {});
  } catch (error) {
    console.warn("plan detail invite link failed:", planId, error);
    return null;
  }
}

function findPlanSafely(page, planId) {
  if (!planId) return null;
  try {
    return planStore.findPlan(planId);
  } catch (error) {
    page.planStorageReadFailed = true;
    console.warn("plan detail plan read failed:", planId, error);
    return null;
  }
}

function findCouponSafely(page, couponId) {
  if (!couponId) return null;
  try {
    return couponStore.findCoupon(couponId);
  } catch (error) {
    page.couponStorageReadFailed = true;
    console.warn("plan detail coupon read failed:", couponId, error);
    return null;
  }
}

function reloadPlanSafely(page) {
  if (!isPageActive(page)) return;
  try {
    page.loadPlan();
  } catch (error) {
    console.warn("plan detail reload failed:", error);
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

function reconcileOwnerInvite(plan, invite) {
  if (!plan || !invite || !invite.status || invite.invalid) return plan;
  const previousInvite = plan.inviteSnapshot || {};
  const participants = Array.isArray(plan.participants) ? plan.participants : [];
  const friendParticipants = participants.filter((participant) => participant && participant.id !== "self");
  const statusApplied = invite.status === "confirmed"
    ? (plan.statusCode === "confirmed" && friendParticipants.every((participant) => participant.status === "confirmed"))
    : (invite.status === "rejected"
      ? friendParticipants.every((participant) => participant.status === "rejected")
      : true);
  const sameEnvelope = previousInvite.status === invite.status
    && previousInvite.planUpdatedAt === invite.planUpdatedAt
    && statusApplied;
  if (sameEnvelope) return plan;

  let updated = plan;
  const terminalPlan = ["completed", "cancelled", "expired"].includes(plan.statusCode);
  if (invite.status === "confirmed"
    && !terminalPlan
    && (plan.statusCode !== "confirmed" || friendParticipants.some((participant) => participant.status !== "confirmed"))) {
    try {
      updated = planStore.markFriendConfirmed(plan.id) || updated;
    } catch (error) {
      console.warn("owner invite confirmation reconciliation failed:", plan.id, error);
    }
  } else if (invite.status === "rejected"
    && !terminalPlan
    && friendParticipants.some((participant) => participant.status !== "rejected")) {
    try {
      updated = planStore.markFriendRejected(plan.id, "好友已通过邀请回复") || updated;
    } catch (error) {
      console.warn("owner invite rejection reconciliation failed:", plan.id, error);
    }
  }
  return attachInviteSafely(plan.id, invite) || updated;
}

function maybeShowInviteProposal(page, plan, invite) {
  const proposal = invite && invite.proposal;
  const selectedTime = proposal && proposal.selectedTime;
  if (!plan || !selectedTime || invite.status !== "pending" || page.hidden || page.unloaded) return;
  const proposalId = proposal.createdAt || JSON.stringify(selectedTime);
  if (page.lastPromptedProposalId === proposalId) return;
  page.lastPromptedProposalId = proposalId;
  const timeText = selectedTime.label
    || [selectedTime.date, selectedTime.weekday, selectedTime.startTime].filter(Boolean).join(" ");
  const modalOptions = {
    title: "好友提议改期",
    content: `好友希望调整到「${timeText || "新的时间"}」，是否采纳？`,
    confirmText: "采纳改期",
    cancelText: "暂不采纳",
    success(res) {
      if (!res || !res.confirm || page.hidden || page.unloaded) return;
      const originalPlan = findPlanSafely(page, plan.id);
      let updated = null;
      if (!originalPlan) {
        showPageToast(page, {
          title: page.planStorageReadFailed ? "本地计划读取失败，请重试" : "计划不存在，无法采纳改期",
          icon: "none",
        });
        return;
      }
      try {
        updated = planStore.reschedulePlan(plan.id, selectedTime);
      } catch (error) {
        const restored = (() => {
          try {
            const current = planStore.findPlan(plan.id);
            return samePlanSnapshot(current, originalPlan)
              || Boolean(planStore.savePlan(originalPlan, { linkCoupon: false }));
          } catch (rollbackError) {
            return false;
          }
        })();
        showPageToast(page, {
          title: restored ? "改期保存失败，请重试" : "改期保存失败，且原计划恢复失败，请重新打开",
          icon: "none",
        });
        return;
      }
      if (!updated) {
        let restored = false;
        try {
          const current = planStore.findPlan(plan.id);
          restored = samePlanSnapshot(current, originalPlan)
            || Boolean(planStore.savePlan(originalPlan, { linkCoupon: false }));
        } catch (error) {}
        showPageToast(page, {
          title: restored ? "改期保存失败，请重试" : "改期保存失败，且原计划恢复失败，请重新打开",
          icon: "none",
        });
        return;
      }
      const inviteId = invite.inviteId || invite.id || "";
      Promise.resolve().then(() => inviteService.updateInvitePlan(inviteId, updated)).then((result) => {
        let message = result && result.localOnly
          ? "已本地采纳改期，邀请仅保存在本机"
          : "已采纳好友提议";
        if (!result || !result.success) {
          const code = result && result.code || "invite_failed";
          if (["missing_invite", "not_found", "invite_expired"].includes(code)) {
            return Promise.resolve().then(() => inviteService.deleteInvite(inviteId)).catch(() => ({
              success: false,
              code: "invite_delete_failed",
            })).then((deleteResult) => {
              const revocationRecorded = Boolean(deleteResult && (deleteResult.success || deleteResult.localDeleted));
              const detached = revocationRecorded ? attachInviteSafely(updated.id, {}) : null;
              if (detached) {
                page.inviteId = "";
                page.pendingInvite = null;
              }
              showPageToast(page, {
                title: detached ? "已采纳改期，旧邀请已失效" : "已本地改期，旧邀请清理待重试",
                icon: "none",
              });
              reloadPlanSafely(page);
              return detached || updated;
            });
          } else if (PROPOSAL_CONFLICT_CODES.has(code)) {
            const rollback = restorePlanIfUnchanged(originalPlan, updated);
            message = rollback.superseded
              ? "计划已在其他页面更新，本次改期未覆盖，请重新打开"
              : (rollback.restored
                ? (result && result.message || "邀请已变化，本次改期未保存")
                : "邀请已变化，且本地时间恢复失败，请重新打开");
          } else {
            message = result && result.remoteUpdated
              ? "已采纳改期，本地邀请缓存待修复"
              : "已本地改期，邀请待同步";
          }
        }
        showPageToast(page, { title: message, icon: "none" });
        reloadPlanSafely(page);
        return updated;
      }).catch(() => {
        showPageToast(page, { title: "已本地改期，邀请待同步", icon: "none" });
        reloadPlanSafely(page);
      });
    },
  };
  try {
    wx.showModal(modalOptions);
  } catch (error) {
    page.lastPromptedProposalId = "";
    showPageToast(page, { title: "改期提议打开失败，请重新进入计划", icon: "none" });
  }
}

function retryTerminalInviteCleanup(page, plan) {
  const inviteId = plan && (plan.inviteId
    || (plan.inviteSnapshot && (plan.inviteSnapshot.inviteId || plan.inviteSnapshot.id)));
  if (!inviteId
    || !["completed", "cancelled", "expired"].includes(plan.statusCode)
    || page.terminalCleanupInviteId === inviteId) return;
  page.terminalCleanupInviteId = inviteId;
  Promise.resolve().then(() => inviteService.deleteInvite(inviteId)).then((result) => {
    page.terminalCleanupInviteId = "";
    if (!result || (!result.success && !result.localDeleted)) return;
    const detached = attachInviteSafely(plan.id, {});
    if (!detached) return;
    page.inviteId = "";
    page.pendingInvite = null;
    reloadPlanSafely(page);
  }).catch(() => {
    page.terminalCleanupInviteId = "";
  });
}

function retryInvalidOwnerInviteCleanup(page, plan, invite) {
  const inviteId = invite && (invite.inviteId || invite.id)
    || (plan && plan.inviteId)
    || "";
  if (!inviteId || !plan || !invite || !invite.invalid || page.invalidCleanupInviteId === inviteId) return;
  page.invalidCleanupInviteId = inviteId;
  Promise.resolve().then(() => inviteService.deleteInvite(inviteId)).then((result) => {
    page.invalidCleanupInviteId = "";
    if (!result || (!result.success && !result.localDeleted)) return;
    const detached = attachInviteSafely(plan.id, {});
    if (!detached) return;
    page.inviteId = "";
    page.pendingInvite = null;
    reloadPlanSafely(page);
  }).catch(() => {
    page.invalidCleanupInviteId = "";
  });
}

module.exports = {
  isPageActive,
  readRouteId,
  showPageToast,
  attachInviteSafely,
  findPlanSafely,
  findCouponSafely,
  reloadPlanSafely,
  samePlanSnapshot,
  restorePlanIfUnchanged,
  reconcileOwnerInvite,
  maybeShowInviteProposal,
  retryTerminalInviteCleanup,
  retryInvalidOwnerInviteCleanup,
};
