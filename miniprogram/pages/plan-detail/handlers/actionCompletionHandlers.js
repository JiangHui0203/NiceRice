const {
  couponStore,
  beginPlanAction,
  finishPlanAction,
  showActiveToast,
  renderStoredPlan,
  findCouponSafely,
  getPlanInviteId,
  revokePlanInvite,
  completePlanAction,
  cancelPlanAction,
} = require("./actionSupport.js");

module.exports = {
  cancelPlan() {
    if (!this.data.plan) return;
    const linkedCoupon = findCouponSafely(this.data.plan.couponId);
    const hasCoupon = Boolean(linkedCoupon);
    try {
      wx.showModal({
      title: "取消计划",
      content: hasCoupon
        ? "取消后优惠券将自动回退为「待安排」，并解除日程占用，确定取消吗？"
        : "取消后将解除这段日程占用，确定取消吗？",
      confirmColor: "#dc2626",
      confirmText: "确定取消",
      cancelText: "再想想",
      success: (res) => {
        if (!res || this.hidden || this.unloaded) return;
        if (res.confirm && beginPlanAction(this, "cancel")) {
          let result = null;
          try {
            result = cancelPlanAction(this.data.plan);
          } catch (error) {
            result = { success: false, error: error && error.message || "取消保存失败" };
          }
          if (!result.success) {
            finishPlanAction(this, "cancel");
            showActiveToast(this, { title: result.error || "取消失败", icon: "none" });
            return;
          }
          const inviteId = (result.updated && result.updated.inviteId) || this.inviteId || "";
          revokePlanInvite(this, result.updated, inviteId).then((cleanup) => {
            finishPlanAction(this, "cancel");
            showActiveToast(this, {
              title: cleanup.cleaned
                ? (hasCoupon ? "计划已取消，券已回退" : "计划已取消")
                : "计划已取消，邀请清理待重试",
              icon: "none",
            });
            renderStoredPlan(this, cleanup.updated, {
              coupon: result.updated.couponId ? findCouponSafely(result.updated.couponId) : this.data.coupon,
              currentInvite: cleanup.detached ? null : this.data.currentInvite,
            });
          }).catch(() => {
            finishPlanAction(this, "cancel");
            showActiveToast(this, { title: "计划已取消，邀请清理待重试", icon: "none" });
            renderStoredPlan(this, result.updated);
          });
        }
        },
        fail: () => showActiveToast(this, { title: "取消确认框打开失败，请重试", icon: "none" }),
      });
    } catch (error) {
      showActiveToast(this, { title: "取消确认框打开失败，请重试", icon: "none" });
    }
  },

  completePlan() {
    if (!this.data.plan) return;
    const plan = this.data.plan;
    const couponId = plan.couponId;
    const coupon = findCouponSafely(couponId);
    const origPrice = coupon && Number(coupon.originalPrice) > 0 ? Number(coupon.originalPrice) : 0;
    const actualPaid = coupon && Number(coupon.price) > 0 ? Number(coupon.price) : Number(plan.price || 0);
    const saved = origPrice > actualPaid ? (origPrice - actualPaid) : 0;

    try {
      wx.showActionSheet({
      itemList: [
        `✓ 已使用（打卡完成${saved > 0 ? ` · 省 ¥${saved}` : ""}）`,
        "🔄 没去，重新安排时间",
        couponId ? "❌ 没去，优惠券已失效" : "❌ 没去，取消计划",
      ],
      success: (res) => {
        if (!res || this.hidden || this.unloaded) return;
        if (res.tapIndex === 0) {
          if (!beginPlanAction(this, "complete")) return;
          let result = null;
          try {
            result = completePlanAction(this.data.plan);
          } catch (error) {
            result = { success: false, error: error && error.message || "完成状态保存失败" };
          }
          if (!result.success) {
            finishPlanAction(this, "complete");
            showActiveToast(this, { title: result.error || "操作失败", icon: "none" });
            return;
          }
          const inviteId = getPlanInviteId(this, result.updated);
          revokePlanInvite(this, result.updated, inviteId).then((cleanup) => {
            finishPlanAction(this, "complete");
            if (!isPageActive(this)) return;
            const baseContent = saved > 0
              ? `恭喜！本次聚餐已节省 ¥${saved} 元，已记录至足迹回顾与推荐模型。`
              : "已记录聚餐完成！";
            try {
              wx.showModal({
                title: "🎉 聚餐打卡完成",
                content: cleanup.cleaned ? baseContent : `${baseContent}\n旧邀请清理待重试。`,
                showCancel: false,
                confirmText: "知道了",
                confirmColor: "#0f766e",
              });
            } catch (error) {
              console.warn("completed plan result modal failed:", error);
            }
            renderStoredPlan(this, cleanup.updated, {
              feedbackVisible: true,
              currentInvite: cleanup.detached ? null : this.data.currentInvite,
            });
          }).catch(() => {
            finishPlanAction(this, "complete");
            showActiveToast(this, { title: "打卡已完成，旧邀请清理待重试", icon: "none" });
            renderStoredPlan(this, result.updated, { feedbackVisible: true });
          });
        } else if (res.tapIndex === 1) {
          if (!beginPlanAction(this, "reschedule")) return;
          let cancelled = null;
          try {
            cancelled = cancelPlanAction(this.data.plan, null, "用户选择重新安排");
          } catch (error) {
            cancelled = { success: false, error: error && error.message || "重新安排保存失败" };
          }
          if (!cancelled.success) {
            finishPlanAction(this, "reschedule");
            showActiveToast(this, { title: cancelled.error || "重新安排失败", icon: "none" });
            return;
          }
          const inviteId = (cancelled.updated && cancelled.updated.inviteId) || this.inviteId || "";
          const continueReschedule = (cleanup) => {
            finishPlanAction(this, "reschedule");
            if (!isPageActive(this)) return;
            renderStoredPlan(this, cleanup.updated || cancelled.updated, {
              coupon: couponId ? findCouponSafely(couponId) : this.data.coupon,
              currentInvite: cleanup.detached ? null : this.data.currentInvite,
            });
            showActiveToast(this, {
              title: cleanup.cleaned
                ? (coupon ? "券已恢复待安排" : "计划已取消，可重新安排")
                : (coupon ? "券已恢复，旧邀请清理待重试" : "计划已取消，旧邀请清理待重试"),
              icon: "none",
            });
            if (this.actionRedirectTimer !== null && this.actionRedirectTimer !== undefined) {
              clearTimeout(this.actionRedirectTimer);
            }
            try {
              this.actionRedirectTimer = setTimeout(() => {
                this.actionRedirectTimer = null;
                if (this.hidden || this.unloaded) return;
                try {
                  wx.redirectTo({
                    url: `/pages/time-options/index?couponId=${encodeURIComponent(couponId || "")}&planId=${encodeURIComponent(plan.id)}`,
                    fail: () => {
                      showActiveToast(this, { title: "改期页面打开失败，请重试", icon: "none" });
                    },
                  });
                } catch (error) {
                  showActiveToast(this, { title: "改期页面打开失败，请重试", icon: "none" });
                }
              }, 400);
            } catch (error) {
              this.actionRedirectTimer = null;
              showActiveToast(this, { title: "改期页面打开失败，请重试", icon: "none" });
            }
          };
          revokePlanInvite(this, cancelled.updated, inviteId)
            .then(continueReschedule)
            .catch(() => continueReschedule({ updated: cancelled.updated, cleaned: false }));
        } else if (res.tapIndex === 2) {
          if (!beginPlanAction(this, "expire")) return;
          let originalCoupon = null;
          let expiredCoupon = null;
          try {
            originalCoupon = couponId ? couponStore.findCoupon(couponId) : null;
            expiredCoupon = couponId
              ? couponStore.updateCouponStatus(couponId, "expired", { skipActivityLog: true })
              : true;
          } catch (error) {
            expiredCoupon = null;
          }
          if (!expiredCoupon) {
            finishPlanAction(this, "expire");
            showActiveToast(this, { title: "券失效状态保存失败，请重试", icon: "none" });
            return;
          }
          let cancelled = null;
          try {
            cancelled = cancelPlanAction(this.data.plan, null, "优惠券已失效");
          } catch (error) {
            cancelled = { success: false, error: error && error.message || "计划取消失败" };
          }
          if (!cancelled.success) {
            let couponRestored = !originalCoupon;
            if (originalCoupon) {
              try {
                couponRestored = Boolean(couponStore.importCouponSnapshot(originalCoupon));
              } catch (error) {
                couponRestored = false;
              }
            }
            finishPlanAction(this, "expire");
            showActiveToast(this, {
              title: couponRestored
                ? (cancelled.error || "计划取消失败，请重试")
                : "计划取消失败，且券状态恢复失败，请重新打开",
              icon: "none",
            });
            return;
          }
          const inviteId = (cancelled.updated && cancelled.updated.inviteId) || this.inviteId || "";
          const finishExpiry = (cleanup) => {
            finishPlanAction(this, "expire");
            if (!isPageActive(this)) return;
            showActiveToast(this, {
              title: cleanup.cleaned
                ? (couponId ? "已标记券失效" : "计划已取消")
                : (couponId ? "券已失效，旧邀请清理待重试" : "计划已取消，旧邀请清理待重试"),
              icon: "none",
            });
            renderStoredPlan(this, cleanup.updated || cancelled.updated, {
              coupon: couponId ? findCouponSafely(couponId) : this.data.coupon,
              currentInvite: cleanup.detached ? null : this.data.currentInvite,
            });
          };
          revokePlanInvite(this, cancelled.updated, inviteId)
            .then(finishExpiry)
            .catch(() => finishExpiry({ updated: cancelled.updated, cleaned: false }));
        }
        },
        fail: () => showActiveToast(this, { title: "计划操作菜单打开失败，请重试", icon: "none" }),
      });
    } catch (error) {
      showActiveToast(this, { title: "计划操作菜单打开失败，请重试", icon: "none" });
    }
  },

};
