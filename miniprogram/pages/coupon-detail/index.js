const TouchDismissHelper = require("../../utils/touchDismissHelper.js");
const store = require("../../utils/couponStore.js");
const planStore = require("../../utils/planStore.js");
const routeService = require("../../utils/services/routeService.js");
const recommendation = require("../../utils/recommendation.js");
const weatherService = require("../../utils/services/weatherService.js");
const screenshotService = require("../../utils/services/screenshotService.js");
const haptics = require("../../utils/haptics.js");
const { hasCoordinates, normalizeCoordinate } = require("../../utils/locationUtils.js");
const { buildLocationView, buildDetailView, buildShareCouponSnapshot, getWeekdayText } = require("./couponDetailHelper.js");
const { parseSharedJson, stripCouponForShare } = require("../coupons/couponShareHelper.js");
const { normalizeExactId } = require("../../utils/idUtils.js");

const DETAIL_SECTIONS = new Set(["dishes", "rules", "screenshots", "recommendation", "warnings", "note", "reminders"]);

function routeText(value, maxLength) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength);
}

function readCouponRouteId(options) {
  const source = options && typeof options === "object" ? options : {};
  const provided = [source.id, source.couponId]
    .filter((value) => value !== undefined && value !== null && value !== "");
  if (!provided.length) return { value: "", invalid: false };
  const ids = provided.map((value) => normalizeExactId(value));
  if (ids.some((id) => !id) || new Set(ids).size !== 1) return { value: "", invalid: true };
  return { value: ids[0], invalid: false };
}

function readOpaqueRouteData(options) {
  const source = options && typeof options === "object" ? options : {};
  const provided = [source.couponData, source.data]
    .filter((value) => value !== undefined && value !== null && value !== "");
  if (!provided.length) return { value: "", invalid: false };
  if (provided.some((value) => typeof value !== "string" || value.length > 12 * 1024)
    || new Set(provided).size !== 1) return { value: "", invalid: true };
  return { value: provided[0], invalid: false };
}

Page({
  data: {
    coupon: null,
    recommendation: null,
    blockers: [],
    warnings: [],
    locationView: buildLocationView(),
    detailView: buildDetailView(),
    showUseDialog: false,
    useDate: "",
    useTime: "",
    useNote: "",
    isFromShare: false,
    isSavedToLocal: false,
    errorMsg: null,
    expandedSections: {
      dishes: true, rules: true, screenshots: true,
      recommendation: true, warnings: true, note: true, reminders: true,
    },
    highlightSection: "",
  },

  onLoad(options = {}) {
    this.hidden = false;
    this.unloaded = false;
    this.screenshotPreviewRequestId = 0;
    this.screenshotResolveRequestId = 0;
    this.screenshotPreviewOwner = `coupon_detail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const couponIdentity = readCouponRouteId(options);
    const couponData = readOpaqueRouteData(options);
    this.couponId = couponIdentity.value;
    this.couponData = couponData.value;
    this.invalidRouteOptions = couponIdentity.invalid || couponData.invalid;
    const targetSection = routeText(options.targetSection, 32);
    if (DETAIL_SECTIONS.has(targetSection)) this.targetSection = targetSection;
    if (this.couponData) this.setData({ isFromShare: true });
  },

  toggleSection(e) {
    const section = e.currentTarget.dataset.section;
    if (!DETAIL_SECTIONS.has(section)) return;
    haptics.light();
    this.setData({ [`expandedSections.${section}`]: !this.data.expandedSections[section] });
  },

  onShow() {
    if (this.unloaded) return;
    this.hidden = false;
    this.refreshCouponDetail();
  },

  refreshCouponDetail() {
    if (this.hidden || this.unloaded) return;
    if (this.invalidRouteOptions) {
      wx.showToast({ title: "页面参数无效，请返回后重试", icon: "none" });
      return;
    }
    try {
      let coupon = null;
      let isSaved = false;
      if (this.couponId) {
        coupon = store.findCoupon(this.couponId);
        if (coupon) isSaved = true;
      }

      if (!coupon && this.couponData) {
        const decoded = parseSharedJson(this.couponData);
        if (decoded) {
          const couponObj = stripCouponForShare(decoded.coupon || decoded);
          coupon = store.normalizeCoupon(couponObj);
          if (coupon) {
            this.couponId = coupon.id;
            isSaved = Boolean(store.findCoupon(coupon.id));
          }
        }
      }

      if (!coupon && this.couponId) {
        coupon = store.getAllCoupons(true).find((item) => item.id === this.couponId);
      }

      if (!coupon) {
        wx.showToast({ title: "未找到这张券", icon: "none" });
        this.navigationTimer = setTimeout(() => {
          this.navigationTimer = null;
          if (!this.hidden && !this.unloaded) {
            wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/coupons/index" }) });
          }
        }, 1200);
        return;
      }

      const activeOrigin = routeService.getActiveRouteOrigin();
      const existingPlans = planStore.getPlans() || [];
      const context = recommendation.buildRecommendationContext({ weather: weatherService.getWeather(), existingPlans, routeOrigin: activeOrigin });
      let rec = null;
      try {
        rec = recommendation.generateRecommendation(coupon, context);
      } catch (err) {
        rec = { score: null, level: "unknown", blockers: [], warnings: ["推荐计算暂不可用"], reasons: [] };
      }

      let mergedCoupon = coupon;
      try {
        mergedCoupon = recommendation.mergeCouponRecommendation(coupon, rec, context);
      } catch (err) {
        mergedCoupon = Object.assign({}, coupon, { score: null, recommendationScore: null });
      }

      mergedCoupon.hasWarning = mergedCoupon.recommendationLevel === "blocked" || Boolean(rec && rec.blockers && rec.blockers.length);

      this.setData({
        errorMsg: null,
        coupon: mergedCoupon,
        recommendation: rec,
        blockers: (rec && rec.blockers) || [],
        warnings: (rec && rec.warnings) || [],
        locationView: buildLocationView(mergedCoupon),
        detailView: buildDetailView(mergedCoupon, activeOrigin),
        isSavedToLocal: isSaved,
      });

      if (this.targetSection) {
        const target = this.targetSection;
        this.targetSection = null;
        this.setData({ expandedSections: Object.assign({}, this.data.expandedSections, { [target]: true }), highlightSection: target });
        this.scrollTimer = setTimeout(() => {
          this.scrollTimer = null;
          if (this.hidden || this.unloaded) return;
          wx.pageScrollTo({ selector: `#section-${target}`, duration: 350 });
          this.highlightTimer = setTimeout(() => {
            this.highlightTimer = null;
            if (!this.hidden && !this.unloaded) this.setData({ highlightSection: "" });
          }, 2200);
        }, 300);
      }

      if (mergedCoupon.screenshots && mergedCoupon.screenshots.length) {
        const requestId = (this.screenshotResolveRequestId || 0) + 1;
        this.screenshotResolveRequestId = requestId;
        screenshotService.resolveScreenshotPreviews(mergedCoupon.screenshots).then((screenshots) => {
          const canApply = !this.hidden
            && !this.unloaded
            && requestId === this.screenshotResolveRequestId
            && this.data.coupon
            && this.data.coupon.id === mergedCoupon.id;
          if (canApply) {
            screenshotService.retainScreenshotPreviews(screenshots, this.screenshotPreviewOwner);
            this.setData({ "coupon.screenshots": screenshots });
          }
        }).catch((err) => console.warn("resolveScreenshotPreviews failed:", err));
      }
    } catch (e) {
      console.error("coupon-detail onShow error:", e);
      this.setData({ errorMsg: "优惠券详情加载失败，请返回后重试" });
    }
  },

  clearLifecycleTimers() {
    ["navigationTimer", "scrollTimer", "highlightTimer", "longPressTimer"].forEach((key) => {
      if (this[key] !== null && this[key] !== undefined) clearTimeout(this[key]);
      this[key] = null;
    });
  },

  releaseScreenshotPreviews() {
    const screenshots = this.data && this.data.coupon && this.data.coupon.screenshots || [];
    return screenshotService.releaseScreenshotPreviews(screenshots, this.screenshotPreviewOwner).catch(() => false);
  },

  onHide() {
    this.hidden = true;
    this.screenshotPreviewRequestId = (this.screenshotPreviewRequestId || 0) + 1;
    this.screenshotResolveRequestId = (this.screenshotResolveRequestId || 0) + 1;
    this.clearLifecycleTimers();
    return this.releaseScreenshotPreviews();
  },

  onUnload() {
    this.unloaded = true;
    this.hidden = true;
    this.screenshotPreviewRequestId = (this.screenshotPreviewRequestId || 0) + 1;
    this.screenshotResolveRequestId = (this.screenshotResolveRequestId || 0) + 1;
    this.clearLifecycleTimers();
    return this.releaseScreenshotPreviews();
  },

  saveToMyCoupons() {
    if (!this.data.coupon) return;
    haptics.medium();
    const coupon = this.data.coupon;
    const saved = store.importCouponSnapshot(coupon) || store.saveCoupon(coupon);
    if (!saved) {
      wx.showToast({ title: "保存失败，请重试", icon: "none" });
      return;
    }
    this.setData({ isSavedToLocal: true, coupon: saved || coupon });
    wx.showToast({ title: "已存入券包！", icon: "success" });
  },

  editCoupon() {
    if (this.data.coupon) wx.navigateTo({ url: `/pages/coupon-edit/index?id=${encodeURIComponent(this.data.coupon.id)}` });
  },

  deleteCoupon() {
    if (!this.data.coupon) return;
    const id = this.data.coupon.id;
    wx.showModal({
      title: "确认删除",
      content: "确定要彻底删除这张优惠券吗？删除后将无法恢复。",
      confirmColor: "#dc2626",
      success: (res) => {
        if (this.hidden || this.unloaded) return;
        if (res.confirm) {
          if (!store.deleteCoupon(id)) {
            wx.showToast({ title: "删除失败，请重试", icon: "none" });
            return;
          }
          const screenshots = Array.isArray(this.data.coupon.screenshots)
            ? this.data.coupon.screenshots.slice()
            : [];
          const cleanupTasks = screenshots.map((screenshot) => {
            try {
              return Promise.resolve(screenshotService.deleteScreenshot(screenshot)).catch(() => false);
            } catch (error) {
              return Promise.resolve(false);
            }
          });
          Promise.all(cleanupTasks).then((results) => {
            if (this.hidden || this.unloaded) return;
            const filesCleared = results.every(Boolean);
            wx.showToast({
              title: filesCleared ? "已删除" : "券已删除，部分截图清理待重试",
              icon: filesCleared ? "success" : "none",
              duration: filesCleared ? 1000 : 1800,
            });
            this.navigationTimer = setTimeout(() => {
              this.navigationTimer = null;
              if (!this.hidden && !this.unloaded) {
                wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/coupons/index" }) });
              }
            }, filesCleared ? 1000 : 1800);
          }).catch((error) => {
            console.warn("delete coupon screenshots failed:", error);
            if (!this.hidden && !this.unloaded) {
              wx.showToast({ title: "券已删除，截图清理待重试", icon: "none" });
            }
          });
        }
      }
    });
  },

  viewLinkedPlan() {
    const coupon = this.data.coupon;
    if (!coupon) return;
    if (coupon.planId) {
      wx.navigateTo({ url: `/pages/plan-detail/index?id=${encodeURIComponent(coupon.planId)}` });
      return;
    }
    const plans = planStore.getPlans() || [];
    const linked = plans.find((p) => p.couponId === coupon.id && p.statusCode !== "cancelled");
    if (linked) {
      wx.navigateTo({ url: `/pages/plan-detail/index?id=${encodeURIComponent(linked.id)}` });
    } else {
      wx.switchTab({ url: "/pages/plan/index" });
    }
  },

  addToPlan() {
    if (!this.data.coupon) return;
    if (this.data.recommendation && this.data.recommendation.level === "blocked") {
      wx.showToast({ title: "当前不建议安排", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/plan-confirm/index?id=${encodeURIComponent(this.data.coupon.id)}` });
  },

  changeTime() {
    const coupon = this.data.coupon;
    if (!coupon) return;
    const plans = planStore.getPlans() || [];
    const linked = plans.find((plan) => (
      (coupon.planId && plan.id === coupon.planId)
      || (plan.couponId === coupon.id && plan.statusCode !== "cancelled")
    ));
    if (!linked) {
      wx.navigateTo({ url: `/pages/plan-confirm/index?id=${encodeURIComponent(coupon.id)}` });
      return;
    }
    wx.navigateTo({ url: `/pages/time-options/index?planId=${encodeURIComponent(linked.id)}&couponId=${encodeURIComponent(coupon.id)}` });
  },

  inviteFriend() {
    if (this.data.coupon) wx.navigateTo({ url: `/pages/plan-confirm/index?id=${encodeURIComponent(this.data.coupon.id)}` });
  },

  previewScreenshot(e) {
    if (this.data.coupon) {
      const requestId = (this.screenshotPreviewRequestId || 0) + 1;
      this.screenshotPreviewRequestId = requestId;
      return Promise.resolve(screenshotService.previewScreenshots(
        this.data.coupon.screenshots,
        Number(e.currentTarget.dataset.index || 0),
        {
          isActive: () => !this.hidden
            && !this.unloaded
            && requestId === this.screenshotPreviewRequestId,
        },
      )).catch(() => false);
    }
    return Promise.resolve(false);
  },


  openExtendDialog() {
    haptics.light();
    const coupon = this.data.coupon;
    if (!coupon) return;

    const now = new Date();
    const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const d7 = new Date(now.getTime() + 7 * 86400000);
    const d14 = new Date(now.getTime() + 14 * 86400000);
    const d30 = new Date(now.getTime() + 30 * 86400000);

    wx.showActionSheet({
      itemList: [
        `⏱️ 快捷延期 7 天（至 ${fmtDate(d7)}）`,
        `⏱️ 快捷延期 14 天（至 ${fmtDate(d14)}）`,
        `⏱️ 快捷延期 30 天（至 ${fmtDate(d30)}）`,
      ],
      success: (res) => {
        if (this.hidden || this.unloaded) return;
        let targetDate = "";
        if (res.tapIndex === 0) targetDate = fmtDate(d7);
        else if (res.tapIndex === 1) targetDate = fmtDate(d14);
        else if (res.tapIndex === 2) targetDate = fmtDate(d30);

        if (targetDate) {
          const updated = store.extendCouponExpiry(coupon.id, targetDate);
          if (!updated) {
            wx.showToast({ title: "延期保存失败，请重试", icon: "none" });
            return;
          }
          haptics.medium();
          wx.showToast({ title: `已延期至 ${targetDate}`, icon: "success" });
          this.refreshCouponDetail();
        }
      },
    });
  },

  markAsUsedDirectly() {
    this.directUseSubmitting = false;
    const today = new Date();
    const pad = (val) => String(val).padStart(2, "0");
    this.setData({
      showUseDialog: true,
      useDate: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
      useTime: `${pad(today.getHours())}:${pad(today.getMinutes())}`,
      useNote: "",
    });
  },

  closeUseDialog() {
    this.setData({ showUseDialog: false });
  },

  onUseDateChange(e) {
    this.setData({ useDate: e.detail.value });
  },

  onUseTimeChange(e) {
    this.setData({ useTime: e.detail.value });
  },

  onUseNoteInput(e) {
    this.setData({ useNote: e.detail.value });
  },

  submitUseDirectly() {
    if (!this.data.coupon || this.directUseSubmitting) return;
    this.directUseSubmitting = true;
    const coupon = this.data.coupon;
    const { useDate, useTime, useNote } = this.data;

    const selectedTime = {
      date: useDate,
      startTime: useTime,
      endTime: "",
      weekday: getWeekdayText(useDate),
      label: `${useDate} ${useTime}`,
    };

    const participants = [{ id: "self", name: "我", status: "confirmed" }];
    let plan = null;
    try {
      plan = planStore.createPlanFromRecommendation(Object.assign({}, coupon, {
        note: useNote.trim() || coupon.note || "",
      }), this.data.recommendation || {}, participants, {
        statusCode: "confirmed",
        selectedTime,
        linkCoupon: false,
        temporaryDirectUse: true,
      });
    } catch (error) {
      console.error("Direct-use plan creation failed:", error);
    }
    if (!plan) {
      this.directUseSubmitting = false;
      wx.showToast({ title: "记录失败，请重试", icon: "none" });
      return;
    }

    let completed = null;
    try {
      completed = planStore.completePlan(plan.id, {
        usedAt: `${useDate} ${useTime}`,
        usageNote: useNote.trim(),
      });
    } catch (error) {
      console.error("Direct-use completion failed:", error);
    }
    if (!completed) {
      try {
        if (!planStore.removeTemporaryDirectUsePlan(plan.id, coupon.id)) {
          console.warn("Temporary direct-use plan cleanup was not persisted:", plan.id);
        }
      } catch (cleanupError) {
        console.warn("Temporary direct-use plan cleanup failed:", cleanupError);
      }
      this.directUseSubmitting = false;
      wx.showToast({ title: "记录失败，请重试", icon: "none" });
      return;
    }

    wx.showToast({ title: "已记录完成", icon: "success" });
    this.setData({ showUseDialog: false }, () => {
      this.directUseSubmitting = false;
    });
    this.refreshCouponDetail();
  },

  onVenueTap() {
    if (this._justLongPressed) {
      this._justLongPressed = false;
      return;
    }
    this.openLocationMap();
  },

  onVenueLongPress() {
    this._justLongPressed = true;
    if (this.longPressTimer !== null && this.longPressTimer !== undefined) clearTimeout(this.longPressTimer);
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      this._justLongPressed = false;
    }, 450);
    this.copyAddress();
  },

  openLocationMap() {
    haptics.medium();
    const { locationView, coupon } = this.data;
    const locationLatitude = normalizeCoordinate(locationView && locationView.latitude);
    const couponLatitude = normalizeCoordinate(coupon && coupon.latitude);
    const nestedLatitude = normalizeCoordinate(coupon && coupon.location && coupon.location.latitude);
    const locationLongitude = normalizeCoordinate(locationView && locationView.longitude);
    const couponLongitude = normalizeCoordinate(coupon && coupon.longitude);
    const nestedLongitude = normalizeCoordinate(coupon && coupon.location && coupon.location.longitude);
    const latitude = locationLatitude !== null ? locationLatitude : (couponLatitude !== null ? couponLatitude : nestedLatitude);
    const longitude = locationLongitude !== null ? locationLongitude : (couponLongitude !== null ? couponLongitude : nestedLongitude);

    if (!hasCoordinates({ latitude, longitude })) {
      this.copyAddress();
      return;
    }

    const name = (locationView && locationView.name) || (coupon && (coupon.venue || coupon.merchantName)) || "商家位置";
    const address = (locationView && locationView.address) || (coupon && coupon.address) || (coupon && coupon.venue) || "";

    wx.openLocation({
      latitude,
      longitude,
      name,
      address,
      scale: 16,
      fail: () => {
        if (!this.hidden && !this.unloaded) wx.showToast({ title: "长按可复制地址", icon: "none", duration: 1500 });
      },
    });
  },

  copyAddress() {
    haptics.heavy();
    const { locationView, coupon } = this.data;
    const address = (locationView && locationView.address) || (coupon && coupon.address) || (coupon && coupon.venue) || "";
    if (!address) {
      wx.showToast({ title: "暂无详细地址", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: address,
      success: () => {
        if (!this.hidden && !this.unloaded) wx.showToast({ title: "已复制详细地址", icon: "success", duration: 1500 });
      },
      fail: () => {
        if (!this.hidden && !this.unloaded) wx.showToast({ title: "地址复制失败", icon: "none" });
      },
    });
  },


  onUseDialogTouchStart(e) {
    if (!this.useDialogDismissHelper) this.useDialogDismissHelper = new TouchDismissHelper({ thresholdY: 70 });
    const res = this.useDialogDismissHelper.onTouchStart(e);
    if (res) this.setData({ useDialogDragY: res.dragOffsetY });
  },

  onUseDialogTouchMove(e) {
    if (!this.useDialogDismissHelper) return;
    const res = this.useDialogDismissHelper.onTouchMove(e);
    if (res) this.setData({ useDialogDragY: res.dragOffsetY });
  },

  onUseDialogTouchEnd(e) {
    if (!this.useDialogDismissHelper) return;
    this.useDialogDismissHelper.onTouchEnd(e, () => {
      this.closeUseDialog();
    });
    this.setData({ useDialogDragY: 0 });
  },

  stopPropagation() {},

  saveSharedCouponToWallet() {
    if (!this.data.coupon) return;
    const coupon = Object.assign({}, this.data.coupon, {
      id: this.data.coupon.id || `coupon_share_${Date.now()}`,
      statusCode: "unplanned",
      source: "friend_share",
      importedAt: new Date().toISOString(),
    });
    const saved = store.importCouponSnapshot(coupon) || store.saveCoupon(coupon);
    if (!saved) {
      wx.showToast({ title: "保存失败，请清理存储后重试", icon: "none" });
      return;
    }
    haptics.medium();
    this.setData({ isSavedToLocal: true });
    wx.showToast({ title: "已成功存入您的券包！", icon: "success", duration: 2000 });
  },

  onShareAppMessage() {
    const coupon = this.data.coupon || {};
    const shareCoupon = buildShareCouponSnapshot(coupon);
    const priceText = shareCoupon.price ? `(¥${shareCoupon.price})` : "";
    const venueText = shareCoupon.venue ? `@${shareCoupon.venue}` : "";
    const title = `🎟️ 推荐好券：${shareCoupon.title || "优惠好券"} ${priceText} ${venueText}`.trim();
    const encodedData = encodeURIComponent(JSON.stringify({ coupon: shareCoupon }));

    return {
      title,
      path: `/pages/coupon-detail/index?couponData=${encodedData}`,
    };
  },

  onShareTimeline() {
    const coupon = this.data.coupon || {};
    const shareCoupon = buildShareCouponSnapshot(coupon);
    const priceText = shareCoupon.price ? `(¥${shareCoupon.price})` : "";
    const encodedData = encodeURIComponent(JSON.stringify({ coupon: shareCoupon }));
    return {
      title: `🎟️ 优惠推荐：${shareCoupon.title || "超值卡券"} ${priceText}`,
      query: `couponData=${encodedData}`,
    };
  },
});
