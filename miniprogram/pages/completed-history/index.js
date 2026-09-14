const planStore = require("../../utils/planStore.js");
const couponStore = require("../../utils/couponStore.js");
const activityLogStore = require("../../utils/activityLogStore.js");
const haptics = require("../../utils/haptics.js");
const privacyService = require("../../utils/privacyService.js");
const {
  aggregateCompletedRecords,
  calculateCompletedStats,
  calculateAchievementBadges,
  groupRecordsByMonth,
  sliceMonthGroups,
} = require("./completedHistoryHelper.js");
const { dateAfter } = require("../../utils/dateUtils.js");
const { normalizeExactId } = require("../../utils/idUtils.js");

const HISTORY_PAGE_SIZE = 40;

const PLACEHOLDER_TITLES = new Set(["品质套餐", "标题待补充", "自定义计划", "生活活动"]);
const PLACEHOLDER_VENUES = new Set([
  "精选餐厅", "待补充店名", "店铺待补充", "商家待补充", "地点待补充", "地点待定", "待定",
]);

function cleanRequiredHistoryText(value, placeholders, maxLength = 120) {
  const text = Array.from(String(value || "").trim()).slice(0, maxLength).join("");
  return text && !placeholders.has(text) ? text : "";
}

function cleanHistoryPlatform(value) {
  const text = Array.from(String(value || "").trim()).slice(0, 48).join("");
  return text && !["日程", "优惠券", "平台待补充"].includes(text) ? text : "";
}

function createEmptyHistoryStats() {
  return {
    count: 0,
    totalCost: "0.0",
    totalSaved: "0.0",
    avgDiscount: "",
    favoriteCategory: "无",
    topFriend: "无",
  };
}

Page({
  data: {
    stats: createEmptyHistoryStats(),
    badges: [],
    months: [],
    historyPage: 1,
    historyPageCount: 0,
    historyRangeStart: 0,
    historyRangeEnd: 0,
    totalRecordCount: 0,
    hasPreviousHistory: false,
    hasMoreHistory: false,
  },

  onLoad() {
    this.unloaded = false;
    this.hidden = false;
    this.navigationTimer = null;
    this.completedHistoryMonths = [];
    this.completedHistoryRecordCount = 0;
    this.lastHistoryPage = 1;
  },

  onShow() {
    if (this.unloaded) return;
    this.hidden = false;
    this.loadData();
  },

  onHide() {
    this.hidden = true;
    this.lastHistoryPage = Math.max(1, Number(this.data.historyPage) || 1);
    if (this.navigationTimer !== null && this.navigationTimer !== undefined) {
      clearTimeout(this.navigationTimer);
      this.navigationTimer = null;
    }
    this.completedHistoryMonths = [];
    this.completedHistoryRecordCount = 0;
    if (!this.unloaded) {
      try {
        this.setData({
          months: [],
          historyPage: 1,
          historyPageCount: 0,
          historyRangeStart: 0,
          historyRangeEnd: 0,
          totalRecordCount: 0,
          hasPreviousHistory: false,
          hasMoreHistory: false,
        });
      } catch (error) {
        console.warn("completed history render state release failed:", error);
      }
    }
  },

  onUnload() {
    this.unloaded = true;
    this.onHide();
  },

  loadData() {
    if (this.hidden || this.unloaded) return;
    try {
      const completedLogs = activityLogStore.getActivityLogs({ action: "completed" });
      const allPlans = planStore.getPlans();
      const allCoupons = couponStore.getAllCoupons(true);

      const combinedRecords = aggregateCompletedRecords(completedLogs, allPlans, allCoupons);
      const stats = calculateCompletedStats(combinedRecords);
      const badges = calculateAchievementBadges(stats);
      const months = groupRecordsByMonth(combinedRecords);
      this.completedHistoryMonths = months;
      this.completedHistoryRecordCount = combinedRecords.length;

      this.setData({
        stats,
        badges,
        ...this.getHistoryPagePatch(this.lastHistoryPage),
      });
      return true;
    } catch (error) {
      console.warn("completed history data load failed:", error);
      this.completedHistoryMonths = [];
      this.completedHistoryRecordCount = 0;
      if (!this.hidden && !this.unloaded) {
        try {
          this.setData({
            stats: createEmptyHistoryStats(),
            badges: [],
            ...this.getHistoryPagePatch(1),
          });
        } catch (renderError) {
          console.warn("completed history failure-state render failed:", renderError);
        }
        try {
          wx.showToast({ title: "履约记录读取失败，请重试", icon: "none" });
        } catch (toastError) {}
      }
      return false;
    }
  },

  getHistoryPagePatch(page) {
    const totalRecordCount = Math.max(0, Number(this.completedHistoryRecordCount) || 0);
    const historyPageCount = totalRecordCount
      ? Math.ceil(totalRecordCount / HISTORY_PAGE_SIZE)
      : 0;
    const historyPage = historyPageCount
      ? Math.min(historyPageCount, Math.max(1, Number(page) || 1))
      : 1;
    const offset = historyPageCount ? (historyPage - 1) * HISTORY_PAGE_SIZE : 0;
    const historyRangeEnd = Math.min(totalRecordCount, offset + HISTORY_PAGE_SIZE);
    return {
      months: sliceMonthGroups(this.completedHistoryMonths, offset, HISTORY_PAGE_SIZE),
      historyPage,
      historyPageCount,
      historyRangeStart: totalRecordCount ? offset + 1 : 0,
      historyRangeEnd,
      totalRecordCount,
      hasPreviousHistory: historyPage > 1,
      hasMoreHistory: historyPage < historyPageCount,
    };
  },

  renderHistoryPage(page) {
    if (this.hidden || this.unloaded) return;
    try {
      const patch = this.getHistoryPagePatch(page);
      this.setData(patch);
      this.lastHistoryPage = patch.historyPage;
    } catch (error) {
      console.warn("completed history page render failed:", error);
      wx.showToast({ title: "履约记录翻页失败，请重试", icon: "none" });
    }
  },

  showPreviousHistoryPage() {
    if (!this.data.hasPreviousHistory) return;
    this.renderHistoryPage((Number(this.data.historyPage) || 1) - 1);
  },

  showNextHistoryPage() {
    if (!this.data.hasMoreHistory) return;
    this.renderHistoryPage((Number(this.data.historyPage) || 1) + 1);
  },

  rePlan(e) {
    const dataset = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset
      : {};
    const monthIndex = Number(dataset.monthIndex);
    const planIndex = Number(dataset.planIndex);
    const visibleMonth = Number.isInteger(monthIndex) && Array.isArray(this.data.months)
      ? this.data.months[monthIndex]
      : null;
    const indexedRecord = visibleMonth && Array.isArray(visibleMonth.plans) && Number.isInteger(planIndex)
      ? (visibleMonth.plans[planIndex] || {})
      : {};
    // 兼容迁移前直接通过 data-record / data-title / data-venue 调用的页面与测试；
    // 新 WXML 只传索引，避免把完整历史快照重复挂到事件数据上。
    const legacyRecord = dataset.record && typeof dataset.record === "object" && !Array.isArray(dataset.record)
      ? dataset.record
      : {};
    const record = (indexedRecord.id || indexedRecord.title || indexedRecord.venue)
      ? indexedRecord
      : legacyRecord;
    if (!record.id && !record.title && !record.venue && !dataset.title && !dataset.venue) {
      wx.showToast({ title: "履约记录读取失败，请重试", icon: "none" });
      return;
    }
    const venue = cleanRequiredHistoryText(
      record.venue || dataset.venue,
      PLACEHOLDER_VENUES
    );
    const title = cleanRequiredHistoryText(
      record.title || dataset.title,
      PLACEHOLDER_TITLES
    );
    haptics.medium();

    wx.showActionSheet({
      itemList: ["✨ 复刻为新券 (+14天有效)", "📝 编辑微调后添加新券", "🎯 加入摇一摇备选"],
      success: (res) => {
        if (this.hidden || this.unloaded) return;
        if (res.tapIndex === 0) {
          if (!title || !venue) {
            wx.showModal({
              title: "无法直接复刻",
              content: `这条历史记录缺少${!title && !venue ? "优惠标题和商家" : (!title ? "优惠标题" : "商家")}，不能据此生成新券。可选择“编辑微调后添加新券”并补全信息。`,
              showCancel: false,
            });
            return;
          }
          // 核心方案：生成一张崭新的待安排券（新 ID、全新 14 天有效期，完全独立，删除不影响历史）
          const newCoupon = {
            id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title,
            venue,
            address: record.address || "",
            latitude: record.latitude !== undefined && record.latitude !== null ? record.latitude : null,
            longitude: record.longitude !== undefined && record.longitude !== null ? record.longitude : null,
            type: record.type || record.category || "类型待补充",
            category: record.category || "other",
            platform: cleanHistoryPlatform(record.platform) || "平台待补充",
            price: String(record.price || ""),
            originalPrice: String(record.originalPrice || ""),
            expireDate: dateAfter(14),
            usableTime: "时段待补充",
            people: record.people || "人数待补充",
            dishes: record.dishes || "",
            statusCode: "unplanned",
            status: "待安排",
            reservationStatus: "unknown",
            refundType: "unknown",
            note: record.date ? `从 ${record.date} 的履约记录复刻` : "从履约记录复刻",
          };

          let couponSaved = false;
          try {
            couponSaved = Boolean(couponStore.saveCoupon(newCoupon));
          } catch (error) {
            console.warn("completed history coupon recreation failed:", error);
          }
          if (!couponSaved) {
            wx.showToast({ title: "新券保存失败，请重试", icon: "none" });
            return;
          }
          wx.showToast({ title: "已复刻为新券！", icon: "success" });
          if (this.navigationTimer !== null && this.navigationTimer !== undefined) {
            clearTimeout(this.navigationTimer);
          }
          this.navigationTimer = setTimeout(() => {
            this.navigationTimer = null;
            if (!this.hidden && !this.unloaded) wx.switchTab({ url: "/pages/coupons/index" });
          }, 600);
        } else if (res.tapIndex === 1) {
          // 进入编辑页微调，预填新券数据模板
          const templateData = {
            title,
            venue,
            address: record.address || "",
            latitude: record.latitude !== undefined && record.latitude !== null ? record.latitude : "",
            longitude: record.longitude !== undefined && record.longitude !== null ? record.longitude : "",
            type: record.type || record.category || "",
            platform: cleanHistoryPlatform(record.platform),
            price: String(record.price || ""),
            originalPrice: String(record.originalPrice || ""),
            people: record.people || "",
            dishes: record.dishes || "",
          };
          let templateSaved = false;
          try {
            templateSaved = Boolean(privacyService.writeLocalData("life_helper_reorder_coupon_temp", templateData));
          } catch (error) {
            console.warn("completed history reorder template write failed:", error);
          }
          if (!templateSaved) {
            wx.showToast({ title: "复刻模板保存失败，请重试", icon: "none" });
            return;
          }
          wx.navigateTo({
            url: "/pages/coupon-edit/index?mode=reorder",
            fail: () => {
              try {
                privacyService.writeLocalData("life_helper_reorder_coupon_temp", null);
              } catch (error) {
                console.warn("completed history reorder template cleanup failed:", error);
              }
              if (!this.hidden && !this.unloaded) wx.showToast({ title: "编辑页打开失败，请重试", icon: "none" });
            },
          });
        } else if (res.tapIndex === 2) {
          if (!title && !venue) {
            wx.showToast({ title: "记录缺少候选名称", icon: "none" });
            return;
          }
          wx.navigateTo({
            url: `/pages/food-wheel/index?add=${encodeURIComponent(title || venue)}`,
            fail: () => {
              if (!this.hidden && !this.unloaded) wx.switchTab({ url: "/pages/coupons/index" });
            },
          });
        }
      },
    });
  },

  goPlanDetail(e) {
    const dataset = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset
      : {};
    const recordId = normalizeExactId(dataset.id || dataset.planId);
    const explicitCouponId = normalizeExactId(dataset.couponId);
    if (!recordId && !explicitCouponId) {
      wx.showToast({ title: "履约记录标识无效", icon: "none" });
      return;
    }
    let plan = null;
    if (recordId) {
      try {
        plan = planStore.findPlan(recordId);
      } catch (error) {
        console.warn("completed history plan lookup failed:", error);
      }
    }
    if (plan) {
      wx.navigateTo({ url: `/pages/plan-detail/index?id=${encodeURIComponent(recordId)}` });
      return;
    }
    const couponIds = [explicitCouponId];
    if (recordId && recordId.startsWith("c_")) {
      const legacyCouponId = normalizeExactId(recordId.slice(2));
      if (legacyCouponId) couponIds.push(legacyCouponId);
    }
    let coupon = null;
    for (const couponId of Array.from(new Set(couponIds.filter(Boolean)))) {
      try {
        coupon = couponStore.findCoupon(couponId);
      } catch (error) {
        console.warn("completed history coupon lookup failed:", error);
      }
      if (coupon) break;
    }
    if (coupon) {
      wx.navigateTo({ url: `/pages/coupon-detail/index?id=${encodeURIComponent(coupon.id)}` });
      return;
    }
    wx.showToast({ title: "原记录已归档，历史快照仍会保留", icon: "none" });
  },
});
