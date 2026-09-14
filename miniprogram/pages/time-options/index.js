const couponStore = require("../../utils/couponStore.js");
const planStore = require("../../utils/planStore.js");
const eventLogger = require("../../utils/eventLogger.js");
const inviteService = require("../../utils/services/inviteService.js");
const notificationService = require("../../utils/services/notificationService.js");
const haptics = require("../../utils/haptics.js");
const { generateTimeOptionsList, evaluateCustomTimeSlot } = require("./timeOptionsHelper.js");
const { normalizeExactId } = require("../../utils/idUtils.js");

const INVITE_UPDATE_CONFLICT_CODES = new Set([
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

function readOptionalExactId(value, validator = null) {
  if (value === undefined || value === null || value === "") return { value: "", invalid: false };
  const id = normalizeExactId(value);
  if (!id || (validator && !validator(id))) return { value: "", invalid: true };
  return { value: id, invalid: false };
}

Page({
  data: {
    plan: null,
    coupon: null,
    options: [],
    selectedIndex: 0,
    selectedOption: null,
    customDate: "",
    customTime: "",
    showCustom: false,
    isRecipient: false,
    submitting: false,
  },

  onLoad(options = {}) {
    this._unloaded = false;
    this._hidden = false;
    this.isSubmitting = false;
    this._submitToken = 0;
    const optionIdentity = readOptionalExactId(options.id);
    const planIdentity = readOptionalExactId(options.planId);
    const couponIdentity = readOptionalExactId(options.couponId);
    const inviteIdentity = readOptionalExactId(
      options.inviteId,
      (id) => /^[A-Za-z0-9_-]{6,96}$/.test(id),
    );
    this._invalidRouteIdentity = optionIdentity.invalid || planIdentity.invalid
      || couponIdentity.invalid || inviteIdentity.invalid;
    this.planId = planIdentity.value || (!couponIdentity.value ? optionIdentity.value : "");
    this.couponId = couponIdentity.value || (planIdentity.value ? optionIdentity.value : "");
    this.inviteId = inviteIdentity.value;
    this.isRecipient = options.isRecipient === "true" || options.role === "recipient";
    const today = new Date();
    const pad = (val) => String(val).padStart(2, "0");

    this.setData({
      customDate: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
      customTime: "12:00",
      isRecipient: this.isRecipient,
    });
    this.loadOptions();
  },

  loadOptions() {
    if (this._invalidRouteIdentity) {
      this._missingSource = true;
      wx.showToast({ title: "页面参数无效，请返回后重试", icon: "none" });
      return;
    }
    const plan = planStore.findPlan(this.planId) || planStore.getPlanById(this.planId);
    const coupon = couponStore.findCoupon(this.couponId || (plan && plan.couponId));
    if (!plan && !coupon) {
      if (this.isRecipient && this.inviteId) {
        const loadToken = (this._loadToken || 0) + 1;
        this._loadToken = loadToken;
        this._inviteLoadPending = true;
        inviteService.getInviteById(this.inviteId).then((invite) => {
          if (this._unloaded || this._hidden || loadToken !== this._loadToken) return;
          this._inviteLoadPending = false;
          const remotePlan = invite && !invite.invalid && invite.planSnapshot;
          if (!remotePlan) {
            this._missingSource = true;
            wx.showToast({ title: "邀请已失效或尚未同步", icon: "none" });
            return;
          }
          this.currentInvite = invite;
          this.applyLoadedOptions(remotePlan, null);
        }).catch(() => {
          if (!this._unloaded && !this._hidden && loadToken === this._loadToken) {
            this._inviteLoadPending = false;
            this._missingSource = true;
            wx.showToast({ title: "邀请读取失败，请稍后重试", icon: "none" });
          }
        });
        return;
      }
      this._missingSource = true;
      wx.showToast({ title: "未找到计划或券", icon: "none" });
      this._navigationTimer = setTimeout(() => {
        this._navigationTimer = null;
        if (!this._unloaded && !this._hidden) wx.navigateBack();
      }, 1500);
      return;
    }
    this.applyLoadedOptions(plan, coupon);
  },

  applyLoadedOptions(plan, coupon) {
    this._missingSource = false;
    this._inviteLoadPending = false;
    const existingPlans = (planStore.getPlans() || []).filter((item) => !plan || item.id !== plan.id);
    const targetCoupon = coupon || { title: plan ? plan.title : "生活安排", type: plan ? plan.category : "美食" };
    const options = generateTimeOptionsList(targetCoupon, existingPlans);

    this.setData({
      plan,
      coupon,
      options,
      selectedIndex: 0,
      selectedOption: options[0] || null,
    });
  },

  selectOption(e) {
    haptics.light();
    const selectedIndex = Number(e.currentTarget.dataset.index);
    this.setData({ selectedIndex, selectedOption: this.data.options[selectedIndex] });
  },

  onCustomDateChange(e) {
    this.setData({ customDate: e.detail.value }, this.evaluateCustomChoice);
  },

  onCustomTimeChange(e) {
    this.setData({ customTime: e.detail.value }, this.evaluateCustomChoice);
  },

  evaluateCustomChoice() {
    const { coupon, customDate, customTime, options } = this.data;
    const evaluated = evaluateCustomTimeSlot(coupon, customDate, customTime, this.planId, options);
    if (evaluated) this.setData(Object.assign({}, evaluated, { showCustom: true }));
  },

  toggleCustom() {
    haptics.light();
    this.setData({ showCustom: !this.data.showCustom }, () => {
      if (this.data.showCustom) this.evaluateCustomChoice();
    });
  },

  showNoticeDetail(e) {
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    haptics.light();
    wx.showModal({
      title: "提醒说明",
      content: text,
      showCancel: false,
      confirmText: "知道了",
      confirmColor: "#0f766e",
    });
  },

  confirmChange() {
    if (this.isSubmitting) return;
    const { plan, coupon, selectedOption } = this.data;
    if (!selectedOption || (!plan && !coupon)) return;

    const dateMatched = String(selectedOption.date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const timeMatched = String(selectedOption.startTime || "").match(/^(\d{2}):(\d{2})$/);
    const exactDate = dateMatched
      ? new Date(Number(dateMatched[1]), Number(dateMatched[2]) - 1, Number(dateMatched[3]))
      : null;
    const dateValid = Boolean(exactDate
      && exactDate.getFullYear() === Number(dateMatched[1])
      && exactDate.getMonth() === Number(dateMatched[2]) - 1
      && exactDate.getDate() === Number(dateMatched[3]));
    const timeValid = Boolean(timeMatched && Number(timeMatched[1]) <= 23 && Number(timeMatched[2]) <= 59);
    const blockers = []
      .concat(Array.isArray(selectedOption.blockers) ? selectedOption.blockers : [])
      .concat(selectedOption.recommendation && Array.isArray(selectedOption.recommendation.blockers)
        ? selectedOption.recommendation.blockers
        : []);
    if (!dateValid || !timeValid || selectedOption.level === "blocked"
      || (selectedOption.recommendation && selectedOption.recommendation.level === "blocked")
      || blockers.length) {
      wx.showToast({ title: blockers[0] || "请选择有效且可用的时间", icon: "none" });
      return;
    }

    this.isSubmitting = true;
    const submitToken = ++this._submitToken;
    this.setData({ submitting: true });

    const releaseSubmitting = () => {
      if (submitToken !== this._submitToken) return;
      this.isSubmitting = false;
      if (!this._unloaded && !this._hidden) this.setData({ submitting: false });
    };

    if (this.isRecipient && this.inviteId) {
      inviteService.proposeInviteTime(this.inviteId, selectedOption, {
        planUpdatedAt: this.currentInvite && this.currentInvite.planUpdatedAt,
      }).then((result) => {
        if (this._unloaded || submitToken !== this._submitToken) return;
        if (this._hidden) {
          releaseSubmitting();
          this._reloadOnShow = true;
          return;
        }
        if (!result || !result.success) {
          releaseSubmitting();
          wx.showToast({ title: result && result.message || "改期提议发送失败", icon: "none" });
          return;
        }
        wx.showToast({
          title: result.localOnly ? "提议已保存在本机" : "改期提议已发送",
          icon: "none",
        });
        if (this._navigationTimer) clearTimeout(this._navigationTimer);
        this._navigationTimer = setTimeout(() => {
          this._navigationTimer = null;
          if (!this._unloaded && !this._hidden && submitToken === this._submitToken) {
            wx.navigateBack({ fail: releaseSubmitting });
          }
        }, 450);
      }).catch((error) => {
        if (this._unloaded || submitToken !== this._submitToken) return;
        releaseSubmitting();
        if (this._hidden) {
          this._reloadOnShow = true;
          return;
        }
        wx.showToast({ title: error && error.message || "改期提议发送失败", icon: "none" });
      });
      return;
    }

    if (!plan) {
      const query = [
        `id=${encodeURIComponent(coupon.id)}`,
        selectedOption.date ? `date=${encodeURIComponent(selectedOption.date)}` : "",
        selectedOption.startTime ? `startTime=${encodeURIComponent(selectedOption.startTime)}` : "",
      ].filter(Boolean).join("&");
      wx.redirectTo({
        url: `/pages/plan-confirm/index?${query}`,
        fail: releaseSubmitting,
      });
      return;
    }

    const updated = planStore.reschedulePlan(plan.id, selectedOption, selectedOption.recommendation);
    if (!updated) {
      releaseSubmitting();
      wx.showToast({ title: "改时间失败", icon: "none" });
      return;
    }
    Promise.resolve(notificationService.requestPlanSubscriptions(updated)).catch(() => false);

    const finishNavigation = (message = "已更新时间", icon = "success") => {
      if (this._unloaded || submitToken !== this._submitToken) return;
      if (this._hidden) {
        releaseSubmitting();
        this._reloadOnShow = true;
        return;
      }
      try {
        eventLogger.logEvent("plan_rescheduled", { planId: updated.id, couponId: updated.couponId, score: selectedOption.score });
      } catch (error) {
        console.warn("plan_rescheduled log failed:", error);
      }
      wx.showToast({ title: message, icon });
      if (this._navigationTimer) clearTimeout(this._navigationTimer);
      this._navigationTimer = setTimeout(() => {
        this._navigationTimer = null;
        if (this._unloaded || this._hidden || submitToken !== this._submitToken) return;
        wx.navigateBack({ fail: releaseSubmitting });
      }, 450);
    };

    if (updated.inviteId) {
      inviteService.updateInvitePlan(updated.inviteId, updated).then((result) => {
        if (!result || !result.success) {
          const code = result && result.code || "invite_failed";
          if (["missing_invite", "not_found", "invite_expired"].includes(code)) {
            const detached = planStore.attachInvite(updated.id, {});
            Promise.resolve(inviteService.deleteInvite(updated.inviteId)).catch(() => false);
            if (detached) {
              finishNavigation("已更新时间，旧邀请已失效", "none");
              return;
            }
            finishNavigation("已本地更新时间，旧邀请清理待重试", "none");
            return;
          } else if (INVITE_UPDATE_CONFLICT_CODES.has(code)) {
            const restored = planStore.savePlan(plan);
            releaseSubmitting();
            if (!this._unloaded && !this._hidden) {
              wx.showToast({
                title: restored
                  ? (result && result.message || "邀请已变化，请重新打开")
                  : "邀请已变化，且本地时间恢复失败，请重新打开",
                icon: "none",
              });
            }
            return;
          }
          finishNavigation("已本地更新时间，邀请待同步", "none");
          return;
        }
        finishNavigation("已更新时间", "success");
      }).catch((error) => {
        console.warn("invite reschedule sync failed:", error);
        finishNavigation("已本地更新时间，邀请待同步", "none");
      });
    } else if (plan.statusCode === "pending") {
      const friend = (updated.participants || []).find((p) => p.id !== "self");
      inviteService.createInvite(updated, friend ? friend.name : "朋友").then((invite) => {
        if (!planStore.attachInvite(updated.id, invite)) {
          return inviteService.deleteInvite(invite.inviteId || invite.id).then(() => {
            throw new Error("邀请关联保存失败");
          });
        }
        finishNavigation();
        return invite;
      }).catch((error) => {
        console.warn("invite creation after reschedule failed:", error);
        finishNavigation("时间已更新，邀请生成失败，可在详情重试", "none");
      });
    } else {
      finishNavigation();
    }
  },

  onShow() {
    if (this._unloaded) return;
    this._hidden = false;
    if (!this.isSubmitting && this.data.submitting) this.setData({ submitting: false });
    if (this._reloadOnShow) {
      this._reloadOnShow = false;
      this.loadOptions();
    } else if (this._missingSource && !this._navigationTimer) {
      this.loadOptions();
    }
  },

  onHide() {
    this._hidden = true;
    if (this._inviteLoadPending) {
      this._inviteLoadPending = false;
      this._reloadOnShow = true;
    }
    this._loadToken = (this._loadToken || 0) + 1;
    if (this.isSubmitting) {
      this.isSubmitting = false;
      this._submitToken += 1;
      this._reloadOnShow = true;
    }
    if (this._navigationTimer) {
      clearTimeout(this._navigationTimer);
      this._navigationTimer = null;
    }
  },

  onUnload() {
    this._unloaded = true;
    this._hidden = true;
    this._loadToken = (this._loadToken || 0) + 1;
    this._submitToken += 1;
    if (this._navigationTimer) {
      clearTimeout(this._navigationTimer);
      this._navigationTimer = null;
    }
    this.isSubmitting = false;
  },
});
