const planStore = require("../../../utils/planStore.js");
const couponStore = require("../../../utils/couponStore.js");
const eventLogger = require("../../../utils/eventLogger.js");
const inviteService = require("../../../utils/services/inviteService.js");
const notificationService = require("../../../utils/services/notificationService.js");
const {
  formatPlanForView,
  buildActionState,
  confirmFriendAction,
  rejectFriendAction,
  buildShareDataPackage,
} = require("../planDetailHelper.js");

function getInviteId(invite = {}) {
  const value = invite || {};
  return value.inviteId || value.id || "";
}

function getFriendName(plan = {}) {
  const participants = Array.isArray(plan.participants) ? plan.participants : [];
  const friendParticipant = participants.find((participant) => participant && participant.id !== "self");
  return friendParticipant ? friendParticipant.name : "朋友";
}

function samePlanSnapshot(left, right) {
  try {
    return JSON.stringify(left || {}) === JSON.stringify(right || {});
  } catch (error) {
    return false;
  }
}

function isPageActive(page) {
  return !page.hidden && !page.unloaded;
}

function showActiveToast(page, options) {
  if (!isPageActive(page)) return;
  try {
    wx.showToast(options);
  } catch (error) {
    console.warn("invite toast failed:", error);
  }
}

function showModalSafely(page, options, failureTitle) {
  if (!isPageActive(page)) return false;
  const originalFail = options && options.fail;
  try {
    wx.showModal(Object.assign({}, options, {
      fail: (error) => {
        if (typeof originalFail === "function") originalFail(error);
        showActiveToast(page, { title: failureTitle, icon: "none" });
      },
    }));
    return true;
  } catch (error) {
    showActiveToast(page, { title: failureTitle, icon: "none" });
    return false;
  }
}

function reloadActivePlan(page) {
  if (!isPageActive(page)) return;
  try {
    page.loadPlan();
  } catch (error) {
    console.warn("invite plan reload failed:", error);
  }
}

function isPlanTerminal(plan = {}) {
  return ["completed", "cancelled", "expired"].includes(plan.statusCode);
}

function attachInviteSafely(planId, invite) {
  if (!planId) return null;
  try {
    return planStore.attachInvite(planId, invite || {});
  } catch (error) {
    console.warn("plan invite link storage failed:", planId, error);
    return null;
  }
}

function captureLocalAcceptance(plan = {}, coupon = null) {
  const planId = plan.id || "";
  const couponId = (coupon && coupon.id) || plan.couponId || "";
  return {
    planId,
    couponId,
    plan: planId ? planStore.findPlan(planId) : null,
    coupon: couponId ? couponStore.findCoupon(couponId) : null,
  };
}

function rollbackLocalAcceptance(before, appliedPlan, appliedCoupon) {
  try {
    let planRestored = true;
    const currentPlan = before.planId ? planStore.findPlan(before.planId) : null;
    if (appliedPlan && !samePlanSnapshot(currentPlan, appliedPlan)) {
      planRestored = false;
    } else if (before.plan) {
      planRestored = Boolean(planStore.savePlan(before.plan, { linkCoupon: false }));
    } else if (currentPlan) {
      planRestored = Boolean(planStore.removeImportedPlan(before.planId, before.couponId));
    }

    let couponRestored = true;
    const currentCoupon = before.couponId ? couponStore.findCoupon(before.couponId) : null;
    if (appliedCoupon && !samePlanSnapshot(currentCoupon, appliedCoupon)) {
      couponRestored = false;
    } else if (before.coupon) {
      couponRestored = Boolean(couponStore.importCouponSnapshot(before.coupon));
    } else if (currentCoupon) {
      couponRestored = currentCoupon.planId === before.planId
        && currentCoupon.source === "friend_share"
        && Boolean(couponStore.deleteCoupon(before.couponId));
    }
    return planRestored && couponRestored;
  } catch (error) {
    console.warn("accepted invite local rollback failed:", error);
    return false;
  }
}

function rollbackLocalPlanSnapshot(beforePlan, appliedPlan) {
  if (!beforePlan || !appliedPlan) return true;
  try {
    const current = planStore.findPlan(beforePlan.id);
    if (!samePlanSnapshot(current, appliedPlan)) return false;
    return Boolean(planStore.savePlan(beforePlan, { linkCoupon: false }));
  } catch (error) {
    console.warn("rejected invite local rollback failed:", error);
    return false;
  }
}

function setInviteState(page, plan, invite, storedPlan) {
  const inviteId = getInviteId(invite);
  const linkedPlan = storedPlan || Object.assign({}, plan, {
    inviteId,
    inviteSnapshot: invite,
  });
  page.pendingInvite = invite;
  if (!isPageActive(page)) return;
  try {
    page.setData({
      plan: formatPlanForView(linkedPlan),
      currentInvite: invite,
      actionState: buildActionState(
        linkedPlan,
        page.data.actionState && page.data.actionState.actionsExpanded,
        page.data.isRecipient,
      ),
    });
  } catch (error) {
    console.warn("invite state render failed:", error);
  }
}

function startInviteSync(page, plan, friendName, localInvite, shouldSync) {
  const inviteId = getInviteId(localInvite);
  if (!shouldSync || !inviteId || localInvite.syncStatus !== "local" || page.inviteSyncInviteId === inviteId) return;

  const requestId = (page.inviteRequestId || 0) + 1;
  const requestedPlanUpdatedAt = localInvite.planUpdatedAt || "";
  page.inviteRequestId = requestId;
  page.inviteSyncInviteId = inviteId;
  page.inviteSyncPromise = Promise.resolve().then(() => inviteService.createInvite(plan, friendName, {
    localInvite,
    silent: true,
  })).then((invite) => {
    // The local invite is already attached. The cloud result only upgrades its
    // sync metadata, and may safely do so even after the page was unloaded.
    if (page.inviteSyncInviteId !== inviteId) return invite;
    page.inviteSyncInviteId = "";
    page.inviteSyncPromise = null;
    if (!invite || invite.invalid || inviteService.isInviteDeleted(inviteId)) {
      const detached = attachInviteSafely(plan.id, {});
      page.pendingInvite = null;
      if (detached) page.inviteId = "";
      if (isPageActive(page) && requestId === page.inviteRequestId) {
        try {
          page.setData({
            plan: formatPlanForView(detached || plan),
            currentInvite: null,
            actionState: buildActionState(detached || plan, false, page.data.isRecipient),
          });
        } catch (error) {
          console.warn("invalid invite state render failed:", error);
        }
        showActiveToast(page, { title: detached ? "旧邀请已失效，请重新分享" : "旧邀请已失效，计划关联清理失败", icon: "none" });
      } else if (isPageActive(page)) {
        reloadActivePlan(page);
      }
      return invite;
    }
    const updated = attachInviteSafely(plan.id, invite);
    page.pendingInvite = invite;
    if (isPageActive(page) && requestId === page.inviteRequestId) {
      setInviteState(page, plan, invite, updated);
      if (!updated) showActiveToast(page, { title: "邀请已生成，但计划关联保存失败", icon: "none" });
      else if (invite.syncStatus === "local") showActiveToast(page, { title: "云端暂不可用，已生成本地邀请", icon: "none" });
      try {
        eventLogger.logEvent("plan_invite_prepared", { planId: plan.id, inviteId: getInviteId(invite) });
      } catch (error) {
        console.warn("plan invite event log failed:", error);
      }
    } else if (isPageActive(page)) {
      reloadActivePlan(page);
    }
    // If the same invite was reshared with a newer plan while this request was
    // in flight, createInvite deliberately returns that newer local record.
    // Queue exactly that revision after clearing the in-flight marker.
    if (invite
      && invite.syncStatus === "local"
      && invite.planUpdatedAt
      && invite.planUpdatedAt !== requestedPlanUpdatedAt) {
      const latestPlan = invite.planSnapshot || page.data.plan || plan;
      startInviteSync(page, latestPlan, friendName, invite, true);
    }
    return invite;
  }).catch(() => {
    if (page.inviteSyncInviteId === inviteId) {
      page.inviteSyncInviteId = "";
      page.inviteSyncPromise = null;
    }
    if (inviteService.isInviteDeleted(inviteId)) {
      const detached = attachInviteSafely(plan.id, {});
      page.pendingInvite = null;
      if (detached) page.inviteId = "";
      if (isPageActive(page) && requestId === page.inviteRequestId) {
        try {
          page.setData({
            plan: formatPlanForView(detached || plan),
            currentInvite: null,
            actionState: buildActionState(detached || plan, false, page.data.isRecipient),
          });
        } catch (error) {
          console.warn("deleted invite state render failed:", error);
        }
      } else if (isPageActive(page)) {
        reloadActivePlan(page);
      }
    }
    if (isPageActive(page) && requestId === page.inviteRequestId) {
      showActiveToast(page, {
        title: inviteService.isInviteDeleted(inviteId)
          ? "邀请已失效，请重新分享"
          : "云端邀请同步失败，本地邀请仍可重试",
        icon: "none",
      });
    }
    return localInvite;
  });
}

function ensurePageInvite(page) {
  const plan = page.data.plan;
  if (!plan) return null;
  if (page.data.isRecipient) return null;
  if (["completed", "cancelled", "expired"].includes(plan.statusCode)) return null;
  const friendName = getFriendName(plan);
  const existingInvite = page.pendingInvite || page.data.currentInvite || plan.inviteSnapshot || null;
  if (existingInvite && ["confirmed", "rejected", "invalid"].includes(existingInvite.status)) return null;
  let localInvite = null;
  try {
    localInvite = inviteService.ensureLocalInvite(plan, friendName, existingInvite);
  } catch (error) {
    showActiveToast(page, { title: "邀请保存失败，请重试", icon: "none" });
    return null;
  }
  if (!localInvite) return null;
  const shouldSync = localInvite.syncStatus === "local";

  // Persist both sides of the relationship before starting any asynchronous
  // work, so a rapid page unload cannot leave an invite without its plan link.
  const inviteId = getInviteId(localInvite);
  const attachedInvite = plan.inviteSnapshot || {};
  const alreadyAttached = plan.inviteId === inviteId
    && getInviteId(attachedInvite) === inviteId
    && samePlanSnapshot(attachedInvite.planSnapshot, localInvite.planSnapshot);
  const updated = alreadyAttached ? plan : attachInviteSafely(plan.id, localInvite);
  if (!updated) {
    Promise.resolve().then(() => inviteService.deleteInvite(inviteId)).catch(() => false);
    showActiveToast(page, { title: "邀请保存失败，请清理存储后重试", icon: "none" });
    return null;
  }
  setInviteState(page, plan, localInvite, updated);
  startInviteSync(page, plan, friendName, localInvite, shouldSync);
  return localInvite;
}


module.exports = {
  planStore,
  couponStore,
  inviteService,
  notificationService,
  confirmFriendAction,
  rejectFriendAction,
  buildShareDataPackage,
  getInviteId,
  isPageActive,
  showActiveToast,
  showModalSafely,
  reloadActivePlan,
  isPlanTerminal,
  attachInviteSafely,
  captureLocalAcceptance,
  rollbackLocalAcceptance,
  rollbackLocalPlanSnapshot,
  ensurePageInvite,
};
