const {
  planStore,
  beginPlanAction,
  finishPlanAction,
  showActiveToast,
  syncPlanInviteUpdate,
  postponePlanAction,
  markReservationConfirmedAction,
  markReservationFailedAction,
  openLocationMap,
  addPlanToCalendarService,
  requestReminderService,
  buildActionState,
} = require("./actionSupport.js");

module.exports = {
  toggleSecondaryActions() {
    const current = this.data.actionState ? this.data.actionState.actionsExpanded : false;
    this.setData({
      actionState: buildActionState(this.data.plan, !current, this.data.isRecipient),
    });
  },

  toggleActions() {
    this.toggleSecondaryActions();
  },

  handleActionTap(e) {
    const action = e.currentTarget.dataset.action;
    if (!action) return;
    const map = {
      completePlan: () => this.completePlan(),
      cancelPlan: () => this.cancelPlan(),
      confirmFriend: () => this.confirmFriend(),
      rejectFriend: () => this.rejectFriend(),
      acceptInvite: () => this.acceptInvite(),
      rejectInvite: () => this.rejectInvite(),
      changeTime: () => this.changeTime(),
      reschedulePlan: () => this.changeTime(),
      postponePlan: (event) => this.postponePlan(event),
      markReserved: () => this.markReserved(),
      reservationFailed: () => this.reservationFailed(),
      addToCalendar: () => this.addToCalendar(),
      requestReminder: () => this.requestReminder(),
      recipientReschedule: () => this.recipientReschedule(),
    };
    return map[action] ? map[action](e) : undefined;
  },

  postponePlan(e) {
    if (!this.data.plan || !beginPlanAction(this, "postpone")) return;
    const minutes = Number((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.minutes) || 15);
    let originalPlan = this.data.plan;
    let result = null;
    try {
      originalPlan = planStore.findPlan(this.data.plan.id) || this.data.plan;
      result = postponePlanAction(this.data.plan, minutes);
    } catch (error) {
      result = { success: false, error: error && error.message || "延后保存失败" };
    }
    if (!result.success) {
      finishPlanAction(this, "postpone");
      showActiveToast(this, { title: result.error || "延后失败", icon: "none" });
      return;
    }
    return syncPlanInviteUpdate(this, "postpone", originalPlan, result.updated, `已延后至 ${result.newTimeLabel || result.newStart}`);
  },

  reschedulePlan() {
    this.changeTime();
  },

  changeTime() {
    if (!this.data.plan) return;
    try {
      wx.navigateTo({
        url: `/pages/time-options/index?planId=${encodeURIComponent(this.data.plan.id)}&id=${encodeURIComponent(this.data.plan.couponId || "")}`,
        fail: () => {
          showActiveToast(this, { title: "改期页面打开失败，请重试", icon: "none" });
        },
      });
    } catch (error) {
      showActiveToast(this, { title: "改期页面打开失败，请重试", icon: "none" });
    }
  },

  requestReminder() {
    if (!this.data.plan || this.reminderRequestPending) return;
    this.reminderRequestPending = true;
    return Promise.resolve().then(() => requestReminderService(
      this.data.plan,
      () => !this.hidden && !this.unloaded,
    )).catch((error) => {
      showActiveToast(this, { title: (error && error.message) || "提醒开启失败", icon: "none" });
      return { success: false, error };
    }).then((result) => {
      this.reminderRequestPending = false;
      return result;
    });
  },

  addToCalendar() {
    if (!this.data.plan || this.calendarRequestPending) return;
    this.calendarRequestPending = true;
    return Promise.resolve().then(() => addPlanToCalendarService(
      this.data.plan,
      () => !this.hidden && !this.unloaded,
    )).catch((error) => {
      showActiveToast(this, { title: (error && error.message) || "加入日历失败", icon: "none" });
      return { success: false, error };
    }).then((result) => {
      this.calendarRequestPending = false;
      return result;
    });
  },

  markReserved() {
    if (!this.data.plan || !beginPlanAction(this, "reservation")) return;
    let originalPlan = this.data.plan;
    let result = null;
    try {
      originalPlan = planStore.findPlan(this.data.plan.id) || this.data.plan;
      result = markReservationConfirmedAction(this.data.plan);
    } catch (error) {
      result = { success: false, error: error && error.message || "预约状态保存失败" };
    }
    if (!result.success) {
      finishPlanAction(this, "reservation");
      showActiveToast(this, { title: result.error || "预约状态保存失败", icon: "none" });
      return;
    }
    return syncPlanInviteUpdate(this, "reservation", originalPlan, result.updated, "已标记预约");
  },

  reservationFailed() {
    if (!this.data.plan || !beginPlanAction(this, "reservation")) return;
    let originalPlan = this.data.plan;
    let result = null;
    try {
      originalPlan = planStore.findPlan(this.data.plan.id) || this.data.plan;
      result = markReservationFailedAction(this.data.plan);
    } catch (error) {
      result = { success: false, error: error && error.message || "预约状态保存失败" };
    }
    if (!result.success) {
      finishPlanAction(this, "reservation");
      showActiveToast(this, { title: result.error || "预约状态保存失败", icon: "none" });
      return;
    }
    return syncPlanInviteUpdate(this, "reservation", originalPlan, result.updated, "已记录预约失败");
  },

  openMapNavigation() {
    openLocationMap(this.data.plan, () => !this.hidden && !this.unloaded);
  },
};
