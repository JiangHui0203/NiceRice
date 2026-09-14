const {
  formatPlanForView,
  buildActionState,
  toggleReasonSelection,
  submitFeedbackData,
} = require("../planDetailHelper.js");

module.exports = {
  selectFeedbackRating(e) {
    if (this.hidden || this.unloaded) return;
    const rating = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.value);
    if (![1, 5].includes(rating)) return;
    this.setData({ feedbackRating: rating });
  },

  toggleFeedbackReason(e) {
    if (this.hidden || this.unloaded) return;
    this.setData({
      feedbackReasons: toggleReasonSelection(this.data.feedbackReasons, e.currentTarget.dataset.label),
    });
  },

  onFeedbackComment(e) {
    if (this.hidden || this.unloaded) return;
    this.setData({ feedbackComment: e.detail.value });
  },

  submitFeedback() {
    if (this.feedbackSubmitting) return;
    this.feedbackSubmitting = true;
    let result = null;
    try {
      result = submitFeedbackData(this.data.plan && this.data.plan.id, {
        rating: this.data.feedbackRating,
        feedbackReasons: this.data.feedbackReasons,
        comment: this.data.feedbackComment,
      });
    } catch (error) {
      result = { success: false, error: error && error.message || "反馈保存失败" };
    }
    this.feedbackSubmitting = false;
    if (!result.success) {
      if (!this.hidden && !this.unloaded) {
        wx.showToast({ title: result.error || "反馈保存失败", icon: "none" });
      }
      return;
    }
    if (this.hidden || this.unloaded) return;
    try {
      this.setData({
        plan: formatPlanForView(result.updated),
        feedbackVisible: false,
        actionState: buildActionState(result.updated, false, this.data.isRecipient),
      });
      wx.showToast({ title: "反馈已保存", icon: "success" });
    } catch (error) {
      console.warn("feedback result render failed:", error);
      try {
        wx.showToast({ title: "反馈已保存，请重新打开查看", icon: "none" });
      } catch (toastError) {}
    }
  },
};
