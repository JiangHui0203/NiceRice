const couponStore = require("../../utils/couponStore.js");
const planStore = require("../../utils/planStore.js");
const recommendation = require("../../utils/recommendation.js");
const eventLogger = require("../../utils/eventLogger.js");
const inviteService = require("../../utils/services/inviteService.js");
const notificationService = require("../../utils/services/notificationService.js");
const weatherService = require("../../utils/services/weatherService.js");
const haptics = require("../../utils/haptics.js");
const friendStore = require("../../utils/friendStore.js");
const { isActivePlanStatus } = require("../../utils/plan/planStatus.js");
const { normalizeExactId } = require("../../utils/idUtils.js");

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function formatReservationText(coupon = {}) {
  const status = coupon.reservationStatus || "unknown";
  const map = { not_required: "免预约", required: "需预约", pending: "待预约", confirmed: "已预约", failed: "预约失败", unknown: "预约要求待补充" };
  return map[status] || (coupon.reservationRequired === true ? "需预约" : "预约要求待补充");
}

function estimateFriendTravel() {
  return "待好友确认";
}

function buildReminders(coupon = {}, rec = {}) {
  const recWarnings = Array.isArray(rec.warnings) ? rec.warnings : [];
  return [
    coupon.cleanup,
    coupon.reservationRequired ? "这张券需要预约，确认前最好先看可预约时段。" : "",
    coupon.usageRules && coupon.usageRules.notes ? `使用规则：${coupon.usageRules.notes}` : "",
    coupon.refundInfo && coupon.refundInfo.refundType === "non_refundable" ? "可能不可退款，建议优先处理。" : "",
  ].concat(recWarnings).filter(Boolean);
}

function normalizeRouteDate(value) {
  const candidate = String(value || "").trim();
  const matched = candidate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return "";
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return "";
  return candidate;
}

function normalizeRouteTime(value) {
  const candidate = String(value || "").trim();
  const matched = candidate.match(/^(\d{2}):(\d{2})$/);
  if (!matched) return "";
  if (Number(matched[1]) > 23 || Number(matched[2]) > 59) return "";
  return candidate;
}

Page({
  data: {
    coupon: null,
    recommendation: null,
    weather: {},
    selectedIndex: 0,
    selectedTime: null,
    timeOptions: [],
    friends: [],
    selectedFriendIndex: -1,
    selectedFriend: null,
    partnerText: "你",
    friendTravelTime: "待估算",
    friendRestrictionText: "忌口待确认",
    reservationText: "预约要求待补充",
    reminders: [],
    isCustomMode: false,
    customDate: "",
    customWeekday: "今天",
    customStartTime: "18:30",
    customEndTime: "20:00",
    customSlot: null,
  },

  onLoad(options = {}) {
    this.unloaded = false;
    this.hidden = false;
    const routeDate = normalizeRouteDate(options && options.date);
    const routeStartTime = normalizeRouteTime(options && options.startTime);
    const couponId = normalizeExactId(options.id);
    const coupon = couponStore.findCoupon(couponId);
    if (!coupon) {
      this.missingCoupon = true;
      wx.showToast({ title: "未找到这张券", icon: "none" });
      this.scheduleRedirect(() => wx.navigateBack(), 1500);
      return;
    }
    this.missingCoupon = false;
    const weather = weatherService.getWeather();
    const context = recommendation.buildRecommendationContext({ weather, existingPlans: planStore.getPlans() });
    const rec = recommendation.generateRecommendation(coupon, context);
    const timeOptions = recommendation.generateTimeOptions(coupon, context);
    const selectedIndex = routeDate ? -1 : (options.mode === "times" && timeOptions[1] ? 1 : 0);
    const selectedTime = timeOptions[selectedIndex] || {
      label: "待定", date: "", weekday: "", startTime: "待定", endTime: "", range: "待定", recommendation: rec,
    };

    const pad = (n) => String(n).padStart(2, "0");
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const friends = friendStore.readFriends() || [];
    const hasFriend = friends.length > 0;
    const selectedFriend = hasFriend ? friends[0] : null;
    const selectedFriendIndex = hasFriend ? 0 : -1;

    let partnerText = "你";
    let friendTravelTime = "待估算";
    let friendRestrictionText = "忌口待确认";
    if (coupon.people !== "1人") {
      partnerText = selectedFriend ? `你、${selectedFriend.name}` : "你、朋友";
      friendTravelTime = estimateFriendTravel(coupon.travelTime);
      friendRestrictionText = (selectedFriend && (selectedFriend.restrictions || []).join("、")) || "忌口待确认";
    }

    this.setData({
      coupon: recommendation.mergeCouponRecommendation(coupon, rec),
      recommendation: rec,
      weather,
      selectedIndex,
      selectedTime,
      timeOptions,
      friends,
      selectedFriendIndex,
      selectedFriend,
      partnerText,
      friendTravelTime,
      friendRestrictionText,
      reservationText: formatReservationText(coupon),
      reminders: buildReminders(coupon, rec),
      isCustomMode: Boolean(routeDate),
      customDate: routeDate || todayStr,
      customStartTime: routeDate ? (routeStartTime || normalizeRouteTime(selectedTime.startTime) || "18:30") : "18:30",
    }, this.recalculateCustomSlot);
  },

  onShow() {
    if (this.unloaded) return;
    this.hidden = false;
    if (this.missingCoupon && (this.redirectTimer === null || this.redirectTimer === undefined)) {
      this.scheduleRedirect(() => wx.navigateBack(), 1500);
    }
  },

  clearRedirectTimer() {
    if (this.redirectTimer !== null && this.redirectTimer !== undefined) {
      clearTimeout(this.redirectTimer);
      this.redirectTimer = null;
    }
  },

  scheduleRedirect(callback, delay) {
    this.clearRedirectTimer();
    this.redirectTimer = setTimeout(() => {
      this.redirectTimer = null;
      if (!this.hidden && !this.unloaded && typeof callback === "function") callback();
    }, delay);
  },

  onHide() {
    this.hidden = true;
    this.clearRedirectTimer();
  },

  onUnload() {
    this.unloaded = true;
    this.hidden = true;
    this.clearRedirectTimer();
  },

  onFriendChange(e) {
    const index = Number(e.detail.value);
    const selectedFriend = this.data.friends[index];
    if (!selectedFriend) return;

    this.setData({
      selectedFriendIndex: index,
      selectedFriend,
      partnerText: `你、${selectedFriend.name}`,
      friendTravelTime: estimateFriendTravel(this.data.coupon && this.data.coupon.travelTime),
      friendRestrictionText: (selectedFriend.restrictions || []).join("、") || "忌口待确认",
    });
  },

  selectTime(e) {
    const selectedIndex = Number(e.currentTarget.dataset.index);
    const option = this.data.timeOptions[selectedIndex];
    if (!option || !this.data.coupon) return;
    const rec = (option && option.recommendation) || {};
    this.setData({
      isCustomMode: false,
      selectedIndex,
      selectedTime: option,
      recommendation: rec,
      reminders: buildReminders(this.data.coupon, rec),
    });
  },

  toggleCustomMode() {
    const isCustomMode = !this.data.isCustomMode;
    if (isCustomMode) {
      this.setData({ isCustomMode: true, selectedIndex: -1 }, this.recalculateCustomSlot);
    } else {
      const option = this.data.timeOptions[0];
      if (!option || !this.data.coupon) {
        this.setData({ isCustomMode: false, selectedIndex: -1, selectedTime: null });
        return;
      }
      const rec = (option && option.recommendation) || {};
      this.setData({
        isCustomMode: false,
        selectedIndex: 0,
        selectedTime: option,
        recommendation: rec,
        reminders: buildReminders(this.data.coupon, rec),
      });
    }
  },

  onCustomDateChange(e) {
    this.setData({ customDate: e.detail.value }, this.recalculateCustomSlot);
  },

  onCustomStartTimeChange(e) {
    this.setData({ customStartTime: e.detail.value }, this.recalculateCustomSlot);
  },

  recalculateCustomSlot() {
    const { coupon, customDate, customStartTime } = this.data;
    if (!coupon || !customDate || !customStartTime) return;

    const normalizedDate = normalizeRouteDate(customDate);
    const d = normalizedDate ? new Date(`${normalizedDate}T00:00:00`) : null;
    const customWeekday = d ? WEEKDAYS[d.getDay()] : "日期无效";
    const context = recommendation.buildRecommendationContext({ existingPlans: planStore.getPlans() });
    const slot = recommendation.evaluateCustomSlot(coupon, customDate, customStartTime, context);

    const updateData = { customSlot: slot, customWeekday, customEndTime: slot.endTime };
    if (this.data.isCustomMode) {
      updateData.selectedTime = slot;
      updateData.recommendation = slot.recommendation || {};
      updateData.reminders = buildReminders(coupon, slot.recommendation || {});
    }
    this.setData(updateData);
  },

  confirmPlan() {
    this.savePlan("confirmed");
  },

  inviteFriend() {
    this.savePlan("pending");
  },

  savePlan(statusCode) {
    if (this.isSubmitting) return;
    const { coupon, selectedTime, recommendation: rec, selectedFriend } = this.data;
    if (!coupon || !selectedTime) return;

    const selectedDate = normalizeRouteDate(selectedTime.date);
    const selectedStartTime = normalizeRouteTime(selectedTime.startTime);
    const blockers = []
      .concat(Array.isArray(selectedTime.blockers) ? selectedTime.blockers : [])
      .concat(rec && Array.isArray(rec.blockers) ? rec.blockers : []);
    if (!selectedDate || !selectedStartTime || selectedTime.level === "blocked" || (rec && rec.level === "blocked") || blockers.length) {
      wx.showToast({ title: blockers[0] || "请选择有效且可用的时间", icon: "none" });
      return;
    }

    this.isSubmitting = true;
    const existing = (planStore.getPlans() || []).find((item) => item.couponId === coupon.id && isActivePlanStatus(item.statusCode));
    if (existing) {
      this.isSubmitting = false;
      wx.showToast({ title: "计划已存在", icon: "none" });
      this.scheduleRedirect(() => wx.redirectTo({ url: `/pages/plan-detail/index?id=${encodeURIComponent(existing.id)}` }), 450);
      return;
    }

    const participants = [{ id: "self", name: "我", status: "confirmed" }];
    if (coupon.people !== "1人") {
      participants.push({
        id: selectedFriend ? (selectedFriend.id || `friend_${Date.now()}`) : "friend_001",
        name: selectedFriend ? selectedFriend.name : "朋友",
        status: statusCode === "pending" ? "pending" : "confirmed",
      });
    }

    let plan = null;
    try {
      plan = planStore.createPlanFromRecommendation(coupon, rec, participants, { statusCode, selectedTime });
    } catch (error) {
      console.error("Plan creation failed:", error);
    }
    if (!plan || !plan.id) {
      this.isSubmitting = false;
      wx.showToast({ title: "计划保存失败，请重试", icon: "none" });
      return;
    }
    try {
      Promise.resolve(notificationService.requestPlanSubscriptions(plan)).catch(() => false);
    } catch (error) {
      console.warn("plan subscription request failed:", error);
    }
    try {
      eventLogger.logEvent("plan_created", { planId: plan.id, couponId: coupon.id, statusCode, score: rec && rec.score });
    } catch (error) {
      console.warn("plan_created log failed:", error);
    }

    const partnerName = selectedFriend ? selectedFriend.name : "朋友";
    const afterInvite = statusCode === "pending"
      ? inviteService.createInvite(plan, partnerName).then((invite) => {
        const attached = planStore.attachInvite(plan.id, invite);
        if (!attached) {
          return inviteService.deleteInvite(invite.inviteId || invite.id).then(() => {
            throw new Error("邀请已生成，但本地计划关联保存失败");
          });
        }
        try {
          eventLogger.logEvent("plan_invite_created", { planId: plan.id, inviteId: invite.inviteId || invite.id });
        } catch (error) {
          console.warn("plan_invite_created log failed:", error);
        }
        return attached;
      })
      : Promise.resolve();

    afterInvite.then(() => {
      this.isSubmitting = false;
      if (this.hidden || this.unloaded) return;
      wx.showToast({ title: statusCode === "confirmed" ? "计划已锁定" : "已生成邀约", icon: "success" });
      this.scheduleRedirect(() => wx.redirectTo({ url: `/pages/plan-detail/index?id=${encodeURIComponent(plan.id)}` }), 500);
    }).catch((err) => {
      this.isSubmitting = false;
      console.error("Invite creation failed:", err);
      if (this.hidden || this.unloaded) return;
      wx.showToast({ title: "已保留本地日程", icon: "none" });
      this.scheduleRedirect(() => wx.redirectTo({ url: `/pages/plan-detail/index?id=${encodeURIComponent(plan.id)}` }), 1500);
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
});
