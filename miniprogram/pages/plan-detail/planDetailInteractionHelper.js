const planStore = require("../../utils/planStore.js");
const notificationService = require("../../utils/services/notificationService.js");
const {
  normalizeCoordinate,
  positiveNumber,
  firstNonEmptyText,
  firstScheduleText,
  parseTravelMinutes,
  formatDistance,
  extractStoredDistanceText,
  getPlanCleanupMinutes,
} = require("./planDetailBase.js");
const {
  getPlanId,
  recoverFailedPlanMutation,
} = require("./planDetailMutationHelper.js");

function openLocationMap(locationOrPlan, isActive = () => true) {
  const loc = (locationOrPlan && (locationOrPlan.locationView || locationOrPlan.location)) || locationOrPlan;
  const latitude = loc ? normalizeCoordinate(loc.latitude, -90, 90) : null;
  const longitude = loc ? normalizeCoordinate(loc.longitude, -180, 180) : null;
  if (!loc || latitude === null || longitude === null) {
    if (isActive()) wx.showToast({ title: "该地点暂无经纬度坐标", icon: "none" });
    return false;
  }
  try {
    wx.openLocation({
      latitude,
      longitude,
      name: loc.name || "目的地",
      address: loc.address || "",
      scale: 16,
      fail: () => {
        if (isActive()) wx.showToast({ title: "地图打开失败，请重试", icon: "none" });
      },
    });
  } catch (error) {
    if (isActive()) wx.showToast({ title: "地图打开失败，请重试", icon: "none" });
    return false;
  }
  return true;
}

function addPlanToCalendarService(plan, isActive = () => true) {
  return notificationService.addPlanToCalendar(plan).then((res) => {
    if (!isActive()) return res;
    try {
      wx.showModal({
        title: res.mode === "system_calendar" ? "已写入系统日历" : "已复制日历详情",
        content: res.message,
        showCancel: false,
      });
    } catch (error) {
      console.warn("calendar result modal failed:", error);
    }
    return res;
  });
}

function requestReminderService(plan, isActive = () => true) {
  return notificationService.requestPlanReminder(plan).then((res) => {
    if (!isActive()) return res;
    try {
      wx.showToast({
        title: res.message || (res.success ? "已开启提醒" : "提醒开启失败"),
        icon: res.success && !res.partial ? "success" : "none",
      });
    } catch (error) {
      console.warn("reminder result toast failed:", error);
    }
    return res;
  });
}

function toggleReasonSelection(reasons = [], targetLabel) {
  return (reasons || []).map((item) => (item.label === targetLabel ? Object.assign({}, item, { selected: !item.selected }) : item));
}

function submitFeedbackData(planId, { rating, feedbackReasons, comment }) {
  if (!planId) return { success: false, error: "计划不存在，无法保存反馈" };
  const normalizedRating = Number(rating);
  if (!Number.isInteger(normalizedRating) || normalizedRating < 1 || normalizedRating > 5) {
    return { success: false, error: "请选择 1 到 5 星评分" };
  }
  const selectedTags = (feedbackReasons || []).filter((r) => r.selected).map((r) => r.label);
  const feedback = {
    rating: normalizedRating,
    tags: selectedTags,
    comment: (comment || "").trim(),
    createdAt: new Date().toISOString(),
  };
  let originalPlan = null;
  let updated = null;
  try {
    originalPlan = planStore.findPlan(planId);
    updated = planStore.updateFeedback(planId, feedback);
  } catch (error) {
    const restored = recoverFailedPlanMutation(planId, originalPlan);
    return {
      success: false,
      error: restored
        ? (error && error.message || "提交评价失败")
        : "评价保存失败，且本地计划恢复失败，请重新打开",
    };
  }
  if (!updated) {
    const restored = recoverFailedPlanMutation(planId, originalPlan);
    return {
      success: false,
      error: restored ? "提交评价失败" : "评价保存失败，且本地计划恢复失败，请重新打开",
    };
  }
  return { success: true, updated };
}

function postponePlanAction(planOrId, addMinutes = 15) {
  const planId = getPlanId(planOrId);
  let plan = null;
  try {
    plan = planStore.findPlan(planId);
  } catch (error) {
    return { success: false, error: error && error.message || "计划读取失败，请重试" };
  }
  if (!plan) return { success: false, error: "计划不存在" };

  const startTimeStr = firstScheduleText(plan.selectedTime && plan.selectedTime.startTime, plan.time);
  const timeParts = startTimeStr.match(/^(\d{1,2}):(\d{2})$/);
  const minutesToAdd = Number(addMinutes);
  if (!timeParts) return { success: false, error: "计划开始时间待补充，无法直接延后" };
  if (!Number.isSafeInteger(minutesToAdd) || minutesToAdd <= 0 || minutesToAdd > 24 * 60) {
    return { success: false, error: "延后时长不合法" };
  }
  const h = Number(timeParts[1]);
  const m = Number(timeParts[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) {
    return { success: false, error: "计划开始时间不合法，请先修改时间" };
  }
  const nextMin = h * 60 + m + minutesToAdd;
  const dayOffset = Math.floor(nextMin / (24 * 60));
  const normalizedStart = ((nextMin % (24 * 60)) + (24 * 60)) % (24 * 60);
  const nh = String(Math.floor(normalizedStart / 60)).padStart(2, "0");
  const nm = String(normalizedStart % 60).padStart(2, "0");
  const newStart = `${nh}:${nm}`;

  const originalSelectedTime = plan.selectedTime || {};
  let newDate = firstScheduleText(originalSelectedTime.date, plan.date);
  let newWeekday = firstScheduleText(originalSelectedTime.weekday);
  if (dayOffset > 0) {
    const dateMatch = String(newDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (newDate && !dateMatch) {
      return { success: false, error: "计划日期不合法，请先修改时间" };
    }
    if (dateMatch) {
      const year = Number(dateMatch[1]);
      const month = Number(dateMatch[2]);
      const day = Number(dateMatch[3]);
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return { success: false, error: "计划日期不合法，请先修改时间" };
      }
      date.setDate(date.getDate() + dayOffset);
      const pad = (value) => String(value).padStart(2, "0");
      newDate = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      newWeekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
    } else {
      const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      const weekdayIndex = weekdays.indexOf(newWeekday);
      if (weekdayIndex > -1) newWeekday = weekdays[(weekdayIndex + dayOffset) % weekdays.length];
    }
  }
  let newEnd = firstScheduleText(originalSelectedTime.endTime);
  const endParts = String(newEnd).match(/^(\d{1,2}):(\d{2})$/);
  if (newEnd && !endParts) {
    return { success: false, error: "计划结束时间不合法，请先修改时间" };
  }
  if (endParts) {
    const endHour = Number(endParts[1]);
    const endMinute = Number(endParts[2]);
    if (endHour < 0 || endHour > 23 || endMinute < 0 || endMinute > 59) {
      return { success: false, error: "计划结束时间不合法，请先修改时间" };
    }
    const shiftedEnd = ((endHour * 60 + endMinute + minutesToAdd) % (24 * 60) + (24 * 60)) % (24 * 60);
    newEnd = `${String(Math.floor(shiftedEnd / 60)).padStart(2, "0")}:${String(shiftedEnd % 60).padStart(2, "0")}`;
  }

  const labelPrefix = newWeekday || newDate || (dayOffset > 0 ? "次日" : originalSelectedTime.scene) || "";
  const newSelectedTime = Object.assign({}, originalSelectedTime, {
    date: newDate,
    weekday: newWeekday,
    startTime: newStart,
    endTime: newEnd,
    label: [labelPrefix, newStart].filter(Boolean).join(" "),
  });

  let updated = null;
  let persistenceError = null;
  try {
    updated = planStore.reschedulePlan(planId, newSelectedTime);
  } catch (error) {
    persistenceError = error;
  }
  const newTimeLabel = dayOffset > 0
    ? `${newDate || newWeekday || "次日"} ${newStart}`
    : newStart;
  if (!updated) {
    const restored = recoverFailedPlanMutation(planId, plan);
    return {
      success: false,
      error: restored
        ? (persistenceError && persistenceError.message || "延后保存失败，请重试")
        : "延后保存失败，且原计划恢复失败，请重新打开",
      updated: null,
      newStart,
      newTimeLabel,
    };
  }
  return { success: true, updated, newStart, newTimeLabel };
}

module.exports = {
  openLocationMap,
  addPlanToCalendarService,
  requestReminderService,
  toggleReasonSelection,
  submitFeedbackData,
  postponePlanAction,
};
