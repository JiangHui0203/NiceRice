const {
  addScheduleService,
  removeScheduleService,
} = require("../profileHelper.js");

module.exports = {
  onScheduleDraftInput(e) {
    this.setData({ scheduleDraft: String(e.detail.value || "").slice(0, 180) });
  },

  addSchedule() {
    const result = addScheduleService(this.data.scheduleDraft);
    if (!result.success) {
      wx.showToast({ title: result.error || "日程保存失败", icon: "none" });
      return;
    }
    this.applyScheduleCollection(result.schedules, { scheduleDraft: "" }, () => {
      if (!this.unloaded && !this.hidden) this.updateSummaries();
    });
  },

  removeSchedule(e) {
    const rawId = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "";
    const schedule = (Array.isArray(this.allSchedules) ? this.allSchedules : [])
      .find((item) => item && item.id === rawId);
    if (!schedule) return;
    const result = removeScheduleService(schedule.id);
    if (!result.success) {
      wx.showToast({ title: result.error || "日程删除失败", icon: "none" });
      return;
    }
    this.applyScheduleCollection(result.schedules, {}, () => {
      if (!this.unloaded && !this.hidden) this.updateSummaries();
    });
  },
};
