const planStore = require("../../utils/planStore.js");
const spinStore = require("../../utils/spinStore.js");
const couponStore = require("../../utils/couponStore.js");
const recommendation = require("../../utils/recommendation.js");
const eventLogger = require("../../utils/eventLogger.js");
const notificationService = require("../../utils/services/notificationService.js");
const weatherService = require("../../utils/services/weatherService.js");
const scheduleStore = require("../../utils/scheduleStore.js");
const haptics = require("../../utils/haptics.js");
const { isActivePlanStatus } = require("../../utils/plan/planStatus.js");
const { normalizeExactId } = require("../../utils/idUtils.js");

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const PLAN_RENDER_PAGE_SIZE = 40;

function parseExactIsoDate(value) {
  const matched = String(value || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!matched) return null;

  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day) {
    return null;
  }
  return date;
}

function formatPlanItem(plan, couponById = null) {
  const couponId = plan.couponId || plan.sourceId || "";
  const coupon = couponId
    ? (couponById && typeof couponById.get === "function" ? couponById.get(couponId) : couponStore.findCoupon(couponId))
    : null;

  const selectedTime = plan.selectedTime || {};
  // date 是事实字段，label 可能只是“周六 晚餐”，不能优先拿来冒充日期。
  const factualDate = selectedTime.date || plan.date || "";
  const rawDate = String(factualDate || selectedTime.label || "").trim();
  const labelOnly = !factualDate && Boolean(rawDate);
  let displayDate = "";
  let displayWeekday = selectedTime.weekday || "";

  const wkMatch = rawDate.match(/(周[一二三四五六日天]|星期[一二三四五六日天])/);
  if (wkMatch) {
    displayWeekday = wkMatch[1].replace("星期", "周").replace("周天", "周日");
  }

  const isoMatch = rawDate.match(/^(\d{4})-0?(\d{1,2})-0?(\d{1,2})$/);
  const chineseMatch = rawDate.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/);
  const mdMatch = isoMatch || chineseMatch;
  if (mdMatch) {
    const year = parseInt(mdMatch[1], 10) || new Date().getFullYear();
    const month = parseInt(mdMatch[2], 10);
    const day = parseInt(mdMatch[3], 10);
    const d = new Date(year, month - 1, day);
    const isExactDate = !Number.isNaN(d.getTime())
      && d.getFullYear() === year
      && d.getMonth() === month - 1
      && d.getDate() === day;
    if (isExactDate) {
      displayDate = `${month}月${day}日`;
      if (!displayWeekday) displayWeekday = WEEKDAYS[d.getDay()];
    }
  } else if (!labelOnly && rawDate && rawDate !== "待定" && rawDate !== "待定日期") {
    displayDate = rawDate.replace(/(周[一二三四五六日天]|星期[一二三四五六日天])/g, "").trim();
  }

  if (!displayDate) displayDate = "日期待定";
  if (!displayWeekday) displayWeekday = "待定";

  const displayTime = plan.time || selectedTime.startTime || "时间待定";

  let venueName = (plan.location && (plan.location.name || plan.location.address)) ||
                  plan.venue || (coupon && (coupon.venue || coupon.merchantName || coupon.address)) || "";
  if (!venueName || venueName === "待补充地点") venueName = "地点待定";

  const rawTravel = String(plan.travelTime || (coupon && coupon.travelTime) || (plan.location && plan.location.distanceText) || "").trim();
  const matchedMinutes = rawTravel.match(/\d+/);
  const numMinutes = matchedMinutes ? Number(matchedMinutes[0]) : null;
  let distKm = "";
  if (plan.location && Number.isFinite(Number(plan.location.distanceMeters)) && Number(plan.location.distanceMeters) >= 0) {
    distKm = `${(plan.location.distanceMeters / 1000).toFixed(1)}km`;
  } else if (coupon && coupon.route && Number.isFinite(Number(coupon.route.distanceMeters)) && Number(coupon.route.distanceMeters) >= 0) {
    distKm = `${(coupon.route.distanceMeters / 1000).toFixed(1)}km`;
  } else {
    distKm = rawTravel || "距离待估算";
  }

  const participantNames = (Array.isArray(plan.participants) ? plan.participants : [])
    .map((participant) => String((participant && participant.name) || "").trim())
    .filter(Boolean);
  const withText = String(plan.withText || participantNames.join("、")).trim();
  const onlyFallbackSelf = participantNames.length === 1
    && ["自己", "个人", "单人", "我", "我 (我)", "-"].includes(participantNames[0])
    && withText
    && !["自己", "个人", "单人", "我", "我 (我)", "-"].includes(withText);
  const participantCount = onlyFallbackSelf ? null : (participantNames.length || 1);
  const isSingle = participantCount === 1;
  const peopleShort = participantCount
    ? `${participantCount}人${withText ? ` (${withText})` : ""}`
    : (withText ? `人数待确认 (${withText})` : "人数待确认");

  const liveRiskText = plan.liveRisk && plan.liveRisk.hasRisk
    && Array.isArray(plan.liveRisk.messages) && plan.liveRisk.messages[0]
    ? plan.liveRisk.messages[0].text
    : "";

  return {
    id: plan.id,
    couponId,
    title: plan.title,
    status: plan.status,
    statusClass: plan.statusClass,
    reservationStatus: plan.reservationStatus,
    displayDate,
    displayWeekday,
    displayTime,
    venueName,
    distKm,
    venueDisplay: `${venueName} · ${distKm}`,
    isSingle,
    peopleShort,
    commuteShort: numMinutes !== null ? `${numMinutes}分钟` : (rawTravel || "待估算"),
    needReservation: Boolean(plan.needReservation || (coupon && coupon.reservationRequired)),
    liveRisk: liveRiskText ? { hasRisk: true, messages: [{ text: liveRiskText }] } : null,
    canQuickComplete: planStore.canTransitionPlanStatus(plan.statusCode, "completed"),
  };
}

Page({
  data: {
    plans: [],
    planTotal: 0,
    activeTab: "active",
    filterType: "",
    summary: [],
    riskSummary: null,
    reminderSummary: [],
    wheelSummary: { enabled: 0, topTitles: "先添加候选" },
    weeklyCoupons: [],
  },

  onLoad() {
    this.pageHidden = false;
    this.pageUnloaded = false;
    this.reminderRequestToken = 0;
    this.reminderRequestPending = false;
    this.allPlans = [];
    this.filteredPlans = [];
    this.couponById = new Map();
    this.weeklyRecommendationByCouponId = new Map();
    this.planVisibleCount = 0;
  },

  isPageActive() {
    return !this.pageHidden && !this.pageUnloaded;
  },

  onShow() {
    if (this.pageUnloaded) return;
    this.pageHidden = false;
    const riskContext = {};
    try { riskContext.weather = weatherService.getWeather(); } catch (error) {}
    try { riskContext.userSchedule = scheduleStore.readSchedules(); } catch (error) {}
    const allPlans = planStore.getPlans(riskContext, true) || [];
    const coupons = couponStore.getAllCoupons() || [];
    const couponById = new Map(coupons.map((coupon) => [coupon.id, coupon]));
    const activeCouponIds = new Set(
      allPlans
        .filter((plan) => isActivePlanStatus(plan.statusCode))
        .map((plan) => plan.couponId)
        .filter(Boolean),
    );
    const recommendable = coupons.filter((c) => !["draft", "planned", "used", "expired"].includes(c.statusCode || c.status) && !activeCouponIds.has(c.id) && (c.days === undefined || c.days >= 0));
    const context = recommendation.buildRecommendationContext({ existingPlans: allPlans, allCoupons: coupons });
    const precomputedRecommendations = recommendation.generateRecommendations(recommendable, context);
    context.precomputedRecommendations = precomputedRecommendations;
    context.precomputedRecommendationSource = {
      coupons: recommendable,
      existingPlans: context.existingPlans,
      friends: context.friends,
      now: context.now,
      routeOrigin: context.routeOrigin,
      userPreference: context.userPreference,
      userSchedule: context.userSchedule,
      weather: context.weather,
      weeklyWeather: context.weeklyWeather,
    };
    const weeklyArrangement = recommendation.generateWeeklyArrangement(recommendable, context);
    const weeklyItems = (weeklyArrangement.items || [])
      .filter((item) => !item.isPlanned)
      .slice(0, 3);
    this.weeklyRecommendationByCouponId = new Map(
      weeklyItems
        .filter((item) => item && item.couponId && item.recommendation)
        .map((item) => [item.couponId, item.recommendation]),
    );
    const weeklyCoupons = weeklyItems
      .map((item) => ({
        couponId: item.couponId,
        planTime: item.planTime,
        title: (couponById.get(item.couponId) && couponById.get(item.couponId).title) || item.couponId,
      }));

    const today = new Date();
    const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const weekdayOffset = (weekStart.getDay() + 6) % 7;
    weekStart.setDate(weekStart.getDate() - weekdayOffset);
    const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
    const weeklyCount = allPlans.filter((item) => {
      const dateText = String((item.selectedTime && item.selectedTime.date) || item.date || "");
      const date = parseExactIsoDate(dateText);
      return Boolean(date && date >= weekStart && date < weekEnd);
    }).length;
    const pendingCount = allPlans.filter((item) => item.statusCode === "pending").length;
    const riskCount = allPlans.filter((item) => item.statusCode === "risky" || (item.liveRisk && item.liveRisk.hasRisk)).length;
    const firstRisk = allPlans.find((item) => item.statusCode === "risky" || (item.liveRisk && item.liveRisk.hasRisk));

    const reminderSummary = [];
    allPlans.filter((plan) => isActivePlanStatus(plan.statusCode)).forEach((plan) => {
      (plan.reminders || []).slice(0, 2).forEach((text, index) => {
        reminderSummary.push({ key: `${plan.id}_${index}_${text}`, planId: plan.id, title: plan.title, text });
      });
    });

    let filteredPlans = allPlans.filter((item) => {
      const status = item.statusCode || "pending";
      if (this.data.activeTab === "active") return isActivePlanStatus(status) || status === "expired";
      if (this.data.activeTab === "completed") return ["completed", "used", "completed_used"].includes(status);
      if (this.data.activeTab === "cancelled") return ["cancelled"].includes(status);
      return true;
    });

    if (this.data.activeTab === "active" && this.data.filterType) {
      if (this.data.filterType === "pending") filteredPlans = filteredPlans.filter((item) => item.statusCode === "pending");
      else if (this.data.filterType === "risky") filteredPlans = filteredPlans.filter((item) => item.statusCode === "risky" || (item.liveRisk && item.liveRisk.hasRisk));
    }

    this.allPlans = allPlans;
    this.filteredPlans = filteredPlans;
    this.couponById = couponById;
    this.planVisibleCount = Math.min(PLAN_RENDER_PAGE_SIZE, filteredPlans.length);
    const formattedPlans = filteredPlans.slice(0, this.planVisibleCount)
      .map((plan) => formatPlanItem(plan, couponById));

    this.setData({
      plans: formattedPlans,
      planTotal: filteredPlans.length,
      summary: [
        { label: "本周", value: `${weeklyCount}项` },
        { label: "待确认", value: `${pendingCount}项` },
        { label: "有风险", value: `${riskCount}项` },
      ],
      riskSummary: firstRisk ? {
        title: firstRisk.title,
        desc: (firstRisk.liveRisk && firstRisk.liveRisk.messages && firstRisk.liveRisk.messages[0]) ? firstRisk.liveRisk.messages[0].text : "有时间或天气冲突",
      } : null,
      reminderSummary: reminderSummary.slice(0, 5),
      wheelSummary: spinStore.getSummary({
        coupons,
        plans: allPlans,
        context,
        precomputedRecommendations,
      }),
      weeklyCoupons,
    });
  },

  onSummaryCardTap(e) {
    haptics.light();
    const label = e.currentTarget.dataset.label;
    if (label === "本周") {
      wx.navigateTo({ url: "/pages/weekly-calendar/index" });
    } else if (label === "待确认" || label === "有风险") {
      const filterType = label === "待确认" ? "pending" : "risky";
      this.setData({ activeTab: "active", filterType }, () => {
        if (!this.isPageActive()) return;
        this.onShow();
        wx.pageScrollTo({ selector: ".segmented-control", duration: 300 });
      });
    }
  },

  clearFilter() {
    haptics.light();
    this.setData({ filterType: "" }, () => {
      if (this.isPageActive()) this.onShow();
    });
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    haptics.light();
    this.setData({ activeTab: tab, filterType: "" }, () => {
      if (this.isPageActive()) this.onShow();
    });
  },

  goCoupons() {
    wx.switchTab({ url: "/pages/coupons/index" });
  },

  goCompletedHistory() {
    wx.navigateTo({ url: "/pages/completed-history/index" });
  },

  hasActivePlan(plans, couponId) {
    return (plans || []).some((plan) => plan.couponId === couponId && isActivePlanStatus(plan.statusCode));
  },

  goDetail(e) {
    const id = normalizeExactId(e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "");
    if (!id || !(this.allPlans || []).some((plan) => plan && plan.id === id)) return;
    wx.navigateTo({ url: `/pages/plan-detail/index?id=${encodeURIComponent(id)}` });
  },

  goFoodWheel() {
    wx.navigateTo({ url: "/pages/food-wheel/index" });
  },

  goScheduleSettings() {
    if (!this.isPageActive()) return;
    try {
      wx.setStorageSync("life_helper_profile_focus", "schedule");
    } catch (error) {
      wx.showToast({ title: "日程入口保存失败，请重试", icon: "none" });
      return;
    }
    wx.switchTab({
      url: "/pages/profile/index",
      fail: () => {
        try { wx.removeStorageSync("life_helper_profile_focus"); } catch (error) {}
        if (this.isPageActive()) {
          wx.showToast({ title: "打开我的页失败，请重试", icon: "none" });
        }
      },
    });
  },

  requestReminderAuthorization() {
    if (!this.isPageActive()) return;
    if (this.reminderRequestPending) {
      wx.showToast({ title: "正在申请提醒", icon: "none" });
      return;
    }
    const allPlans = Array.isArray(this.allPlans) ? this.allPlans : [];
    const actionablePlans = allPlans.filter((item) => isActivePlanStatus(item.statusCode));
    const plan = actionablePlans.find((item) => item.reminders && item.reminders.length) || actionablePlans[0];
    if (!plan) {
      wx.showToast({ title: "暂无可授权计划", icon: "none" });
      return;
    }
    const requestToken = ++this.reminderRequestToken;
    this.reminderRequestPending = true;
    let reminderRequest;
    try {
      reminderRequest = notificationService.requestPlanSubscriptions(plan);
    } catch (error) {
      this.reminderRequestPending = false;
      try {
        eventLogger.logEvent("plan_list_reminder_request", { planId: plan.id, success: false, code: "request_failed" });
      } catch (logError) {}
      if (this.isPageActive() && this.reminderRequestToken === requestToken) {
        wx.showToast({ title: "授权失败，请重试", icon: "none" });
      }
      return;
    }
    Promise.resolve(reminderRequest).then((result = {}) => {
      try {
        eventLogger.logEvent("plan_list_reminder_request", { planId: plan.id, success: Boolean(result.success), code: result.code || "" });
      } catch (error) {}
      if (this.reminderRequestToken === requestToken) this.reminderRequestPending = false;
      if (!this.isPageActive() || this.reminderRequestToken !== requestToken) return;
      if (result.success) {
        wx.showToast({ title: result.message || "已开启提醒", icon: result.partial ? "none" : "success" });
        return;
      }
      if (result.code === "missing_template") {
        wx.showModal({
          title: "先配置模板",
          content: "调试页已经预留订阅消息模板 ID。真实模板接入后，在那里填写即可测试授权。",
          confirmText: "去配置",
          success: (res) => {
            if (res.confirm && this.isPageActive() && this.reminderRequestToken === requestToken) {
              wx.navigateTo({ url: "/pages/debug/index" });
            }
          },
        });
        return;
      }
      wx.showToast({ title: result.message || "授权失败", icon: "none" });
    }).catch(() => {
      if (this.reminderRequestToken === requestToken) this.reminderRequestPending = false;
      if (!this.isPageActive() || this.reminderRequestToken !== requestToken) return;
      try {
        eventLogger.logEvent("plan_list_reminder_request", { planId: plan.id, success: false, code: "request_failed" });
      } catch (error) {}
      wx.showToast({ title: "授权失败，请重试", icon: "none" });
    });
  },

  addWeeklyItem(e) {
    const couponId = normalizeExactId(e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "");
    if (!couponId || !(this.data.weeklyCoupons || []).some((item) => item && item.couponId === couponId)) return;
    wx.navigateTo({ url: `/pages/plan-confirm/index?id=${encodeURIComponent(couponId)}` });
  },

  addWeeklyAll() {
    const { weeklyCoupons } = this.data;
    if (!weeklyCoupons || !weeklyCoupons.length) {
      wx.showToast({ title: "没有可新增计划", icon: "none" });
      return;
    }
    const coupons = couponStore.getAllCoupons() || [];
    const couponMap = new Map(coupons.map((coupon) => [coupon.id, coupon]));
    const existingPlans = planStore.getPlans() || [];
    const activeCouponIds = new Set(existingPlans
      .filter((plan) => plan && plan.couponId && isActivePlanStatus(plan.statusCode))
      .map((plan) => plan.couponId));

    const toAdd = weeklyCoupons.filter((item) => {
      const coupon = couponMap.get(item.couponId);
      if (!coupon) return false;
      return !activeCouponIds.has(coupon.id);
    });

    if (!toAdd.length) {
      wx.showToast({ title: "没有可新增计划", icon: "none" });
      return;
    }

    wx.showModal({
      title: "确认一键加入",
      content: `即将添加 ${toAdd.length} 个推荐安排到计划中，确定吗？`,
      success: (res) => {
        if (!this.isPageActive()) return;
        if (res.confirm) {
          const plansToCreate = [];
          const fallbackContext = recommendation.buildRecommendationContext({
            existingPlans,
            allCoupons: coupons,
          });
          for (let index = 0; index < toAdd.length; index += 1) {
            const item = toAdd[index];
            const coupon = couponMap.get(item.couponId);
            try {
              const cachedRecommendation = this.weeklyRecommendationByCouponId
                && this.weeklyRecommendationByCouponId.get(item.couponId);
              const rec = cachedRecommendation
                || recommendation.generateRecommendation(coupon, fallbackContext);
              const plan = planStore.buildPlanFromRecommendation(coupon, rec, null, {
                statusCode: coupon.people === "1人" ? "confirmed" : "pending",
                selectedTime: item.planTime,
              });
              if (!plan) throw new Error("推荐计划无法转换");
              plansToCreate.push(plan);
            } catch (error) {
              plansToCreate.length = 0;
              break;
            }
          }
          if (plansToCreate.length !== toAdd.length) {
            wx.showToast({ title: "推荐计划生成失败，请刷新后重试", icon: "none" });
            return;
          }
          let outcome = null;
          try {
            outcome = planStore.bulkUpsertPlans(plansToCreate);
          } catch (error) {}
          if (!outcome || outcome.success !== true) {
            wx.showToast({ title: "计划写入失败，请重试", icon: "none" });
            return;
          }
          try { eventLogger.logEvent("weekly_arrangement_created", { count: plansToCreate.length }); } catch (error) {}
          wx.showToast({ title: `已加入 ${plansToCreate.length} 项`, icon: "success" });
          this.onShow();
        }
      }
    });
  },

  quickCompletePlan(e) {
    const id = normalizeExactId(e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "");
    if (!id || !(this.allPlans || []).some((plan) => plan && plan.id === id)) return;
    haptics.medium();
    wx.showModal({
      title: "确认完成打卡",
      content: "确定已完成这次安排吗？将同步标记对应券为已使用。",
      confirmText: "打卡完成",
      confirmColor: "#34c759",
      success: (res) => {
        if (!this.isPageActive()) return;
        if (res.confirm) {
          const completed = planStore.completePlan(id, { usedAt: new Date().toISOString() });
          if (!completed) {
            wx.showToast({ title: "打卡保存失败，请重试", icon: "none" });
            return;
          }
          wx.showToast({ title: "已打卡完成！", icon: "success" });
          this.onShow();
        }
      }
    });
  },

  onReachBottom() {
    if (this.pageHidden || this.pageUnloaded || !Array.isArray(this.filteredPlans)) return;
    const currentCount = Number(this.planVisibleCount) || 0;
    if (currentCount >= this.filteredPlans.length) return;
    const nextCount = Math.min(currentCount + PLAN_RENDER_PAGE_SIZE, this.filteredPlans.length);
    const appendedPlans = this.filteredPlans.slice(currentCount, nextCount)
      .map((plan) => formatPlanItem(plan, this.couponById));
    const patch = {};
    appendedPlans.forEach((plan, index) => {
      patch[`plans[${currentCount + index}]`] = plan;
    });
    this.planVisibleCount = nextCount;
    this.setData(patch);
  },

  onHide() {
    this.pageHidden = true;
    this.reminderRequestToken = (this.reminderRequestToken || 0) + 1;
    this.reminderRequestPending = false;
    this.allPlans = [];
    this.filteredPlans = [];
    this.couponById = new Map();
    this.weeklyRecommendationByCouponId = new Map();
    this.planVisibleCount = 0;
    this.setData({ plans: [], planTotal: 0, weeklyCoupons: [] });
  },

  onUnload() {
    this.pageUnloaded = true;
    this.pageHidden = true;
    this.reminderRequestToken = (this.reminderRequestToken || 0) + 1;
    this.reminderRequestPending = false;
    this.allPlans = [];
    this.filteredPlans = [];
    this.couponById = new Map();
    this.weeklyRecommendationByCouponId = new Map();
    this.planVisibleCount = 0;
  },

  onShareAppMessage() {
    return {
      title: "📅 这是我近期的就餐与出行日程安排，一起来探店吧！",
      path: "/pages/plan/index",
    };
  },

  onShareTimeline() {
    return {
      title: "📅 有时好饭 · 我的生活日程安排清单",
      query: "",
    };
  },
});
