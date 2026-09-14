const {
  planStore,
  couponStore,
  inviteService,
  confirmFriendAction,
  rejectFriendAction,
  getInviteId,
  isPageActive,
  showActiveToast,
  showModalSafely,
  reloadActivePlan,
  attachInviteSafely,
  captureLocalAcceptance,
  rollbackLocalAcceptance,
  rollbackLocalPlanSnapshot,
} = require("./inviteSupport.js");

module.exports = {
  confirmFriend() {
    let result = null;
    try {
      result = confirmFriendAction(this.data.plan, this.data.coupon);
    } catch (error) {
      result = { success: false, error: error && error.message || "确认保存失败" };
    }
    if (!result.success) {
      showActiveToast(this, { title: result.error || "确认失败", icon: "none" });
      return;
    }
    showActiveToast(this, { title: "朋友已确认", icon: "success" });
    reloadActivePlan(this);
  },

  rejectFriend() {
    let result = null;
    try {
      result = rejectFriendAction(this.data.plan, "朋友暂时无法参加");
    } catch (error) {
      result = { success: false, error: error && error.message || "拒绝状态保存失败" };
    }
    if (!result.success) {
      showActiveToast(this, { title: result.error || "记录失败", icon: "none" });
      return;
    }
    showActiveToast(this, { title: "已记录拒绝", icon: "none" });
    reloadActivePlan(this);
  },

  recipientReschedule() {
    if (!this.data.plan) return;
    showModalSafely(this, {
      title: "向发起人提议改期",
      content: "你可以先选择一个你方便的新时间，我们会生成提议发给好友。",
      confirmText: "去选时间",
      success: (res) => {
        if (res && res.confirm && !this.hidden && !this.unloaded) {
          const currentInvite = this.data.currentInvite || this.pendingInvite || {};
          const inviteId = this.inviteId || getInviteId(currentInvite);
          if (!inviteId || inviteService.isInviteDeleted(inviteId)) {
            showActiveToast(this, { title: "邀请已失效，无法发送改期提议", icon: "none" });
            return;
          }
          let localInvite = null;
          try {
            localInvite = inviteService.ensureLocalInvite(
              this.data.plan,
              currentInvite.friendName || "朋友",
              Object.assign({}, currentInvite, { id: inviteId, inviteId }),
            );
          } catch (error) {}
          if (!localInvite || getInviteId(localInvite) !== inviteId) {
            showActiveToast(this, { title: "邀请保存失败，暂不能提议改期", icon: "none" });
            return;
          }
          this.inviteId = inviteId;
          this.pendingInvite = localInvite;
          try {
            wx.navigateTo({
              url: `/pages/time-options/index?planId=${encodeURIComponent(this.data.plan.id)}&inviteId=${encodeURIComponent(inviteId)}&mode=propose&role=recipient`,
              fail: () => {
                showActiveToast(this, { title: "改期页面打开失败，请重试", icon: "none" });
              },
            });
          } catch (error) {
            showActiveToast(this, { title: "改期页面打开失败，请重试", icon: "none" });
          }
        }
      },
    }, "改期确认框打开失败，请重试");
  },

  acceptInvite() {
    if (this.inviteStatusPending) return Promise.resolve(false);
    const planAtAcceptance = this.data.plan;
    if (!planAtAcceptance) return Promise.resolve(false);
    const couponAtAcceptance = this.data.coupon;
    const inviteAtAcceptance = this.data.currentInvite || this.pendingInvite || {};
    const inviteId = this.inviteId || getInviteId(inviteAtAcceptance) || planAtAcceptance.inviteId || "";
    if (!inviteId || inviteService.isInviteDeleted(inviteId)) {
      showActiveToast(this, { title: "邀请信息不完整或已失效，无法接受", icon: "none" });
      return Promise.resolve(false);
    }
    let localBefore = null;
    try {
      localBefore = captureLocalAcceptance(planAtAcceptance, couponAtAcceptance);
    } catch (error) {
      showActiveToast(this, { title: "本地计划读取失败，请重试", icon: "none" });
      return Promise.resolve(false);
    }
    const importedPlan = Object.assign({}, planAtAcceptance, {
      inviteId,
      inviteSnapshot: inviteAtAcceptance,
      isImported: true,
    });

    this.inviteStatusPending = true;
    let localResult = null;
    try {
      localResult = confirmFriendAction(importedPlan, couponAtAcceptance);
    } catch (error) {
      localResult = { success: false, error: error && error.message || "本地计划保存失败" };
    }
    if (!localResult.success) {
      this.inviteStatusPending = false;
      showActiveToast(this, { title: localResult.error || "本地计划保存失败", icon: "none" });
      return Promise.resolve(false);
    }

    const appliedPlan = localResult.updated || null;
    let appliedCoupon = null;
    try {
      appliedCoupon = localBefore.couponId ? couponStore.findCoupon(localBefore.couponId) : null;
    } catch (error) {
      const rolledBack = rollbackLocalAcceptance(localBefore, appliedPlan, null);
      this.inviteStatusPending = false;
      showActiveToast(this, {
        title: rolledBack ? "本地优惠券读取失败，请重试" : "本地读取失败，且日程恢复失败，请重新打开",
        icon: "none",
      });
      return Promise.resolve(false);
    }
    const statusRequest = () => (inviteId
      ? inviteService.updateInviteStatus(inviteId, "confirmed", {
        invite: inviteAtAcceptance,
        plan: planAtAcceptance,
      })
      : Promise.resolve({ success: true, localOnly: true }));

    return Promise.resolve().then(statusRequest).then((statusResult) => {
      const remoteAccepted = Boolean(statusResult && (statusResult.success || statusResult.remoteUpdated));
      if (!remoteAccepted) {
        const rolledBack = rollbackLocalAcceptance(localBefore, appliedPlan, appliedCoupon);
        showActiveToast(this, {
          title: rolledBack
            ? (statusResult && statusResult.message || "邀请状态已变化，请刷新后重试")
            : "邀请确认失败，且本地状态恢复失败，请重新打开",
          icon: "none",
        });
        reloadActivePlan(this);
        return false;
      }

      let inviteLinkSaved = true;
      const confirmedInvite = inviteId ? Object.assign({}, inviteAtAcceptance, {
        id: inviteId,
        inviteId,
        status: "confirmed",
        statusSyncStatus: statusResult && statusResult.localOnly ? "local" : "cloud",
      }) : null;
      if (confirmedInvite && appliedPlan && appliedPlan.id) {
        const attached = attachInviteSafely(appliedPlan.id, confirmedInvite);
        inviteLinkSaved = Boolean(attached);
      }
      if (confirmedInvite) this.pendingInvite = confirmedInvite;

      if (!isPageActive(this)) return true;
      const partial = !statusResult.success || statusResult.localOnly || !inviteLinkSaved;
      const partialContent = statusResult.localOnly
        ? "日程已加入本机计划清单；云端暂不可用，好友侧状态可能尚未同步。是否同时写入手机系统日历？"
        : "日程已加入计划清单，但本地邀请缓存保存不完整，请稍后重新打开确认。是否同时写入手机系统日历？";
      try {
        showModalSafely(this, {
          title: "🎉 邀请已接受",
          content: partial
            ? partialContent
            : "该就餐日程已加入您的计划清单！是否同时写入手机系统日历（到期自动提醒）？",
          confirmText: "写入日历",
          cancelText: "暂不写入",
          success: (res) => {
            if (!isPageActive(this)) return;
            if (res && res.confirm) this.addToCalendar();
          },
        }, "邀请结果提示打开失败");
        reloadActivePlan(this);
      } catch (error) {
        console.warn("accepted invite result UI failed:", error);
      }
      return true;
    }).catch((error) => {
      const rolledBack = rollbackLocalAcceptance(localBefore, appliedPlan, appliedCoupon);
      showActiveToast(this, {
        title: rolledBack
          ? ((error && error.message) || "邀请确认失败，请稍后重试")
          : "邀请确认失败，且本地状态恢复失败，请重新打开",
        icon: "none",
      });
      reloadActivePlan(this);
      return false;
    }).then((result) => {
      this.inviteStatusPending = false;
      return result;
    });
  },

  rejectInvite() {
    if (!this.data.plan) return;
    showModalSafely(this, {
      title: "拒绝邀请",
      content: "确认拒绝这个活动邀请吗？",
      confirmText: "确认拒绝",
      cancelText: "取消",
      success: (res) => {
        if (!res || !res.confirm || !isPageActive(this) || this.inviteStatusPending) return;
        const planAtRejection = this.data.plan;
        const inviteAtRejection = this.data.currentInvite || this.pendingInvite || {};
        const inviteId = this.inviteId || getInviteId(inviteAtRejection) || planAtRejection.inviteId || "";
        if (!inviteId || inviteService.isInviteDeleted(inviteId)) {
          showActiveToast(this, { title: "邀请信息不完整或已失效，无法回复", icon: "none" });
          return;
        }

        let originalPlan = null;
        try {
          originalPlan = planStore.findPlan(planAtRejection.id);
        } catch (error) {
          showActiveToast(this, { title: "本地计划读取失败，请重试", icon: "none" });
          return;
        }
        let localResult = { success: true, updated: null };
        if (originalPlan) {
          try {
            localResult = rejectFriendAction(originalPlan, "朋友拒绝了邀约");
          } catch (error) {
            localResult = { success: false, error: error && error.message || "本地状态保存失败" };
          }
          if (!localResult.success) {
            showActiveToast(this, { title: localResult.error || "本地状态保存失败", icon: "none" });
            return;
          }
        }

        this.inviteStatusPending = true;
        const appliedPlan = localResult.updated;
        Promise.resolve().then(() => inviteService.updateInviteStatus(inviteId, "rejected", {
          invite: inviteAtRejection,
          plan: planAtRejection,
        })).then((statusResult) => {
          const remoteRejected = Boolean(statusResult && (statusResult.success || statusResult.remoteUpdated));
          if (!remoteRejected) {
            const rolledBack = rollbackLocalPlanSnapshot(originalPlan, appliedPlan);
            showActiveToast(this, {
              title: rolledBack
                ? (statusResult && statusResult.message || "邀请状态已变化，请刷新后重试")
                : "拒绝邀请失败，且本地状态恢复失败，请重新打开",
              icon: "none",
            });
            reloadActivePlan(this);
            return false;
          }

          let inviteLinkSaved = true;
          if (appliedPlan) {
            const rejectedInvite = Object.assign({}, inviteAtRejection, {
              id: inviteId,
              inviteId,
              status: "rejected",
              statusSyncStatus: statusResult.localOnly ? "local" : "cloud",
            });
            inviteLinkSaved = Boolean(attachInviteSafely(appliedPlan.id, rejectedInvite));
            this.pendingInvite = rejectedInvite;
          }
          if (isPageActive(this)) {
            try {
              wx.showToast({
                title: statusResult.localOnly
                  ? "已在本机婉拒，云端状态待同步"
                  : (statusResult.success && inviteLinkSaved
                    ? "已婉拒邀请"
                    : "已婉拒邀请，本地邀请缓存待修复"),
                icon: "none",
              });
              this.loadPlan();
            } catch (error) {
              console.warn("rejected invite result UI failed:", error);
            }
          }
          return true;
        }).catch((error) => {
          const rolledBack = rollbackLocalPlanSnapshot(originalPlan, appliedPlan);
          showActiveToast(this, {
            title: rolledBack
              ? ((error && error.message) || "邀请拒绝失败，请稍后重试")
              : "拒绝邀请失败，且本地状态恢复失败，请重新打开",
            icon: "none",
          });
          reloadActivePlan(this);
          return false;
        }).then(() => {
          this.inviteStatusPending = false;
        });
      },
    }, "拒绝确认框打开失败，请重试");
  },

};
