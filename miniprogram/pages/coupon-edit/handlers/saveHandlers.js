const store = require("../../../utils/couponStore.js");
const screenshotService = require("../../../utils/services/screenshotService.js");
const { validateCouponForm } = require("../couponEditHelper.js");

function isAttachmentBusy(page) {
  return Boolean(
    page.screenshotMutationPending
      || (page.data && page.data.screenshotUploading)
      || (page.data && page.data.ocrRecognizing)
  );
}

module.exports = {
  doSave() {
    if (isAttachmentBusy(this)) {
      this.isSaving = false;
      wx.showToast({ title: "截图仍在处理中，请稍候", icon: "none" });
      return null;
    }
    if (!this.isSaving) this.isSaving = true;
    const wasEditing = Boolean(this.data.isEditing);
    const form = this.data.form;
    const orig = Number(form.originalPrice) || 0;
    const price = Number(form.price) || 0;
    const savedAmount = orig > price ? orig - price : 0;

    const savedCoupon = store.saveCoupon(Object.assign({}, form, {
      tags: this.data.selectedTags,
      ruleNotes: form.ruleNotes || "",
      note: form.note || "",
      storeLimit: form.storeLimit || "",
      refundType: form.refundType,
      lossAmount: form.lossAmount,
      reservationLeadTimeHours: form.reservationLeadTimeHours,
      durationMinutes: form.durationMinutes,
      screenshots: screenshotService.serializeScreenshots(form.screenshots),
      statusCode: form.statusCode || "pending",
    }));
    if (!savedCoupon || !savedCoupon.id) {
      this.isSaving = false;
      wx.showToast({ title: "保存失败，请重试", icon: "none" });
      return null;
    }
    // Persist the generated id back into the draft. If a following modal or
    // navigation fails, a retry updates this coupon instead of creating a
    // duplicate record from an empty id.
    this.setData({ "form.id": savedCoupon.id, isEditing: true });
    if (typeof this.commitScreenshotEdits === "function") this.commitScreenshotEdits();

    const expireDate = savedCoupon.expireDate || "";
    let suggestDateText = "";
    const expireTimestamp = store.getExactDateTimestamp(expireDate);
    if (expireTimestamp !== null) {
      const d = new Date(expireTimestamp);
      suggestDateText = `${d.getMonth() + 1}月${d.getDate()}日`;
    }

    const titleText = wasEditing ? "优惠券已更新" : "🎉 优惠券录入成功";
    const promptMsg = suggestDateText
      ? `已保存【${form.venue || form.title}】。\n建议在 ${suggestDateText} 前安排，${savedAmount > 0 ? `预计能省 ¥${savedAmount} 元。` : "避免临期遗忘。"}`
      : `已保存【${form.venue || form.title}】。${savedAmount > 0 ? `预计能省 ¥${savedAmount} 元。` : ""}`;

    wx.showModal({
      title: titleText,
      content: promptMsg,
      confirmText: "立即去安排",
      cancelText: "稍后安排",
      confirmColor: "#0f766e",
      success: (res) => {
        if (this.hidden || this.unloaded) {
          this.isSaving = false;
          return;
        }
        if (res.confirm && savedCoupon && savedCoupon.id) {
          wx.redirectTo({
            url: `/pages/plan-confirm/index?id=${encodeURIComponent(savedCoupon.id)}`,
            fail: () => {
              this.isSaving = false;
              if (!this.hidden && !this.unloaded) wx.showToast({ title: "安排页面打开失败，优惠券已保存", icon: "none" });
            },
          });
        } else {
          wx.navigateBack({
            fail: () => wx.switchTab({
              url: "/pages/coupons/index",
              fail: () => {
                this.isSaving = false;
                if (!this.hidden && !this.unloaded) wx.showToast({ title: "返回失败，优惠券已保存", icon: "none" });
              },
            }),
          });
        }
      },
      fail: () => {
        this.isSaving = false;
      },
    });
    return savedCoupon;
  },

  save() {
    if (this.isSaving) return;
    if (isAttachmentBusy(this)) {
      wx.showToast({ title: "截图仍在处理中，请稍候", icon: "none" });
      return;
    }
    this.isSaving = true;
    const validation = validateCouponForm(this.data.form);
    if (!validation.isValid) {
      this.isSaving = false;
      wx.showToast({ title: validation.errorTitle, icon: "none" });
      return;
    }
    if (validation.isPastDate) {
      wx.showModal({
        title: "过期提醒",
        content: "该券的到期日期已过，确定要保存吗？",
        confirmColor: "#dc2626",
        success: (res) => {
          if (this.hidden || this.unloaded) {
            this.isSaving = false;
            return;
          }
          if (res.confirm) this.doSave();
          else this.isSaving = false;
        },
        fail: () => { this.isSaving = false; },
      });
      return;
    }
    this.doSave();
  },
};
