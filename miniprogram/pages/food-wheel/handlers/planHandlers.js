const planStore = require("../../../utils/planStore.js");
const eventLogger = require("../../../utils/eventLogger.js");
const couponStore = require("../../../utils/couponStore.js");
const recommendation = require("../../../utils/recommendation.js");
const { buildSelectedTime, SLOT_CONFIGS } = require("../foodWheelPlanHelper.js");
const { normalizeExactId } = require("../../../utils/idUtils.js");

function setSubmissionState(page, submitting) {
  page.planSubmitting = submitting;
  if (!page.unloaded && !page.hidden && page.data.planSubmitting !== submitting) {
    try {
      page.setData({ planSubmitting: submitting });
    } catch (error) {
      console.warn("food wheel submission state render failed:", error);
    }
  }
}

function isPageActive(page) {
  return !page.unloaded && !page.hidden;
}

function showActiveToast(page, options) {
  if (!isPageActive(page)) return;
  try {
    wx.showToast(options);
  } catch (error) {
    console.warn("food wheel submission toast failed:", error);
  }
}

function beginPlanSubmission(page) {
  if (page.planSubmitting || page.data.planSubmitting) return null;
  const token = (page.planSubmissionToken || 0) + 1;
  page.planSubmissionToken = token;
  setSubmissionState(page, true);
  return token;
}

function releasePlanSubmission(page, token) {
  if (token !== page.planSubmissionToken) return;
  setSubmissionState(page, false);
}

function cancelPlanSubmission(page) {
  if (page.navigationTimerId !== null && page.navigationTimerId !== undefined) {
    clearTimeout(page.navigationTimerId);
  }
  page.navigationTimerId = null;
  page.planSubmissionToken = (page.planSubmissionToken || 0) + 1;
  setSubmissionState(page, false);
}

function getSubmissionKey(action, result, slotType = "") {
  const resultKey = result.couponId || result.id || `${result.source || "custom"}:${result.title || ""}`;
  return `${action}:${resultKey}:${slotType}`;
}

function getRetryNavigation(page, submissionKey) {
  const pending = page.pendingPlanNavigation;
  if (!pending) return null;
  if (pending.submissionKey === submissionKey) return pending;
  page.pendingPlanNavigation = null;
  return null;
}

function rememberPlanNavigation(page, submissionKey, url) {
  const pending = { submissionKey, url };
  page.pendingPlanNavigation = pending;
  return pending;
}

function navigateForSubmission(page, url, token, pendingNavigation = null, failureMessage = "页面打开失败，请重试") {
  if (token !== page.planSubmissionToken || page.unloaded || page.hidden) {
    releasePlanSubmission(page, token);
    return;
  }
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    releasePlanSubmission(page, token);
  };
  const clearCompletedNavigation = () => {
    if (pendingNavigation && page.pendingPlanNavigation === pendingNavigation) {
      page.pendingPlanNavigation = null;
    }
    finish();
  };
  const failNavigation = () => {
    if (isPageActive(page) && token === page.planSubmissionToken) {
      showActiveToast(page, { title: failureMessage, icon: "none" });
    }
    finish();
  };
  try {
    wx.navigateTo({ url, success: clearCompletedNavigation, fail: failNavigation, complete: finish });
  } catch (error) {
    failNavigation();
  }
}

function navigateAfterToast(page, url, delay, token, pendingNavigation, failureMessage) {
  if (page.navigationTimerId !== null && page.navigationTimerId !== undefined) {
    clearTimeout(page.navigationTimerId);
  }
  try {
    page.navigationTimerId = setTimeout(() => {
      page.navigationTimerId = null;
      navigateForSubmission(page, url, token, pendingNavigation, failureMessage);
    }, delay);
  } catch (error) {
    page.navigationTimerId = null;
    releasePlanSubmission(page, token);
    showActiveToast(page, { title: failureMessage || "页面打开失败，请重试", icon: "none" });
  }
}

function showSubmissionFailure(page, token, message = "生成计划失败，请重试") {
  releasePlanSubmission(page, token);
  showActiveToast(page, { title: message, icon: "none" });
}

module.exports = {
  cancelPlanSubmission() {
    cancelPlanSubmission(this);
  },

  addResultToPlan() {
    const result = this.data.result;
    if (!result) return;
    const submissionToken = beginPlanSubmission(this);
    if (submissionToken === null) return;
    const submissionKey = getSubmissionKey("custom", result);
    if (result.source === "coupon") {
      const couponId = normalizeExactId(result.couponId);
      let coupon = null;
      try {
        coupon = couponId ? couponStore.findCoupon(couponId) : null;
      } catch (error) {}
      if (!coupon || ["used", "expired"].includes(coupon.statusCode)) {
        releasePlanSubmission(this, submissionToken);
        showActiveToast(this, { title: "该优惠券已失效或不存在", icon: "none" });
        this.loadCandidates();
        return;
      }
      navigateForSubmission(
        this,
        `/pages/plan-confirm/index?id=${encodeURIComponent(couponId)}`,
        submissionToken,
        null,
        "计划确认页打开失败，请重试",
      );
      return;
    }
    const retryNavigation = getRetryNavigation(this, submissionKey);
    if (retryNavigation) {
      navigateForSubmission(this, retryNavigation.url, submissionToken, retryNavigation);
      return;
    }
    let plan = null;
    try {
      plan = planStore.createManualPlanFromSpin(result);
    } catch (error) {}
    if (!plan || !plan.id) {
      showSubmissionFailure(this, submissionToken);
      return;
    }
    try {
      eventLogger.logEvent("food_wheel_manual_plan_created", { planId: plan.id, title: result.title });
    } catch (error) {}
    const planUrl = `/pages/plan-detail/index?id=${encodeURIComponent(plan.id)}`;
    const pendingNavigation = rememberPlanNavigation(this, submissionKey, planUrl);
    showActiveToast(this, { title: "已生成计划", icon: "success" });
    navigateAfterToast(
      this,
      planUrl,
      450,
      submissionToken,
      pendingNavigation,
      "计划已保存，详情页打开失败",
    );
  },

  quickScheduleSlot(e) {
    const slotType = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.slot
      : "";
    const result = this.data.result;
    if (!result) return;
    if (!Object.prototype.hasOwnProperty.call(SLOT_CONFIGS, slotType)) {
      showActiveToast(this, { title: "快捷时间选项无效，请重试", icon: "none" });
      return;
    }
    const submissionToken = beginPlanSubmission(this);
    if (submissionToken === null) return;
    const submissionKey = getSubmissionKey("quick", result, slotType);
    const retryNavigation = getRetryNavigation(this, submissionKey);
    if (retryNavigation) {
      navigateForSubmission(this, retryNavigation.url, submissionToken, retryNavigation);
      return;
    }
    const selectedTime = buildSelectedTime(slotType);

    let plan = null;
    try {
      if (result.source === "coupon") {
        const couponId = normalizeExactId(result.couponId);
        const coupon = couponId ? couponStore.findCoupon(couponId) : null;
        if (coupon && !["used", "expired"].includes(coupon.statusCode)) {
          const rec = recommendation.generateRecommendation(coupon, this.getRecommendationContext());
          plan = planStore.createPlanFromRecommendation(coupon, rec, null, { selectedTime, statusCode: "confirmed" });
        }
      } else {
        plan = planStore.createManualPlanFromSpin(result, { selectedTime });
      }
    } catch (error) {}
    if (!plan || !plan.id) {
      showSubmissionFailure(
        this,
        submissionToken,
        result.source === "coupon" ? "该优惠券已失效或安排失败" : "生成计划失败，请重试",
      );
      return;
    }

    try {
      eventLogger.logEvent("food_wheel_quick_scheduled", { planId: plan.id, slotType });
    } catch (error) {}
    const planUrl = `/pages/plan-detail/index?id=${encodeURIComponent(plan.id)}`;
    const pendingNavigation = rememberPlanNavigation(this, submissionKey, planUrl);
    showActiveToast(this, { title: "已直接安排！", icon: "success" });
    navigateAfterToast(
      this,
      planUrl,
      500,
      submissionToken,
      pendingNavigation,
      "计划已保存，详情页打开失败",
    );
  },
};
