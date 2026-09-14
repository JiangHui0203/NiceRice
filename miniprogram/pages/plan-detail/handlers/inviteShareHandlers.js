const {
  couponStore,
  notificationService,
  buildShareDataPackage,
  getInviteId,
  isPageActive,
  isPlanTerminal,
  ensurePageInvite,
} = require("./inviteSupport.js");

module.exports = {
  copyInviteText() {
    if (!this.data.plan) return;
    if (this.data.isRecipient) {
      wx.showToast({ title: "仅计划发起人可以转发邀请", icon: "none" });
      return;
    }
    if (isPlanTerminal(this.data.plan)) {
      wx.showToast({ title: "本次邀请已结束", icon: "none" });
      return;
    }
    const current = this.data.currentInvite || this.pendingInvite || this.data.plan.inviteSnapshot || {};
    if (["confirmed", "rejected", "invalid"].includes(current.status)) {
      wx.showToast({ title: "本次邀请已结束，请先改期再重新邀请", icon: "none" });
      return;
    }
    const invite = ensurePageInvite(this) || current;
    if (!getInviteId(invite)) {
      wx.showToast({ title: "邀请尚未准备好，请重试", icon: "none" });
      return;
    }
    let inviteText = "";
    try {
      const planForInvite = Object.assign({}, this.data.plan, {
        venue: this.data.plan.venue
          || (this.data.plan.locationView && this.data.plan.locationView.name)
          || "地点待补充",
      });
      inviteText = notificationService.buildClipboardInvite(planForInvite, invite);
    } catch (error) {
      wx.showToast({ title: error && error.message || "邀请口令生成失败", icon: "none" });
      return;
    }
    try {
      wx.setClipboardData({
        data: inviteText,
        success: () => {
          if (!this.hidden && !this.unloaded) {
            wx.showToast({ title: "邀请口令已复制，可发给好友！", icon: "none", duration: 2000 });
          }
        },
        fail: () => {
          if (!this.hidden && !this.unloaded) wx.showToast({ title: "邀请口令复制失败", icon: "none" });
        },
      });
    } catch (error) {
      if (isPageActive(this)) {
        wx.showToast({ title: "邀请口令复制失败", icon: "none" });
      }
    }
  },

  prepareFriendInvite() {
    if (this.data.isRecipient) {
      wx.showToast({ title: "仅计划发起人可以转发邀请", icon: "none" });
      return null;
    }
    if (!this.data.plan || isPlanTerminal(this.data.plan)) {
      wx.showToast({ title: "本次邀请已结束，请重新安排后再邀请", icon: "none" });
      return null;
    }
    const current = this.data.currentInvite || this.pendingInvite || (this.data.plan && this.data.plan.inviteSnapshot) || {};
    if (["confirmed", "rejected", "invalid"].includes(current.status)) {
      wx.showToast({ title: "本次邀请已结束，请先改期再重新邀请", icon: "none" });
      return null;
    }
    return ensurePageInvite(this);
  },

  onShareAppMessage() {
    if (this.data.isRecipient) {
      return { title: "请由计划发起人分享邀请", path: "/pages/plan/index" };
    }
    const current = this.data.currentInvite || this.pendingInvite || (this.data.plan && this.data.plan.inviteSnapshot) || {};
    const terminal = isPlanTerminal(this.data.plan || {})
      || ["confirmed", "rejected", "invalid"].includes(current.status);
    if (terminal) return { title: "本次邀请已结束", path: "/pages/plan/index" };
    const invite = ensurePageInvite(this) || current;
    const plan = this.data.plan || {};
    if (!getInviteId(invite)) {
      return { title: "邀请暂未准备好", path: "/pages/plan/index" };
    }
    try {
      const coupon = couponStore.findCoupon(plan.couponId || (this.data.coupon && this.data.coupon.id)) || this.data.coupon;
      return buildShareDataPackage(plan, coupon, invite, this.planId || plan.id || "");
    } catch (error) {
      if (isPageActive(this)) wx.showToast({ title: "分享内容生成失败", icon: "none" });
      return { title: "邀请暂未准备好", path: "/pages/plan/index" };
    }
  },

  onShareTimeline() {
    if (this.data.isRecipient) {
      return { title: "请由计划发起人分享邀请", query: "" };
    }
    const current = this.data.currentInvite || this.pendingInvite || (this.data.plan && this.data.plan.inviteSnapshot) || {};
    const terminal = isPlanTerminal(this.data.plan || {})
      || ["confirmed", "rejected", "invalid"].includes(current.status);
    if (terminal) return { title: "本次邀请已结束", query: "" };
    const invite = ensurePageInvite(this) || current;
    const plan = this.data.plan || {};
    if (!getInviteId(invite)) {
      return { title: "邀请暂未准备好", query: "" };
    }
    let shareData = null;
    try {
      const coupon = couponStore.findCoupon(plan.couponId || (this.data.coupon && this.data.coupon.id)) || this.data.coupon;
      shareData = buildShareDataPackage(plan, coupon, invite, this.planId || plan.id || "");
    } catch (error) {
      if (isPageActive(this)) wx.showToast({ title: "分享内容生成失败", icon: "none" });
      return { title: "邀请暂未准备好", query: "" };
    }
    const queryIndex = shareData.path.indexOf("?");
    return {
      title: shareData.title,
      query: queryIndex === -1 ? "" : shareData.path.slice(queryIndex + 1),
    };
  },
};
