const mock = require("../../utils/mock.js");
const store = require("../../utils/couponStore.js");
const screenshotService = require("../../utils/services/screenshotService.js");
const privacyService = require("../../utils/privacyService.js");
const {
  buildLifeTags,
  findIndex,
  calculateDiscount,
  dateAfter,
  buildInitialCouponForm,
  buildSampleCouponForm,
  parseDishesList,
  DISH_PRESET_PILLS,
  RULE_PRESET_PILLS,
} = require("./couponEditHelper.js");
const formHandlers = require("./handlers/formHandlers.js");
const mediaLocationHandlers = require("./handlers/mediaLocationHandlers.js");
const saveHandlers = require("./handlers/saveHandlers.js");
const { normalizeExactId } = require("../../utils/idUtils.js");

const pageConfig = {
  data: {
    typeOptions: mock.typeOptions,
    platformOptions: mock.platformOptions,
    reservationOptions: mock.reservationOptions,
    refundOptions: ["过期自动退 (默认)", "随时手动退", "不可退款", "部分退款"],
    peopleOptions: ["1人", "2人", "3-4人", "多人"],
    typeIndex: 0,
    platformIndex: 0,
    reservationIndex: 0,
    refundIndex: 0,
    peopleIndex: 1,
    defaultTags: mock.typeDefaults["火锅"].tags,
    selectedTags: mock.typeDefaults["火锅"].tags,
    lifeTagOptions: buildLifeTags(mock.typeDefaults["火锅"].tags),
    customTag: "",
    pasteInputText: "",
    locationSummary: "还没有选择位置",
    locationBadge: "待选择",
    routeEstimating: false,
    routeOrigin: {},
    ocrRecognizing: false,
    screenshotUploading: false,
    isEditing: false,
    pageTitle: "添加新券",
    form: buildInitialCouponForm(),
    discountInfo: null,
    parsedDishes: [],
    dishPresetPills: DISH_PRESET_PILLS,
    rulePresetPills: RULE_PRESET_PILLS,
  },

  onLoad(options = {}) {
    this.hidden = false;
    this.unloaded = false;
    this.screenshotPreviewRequestId = 0;
    this.screenshotDirectPreviewRequestId = 0;
    this.screenshotPreviewOwner = `coupon_edit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.originalScreenshotIds = new Set();
    this.sessionAddedScreenshots = Object.create(null);
    this.pendingDeletedScreenshots = Object.create(null);
    this.couponSaveCommitted = false;
    this.isSaving = false;
    if (options.mode === "reorder") {
      let template = {};
      try {
        const storedTemplate = privacyService.readLocalData("life_helper_reorder_coupon_temp", null);
        template = storedTemplate && typeof storedTemplate === "object" && !Array.isArray(storedTemplate)
          ? storedTemplate
          : {};
      } catch (error) {
        wx.showToast({ title: "复刻模板读取失败，请重新操作", icon: "none" });
      }
      if (!privacyService.removeLocalData("life_helper_reorder_coupon_temp")) {
        wx.showToast({ title: "复刻模板清理失败，请稍后重试", icon: "none" });
      }

      const type = template.type || "其他";
      const platform = String(template.platform || "").trim() || "平台待补充";
      const people = String(template.people || "").trim() || "人数待补充";
      const usableTime = String(template.usableTime || "").trim() || "时段待补充";
      const typeIndex = findIndex(mock.typeOptions, type, 0);
      const platformIndex = findIndex(mock.platformOptions, platform, 0);
      const peopleIndex = findIndex(this.data.peopleOptions, people, 0);
      const defaults = mock.typeDefaults[type] || mock.typeDefaults["其他"];
      const selectedTags = defaults.tags || [];
      const reservationStatus = ["unknown", "not_required", "required", "pending", "confirmed", "failed"]
        .includes(template.reservationStatus)
        ? template.reservationStatus
        : (template.reservationRequired === true ? "required" : "not_required");

      const form = Object.assign(buildInitialCouponForm(), template, {
        id: "",
        platform,
        people,
        usableTime,
        expireDate: dateAfter(14),
        statusCode: "unplanned",
        status: "待安排",
        reservationStatus,
        reservationRequired: ["required", "pending", "confirmed", "failed"].includes(reservationStatus),
      });

      this.setData({
        isEditing: false,
        pageTitle: "再买一张 / 添加新券",
        pageSubtitle: "已为你自动填入上次的店铺与套餐信息，可直接保存或微调。",
        typeIndex,
        platformIndex,
        peopleIndex,
        reservationIndex: form.reservationStatus === "unknown" ? 2 : (form.reservationRequired ? 1 : 0),
        refundIndex: form.refundType === "non_refundable" ? 2 : form.refundType === "manual" ? 1 : form.refundType === "partial" ? 3 : 0,
        defaultTags: defaults.tags,
        selectedTags,
        lifeTagOptions: buildLifeTags(selectedTags),
        form,
        discountInfo: calculateDiscount(form.price, form.originalPrice),
        parsedDishes: parseDishesList(form.dishes),
      }, () => {
        this.refreshLocationSummary(form);
      });
      return;
    }

    const couponId = normalizeExactId(options.id);
    if (!couponId) return;
    const coupon = store.findCoupon(couponId);
    if (!coupon) {
      this.missingCoupon = true;
      wx.showToast({ title: "未找到这张券", icon: "none" });
      this.scheduleMissingCouponReturn();
      return;
    }
    this.missingCoupon = false;
    const type = coupon.type || "其他";
    const platform = coupon.platform || "平台待补充";
    const people = coupon.people || "人数待补充";
    const typeIndex = findIndex(mock.typeOptions, type, 0);
    const platformIndex = findIndex(mock.platformOptions, platform, 0);
    const peopleIndex = findIndex(this.data.peopleOptions, people, 0);
    const reservationIndex = coupon.reservationStatus === "unknown" ? 2 : (coupon.reservationRequired ? 1 : 0);
    const refundIndex = coupon.refundType === "non_refundable" ? 2 : coupon.refundType === "manual" ? 1 : coupon.refundType === "partial" ? 3 : 0;
    const selectedTags = coupon.tags && coupon.tags.length
      ? coupon.tags
      : (mock.typeDefaults[type] || mock.typeDefaults["其他"]).tags;

    const form = Object.assign({}, coupon, {
      ruleNotes: coupon.ruleNotes || (coupon.usageRules && coupon.usageRules.notes) || "",
      storeLimit: coupon.storeLimit || (coupon.usageRules && coupon.usageRules.storeLimit) || "",
      note: coupon.note || "",
      reservationLeadTimeHours: coupon.reservationLeadTimeHours ? String(coupon.reservationLeadTimeHours) : "0",
      lossAmount: coupon.lossAmount ? String(coupon.lossAmount) : (coupon.price ? String(coupon.price) : ""),
      durationMinutes: coupon.durationMinutes ? String(coupon.durationMinutes) : "90",
      screenshots: screenshotService.normalizeScreenshots(coupon.screenshots),
    });
    this.originalScreenshotIds = new Set(form.screenshots.map((item) => item && item.id).filter(Boolean));

    this.setData({
      isEditing: true,
      pageTitle: "编辑优惠券",
      pageSubtitle: "修改关键信息、菜品明细与使用规则。",
      typeIndex,
      platformIndex,
      peopleIndex,
      reservationIndex,
      refundIndex,
      defaultTags: (mock.typeDefaults[type] || mock.typeDefaults["其他"]).tags,
      selectedTags,
      lifeTagOptions: buildLifeTags(selectedTags),
      form,
      discountInfo: calculateDiscount(form.price, form.originalPrice),
      parsedDishes: parseDishesList(form.dishes),
    }, () => {
      this.refreshLocationSummary(form);
      this.refreshScreenshotPreviews();
    });
  },

  fillSample() {
    const sample = buildSampleCouponForm();
    const form = Object.assign({}, sample.form, {
      // Filling the text fields is not an attachment reset. Keep screenshots
      // already chosen/OCR-imported in the current editing session.
      screenshots: (this.data.form.screenshots || []).slice(),
    });
    this.setData({
      typeIndex: 1,
      platformIndex: 1,
      reservationIndex: 1,
      peopleIndex: 1,
      defaultTags: sample.defaultTags,
      selectedTags: sample.selectedTags,
      lifeTagOptions: sample.lifeTagOptions,
      form,
      discountInfo: calculateDiscount(form.price, form.originalPrice),
      parsedDishes: parseDishesList(form.dishes),
    }, () => {
      this.refreshLocationSummary(form);
    });
    wx.showToast({ title: "已填入示例", icon: "success" });
  },

  scheduleMissingCouponReturn() {
    if (!this.missingCoupon || this.hidden || this.unloaded) return;
    if (this.missingCouponTimer !== null && this.missingCouponTimer !== undefined) {
      clearTimeout(this.missingCouponTimer);
    }
    try {
      this.missingCouponTimer = setTimeout(() => {
        this.missingCouponTimer = null;
        if (this.hidden || this.unloaded || !this.missingCoupon) return;
        wx.navigateBack({
          fail: () => {
            if (!this.hidden && !this.unloaded) {
              wx.showToast({ title: "返回失败，请手动返回券包", icon: "none" });
            }
          },
        });
      }, 1500);
    } catch (error) {
      this.missingCouponTimer = null;
      if (!this.hidden && !this.unloaded) {
        wx.showToast({ title: "返回失败，请手动返回券包", icon: "none" });
      }
    }
  },
};

Object.assign(pageConfig, formHandlers, mediaLocationHandlers, saveHandlers);

Page(pageConfig);
