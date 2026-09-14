const couponStore = require("../../utils/couponStore.js");
const planStore = require("../../utils/planStore.js");
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

function formatPlanForView(plan = {}) {
  if (!plan) return null;
  const couponId = plan.couponId || plan.sourceId || "";
  let coupon = null;
  if (couponId) {
    try {
      coupon = couponStore.findCoupon(couponId);
    } catch (error) {
      console.warn("plan detail coupon snapshot read failed:", couponId, error);
    }
  }

  const loc = plan.location || (coupon && coupon.location) || {};
  const route = plan.route || (coupon && coupon.route) || {};
  const venueName = firstNonEmptyText(loc.name, plan.venue, coupon && coupon.venue, coupon && coupon.merchantName)
    || "地点待补充";
  const address = firstNonEmptyText(loc.address, plan.address, coupon && coupon.address) || "地址待补充";
  const latitude = normalizeCoordinate(loc.latitude, -90, 90);
  const longitude = normalizeCoordinate(loc.longitude, -180, 180);
  const mapReady = latitude !== null && longitude !== null;

  const rawTravel = String(plan.travelTime || (coupon && coupon.travelTime) || "").trim();
  const routeMinutes = positiveNumber(route.durationMinutes) || positiveNumber(loc.durationMinutes);
  const rawTravelMinutes = parseTravelMinutes(rawTravel);
  const travelMinutes = routeMinutes === null ? rawTravelMinutes : Math.round(routeMinutes);
  const travelTimeText = travelMinutes === null
    ? "待估算"
    : (rawTravelMinutes === travelMinutes ? rawTravel : `${travelMinutes}分钟`);
  const distanceText = formatDistance(loc.distanceMeters) || formatDistance(route.distanceMeters)
    || extractStoredDistanceText(route.distanceText, loc.distanceText, rawTravel);
  const rawTravelAlreadyIncludesDistance = Boolean(
    rawTravelMinutes === travelMinutes && extractStoredDistanceText(rawTravel),
  );
  const routeSummary = travelMinutes !== null && distanceText
    ? (rawTravelAlreadyIncludesDistance ? travelTimeText : `${travelTimeText} (${distanceText})`)
    : (travelMinutes !== null
      ? `${travelTimeText} · 距离待估算`
      : (distanceText ? `耗时待估算 · ${distanceText}` : "路程待估算"));

  const locationView = {
    name: venueName,
    address,
    distanceText: routeSummary,
    latitude,
    longitude,
    mapReady,
    markers: mapReady ? [{ id: 1, latitude, longitude, title: venueName, width: 28, height: 28 }] : [],
  };

  const locationText = `${venueName} · ${distanceText || "距离待估算"}`;
  const resStatus = plan.reservationStatus || (coupon && coupon.reservationStatus) || "unknown";
  const needReservation = typeof plan.needReservation === "boolean"
    ? plan.needReservation
    : (coupon && typeof coupon.reservationRequired === "boolean" && coupon.reservationStatus !== "unknown"
      ? coupon.reservationRequired
      : null);
  const reservationText = resStatus === "confirmed"
    ? "已确认预约"
    : (resStatus === "failed"
      ? "预约未成功"
      : (needReservation === true || ["required", "pending"].includes(resStatus)
        ? "需提前预约"
        : (needReservation === false || resStatus === "not_required" ? "无需预约" : "预约信息待补充")));

  const prepMin = 15;
  const goMin = travelMinutes;
  const actMin = positiveNumber(plan.durationMinutes) || positiveNumber(coupon && coupon.durationMinutes);
  const backMin = travelMinutes;
  const cleanMin = getPlanCleanupMinutes(plan);
  const bufferMin = 15;
  const totalKnown = goMin !== null && actMin !== null;
  const totalMin = totalKnown ? prepMin + goMin + actMin + backMin + cleanMin + bufferMin : null;

  const timeBlock = {
    prepTime: prepMin, goTime: goMin, actTime: actMin, backTime: backMin,
    cleanTime: cleanMin, bufferTime: bufferMin,
    totalHours: totalKnown ? (totalMin / 60).toFixed(1) : "",
    totalText: totalKnown ? `合计约 ${(totalMin / 60).toFixed(1)} 小时` : "总耗时待估算",
    goText: goMin === null ? "待估算" : `${goMin}分钟`,
    actText: actMin === null ? "待补充" : `${actMin}分钟`,
    backText: backMin === null ? "待估算" : `${backMin}分钟`,
    prepFlex: prepMin, goFlex: goMin || 15, actFlex: actMin || 30, backFlex: backMin || 15,
    cleanFlex: cleanMin || 0, bufferFlex: bufferMin,
  };

  const rec = plan.recommendationSnapshot || {};
  const storedWeather = rec.weatherView || plan.weatherView;
  const weatherPlaceholder = {
    icon: "○",
    condition: "天气",
    temperature: "待更新",
    summary: "尚无与该计划时间对应的天气快照。",
    weatherRisk: false,
    riskText: "",
    tips: ["天气数据待更新"],
  };
  const hasStoredWeather = storedWeather
    && typeof storedWeather === "object"
    && !Array.isArray(storedWeather)
    && Boolean(
      firstNonEmptyText(storedWeather.icon)
      || firstNonEmptyText(storedWeather.condition)
      || firstNonEmptyText(storedWeather.temperature)
      || firstNonEmptyText(storedWeather.summary)
      || firstNonEmptyText(storedWeather.riskText)
      || storedWeather.weatherRisk === true
      || (Array.isArray(storedWeather.tips) && storedWeather.tips.length),
    );
  const storedWeatherTips = (hasStoredWeather && Array.isArray(storedWeather.tips) ? storedWeather.tips : [])
    .slice(0, 8)
    .map((tip) => firstNonEmptyText(tip).slice(0, 80))
    .filter(Boolean);
  const weatherView = hasStoredWeather
    ? {
      icon: (firstNonEmptyText(storedWeather.icon) || weatherPlaceholder.icon).slice(0, 8),
      condition: (firstNonEmptyText(storedWeather.condition) || weatherPlaceholder.condition).slice(0, 48),
      temperature: (firstNonEmptyText(storedWeather.temperature) || weatherPlaceholder.temperature).slice(0, 24),
      summary: (firstNonEmptyText(storedWeather.summary) || weatherPlaceholder.summary).slice(0, 200),
      weatherRisk: storedWeather.weatherRisk === true,
      riskText: firstNonEmptyText(storedWeather.riskText).slice(0, 160),
      tips: storedWeatherTips.length ? storedWeatherTips : weatherPlaceholder.tips,
    }
    : weatherPlaceholder;

  const reasons = (Array.isArray(rec.reasons) ? rec.reasons.slice(0, 8) : []).filter((reason) => (
    typeof reason === "string"
      ? Boolean(reason.trim())
      : Boolean(reason && typeof reason === "object" && (reason.desc || reason.label))
  ));
  const storedReasonItems = (Array.isArray(rec.reasonItems) ? rec.reasonItems.slice(0, 8) : []).filter((reason) => (
    reason && typeof reason === "object" && (reason.desc || reason.label)
  ));
  const reasonItems = reasons.length
    ? reasons.map((r) => (typeof r === "string" ? { label: "推荐", desc: r, type: "default" } : r))
    : (storedReasonItems.length
      ? storedReasonItems
      : [{ label: "推荐", desc: "推荐依据待更新", type: "default" }]);
  const recommendationSnapshot = {
    reasonItems,
    warnings: (Array.isArray(rec.warnings) ? rec.warnings : [])
      .slice(0, 8)
      .map((item) => firstNonEmptyText(item).slice(0, 200))
      .filter(Boolean),
  };
  const storedSelectedTime = plan.selectedTime && typeof plan.selectedTime === "object" ? plan.selectedTime : {};
  const selectedDate = firstScheduleText(storedSelectedTime.date, plan.date);
  const selectedWeekday = firstScheduleText(storedSelectedTime.weekday);
  const selectedStartTime = firstScheduleText(storedSelectedTime.startTime, plan.time);
  const selectedEndTime = firstScheduleText(storedSelectedTime.endTime);
  const selectedLabel = firstNonEmptyText(storedSelectedTime.label)
    || [selectedDate, selectedWeekday].filter(Boolean).join(" ")
    || "时间待补充";
  const selectedTimeRange = selectedStartTime
    ? `${selectedStartTime}${selectedEndTime ? `-${selectedEndTime}` : ""}`
    : "时间待补充";
  const selectedDisplayParts = [selectedWeekday || selectedDate || (selectedLabel !== "时间待补充" ? selectedLabel : "")];
  if (selectedStartTime) selectedDisplayParts.push(selectedTimeRange);
  const selectedTime = Object.assign({}, storedSelectedTime, {
    date: selectedDate,
    weekday: selectedWeekday,
    startTime: selectedStartTime,
    endTime: selectedEndTime,
    label: selectedLabel,
    timeRange: selectedTimeRange,
    displayText: selectedDisplayParts.filter(Boolean).join(" ") || "时间待补充",
  });
  const scheduleSummaryParts = [selectedLabel];
  if (selectedStartTime && selectedTimeRange !== selectedLabel) scheduleSummaryParts.push(selectedTimeRange);
  const scheduleSummary = scheduleSummaryParts.filter(Boolean).join(" · ") || "时间待补充";

  const startTimeStr = String(selectedStartTime || "");
  let suggestDepartureTime = "";
  const timeParts = startTimeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (timeParts && travelMinutes !== null) {
    const h = parseInt(timeParts[1], 10);
    const m = parseInt(timeParts[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      const totalStartMin = h * 60 + m;
      const rawDepartMin = totalStartMin - travelMinutes;
      const departMin = ((rawDepartMin % (24 * 60)) + (24 * 60)) % (24 * 60);
      const departDayOffset = Math.floor(rawDepartMin / (24 * 60));
      const dh = String(Math.floor(departMin / 60)).padStart(2, "0");
      const dm = String(departMin % 60).padStart(2, "0");
      const dayPrefix = departDayOffset < 0
        ? (departDayOffset === -1 ? "前一日 " : `前${Math.abs(departDayOffset)}日 `)
        : "";
      suggestDepartureTime = `${dayPrefix}${dh}:${dm}`;
    }
  }

  const departureAdvice = suggestDepartureTime
    ? `建议 ${suggestDepartureTime} 出发（路程约 ${travelMinutes} 分钟）。`
    : (travelMinutes === null
      ? "路程尚未估算，请补充地点或路线后再计算出发时间。"
      : "计划开始时间待补充，暂无法计算出发时间。");
  const statusCode = plan.statusCode || "pending";
  const status = firstNonEmptyText(plan.status)
    || (typeof planStore.statusLabel === "function" ? planStore.statusLabel(statusCode) : statusCode);
  const statusClass = firstNonEmptyText(plan.statusClass)
    || (typeof planStore.statusClass === "function" ? planStore.statusClass(statusCode) : statusCode);

  return Object.assign({}, plan, {
    statusCode,
    status,
    statusClass,
    locationView,
    locationText,
    reservationText,
    timeBlock,
    weatherView,
    recommendationSnapshot,
    selectedTime,
    scheduleSummary,
    suggestDepartureTime,
    departureAdvice,
    travelTime: travelTimeText,
  });
}

function buildActionState(planOrStatus, actionsExpanded = false, isRecipient = false) {
  const plan = typeof planOrStatus === "object" && planOrStatus ? planOrStatus : { statusCode: planOrStatus };
  const statusCode = plan.statusCode || "pending";
  const inviteStatus = plan.inviteSnapshot && plan.inviteSnapshot.status || "";
  const needReservation = Boolean(plan.needReservation);
  const reservationStatus = plan.reservationStatus || (needReservation ? "required" : "not_required");

  let primaryAction = null;
  const secondaryActions = [];

  if (isRecipient) {
    if (statusCode === "pending") {
      primaryAction = { label: "接受邀请", action: "acceptInvite" };
      secondaryActions.push({ label: "提议改期", action: "recipientReschedule" });
      secondaryActions.push({ label: "婉拒邀请", action: "rejectInvite", danger: true });
    }
  } else {
    if (["draft", "pending", "confirmed", "rescheduled", "risky"].includes(statusCode)) {
      const awaitingInviteResponse = inviteStatus === "pending"
        && ["pending", "rescheduled", "risky"].includes(statusCode);
      if (statusCode === "draft") {
        primaryAction = { label: "选择时间并安排", action: "changeTime" };
      } else if (["rejected", "invalid"].includes(inviteStatus)) {
        primaryAction = {
          label: inviteStatus === "invalid" ? "邀请已失效，重新选时间" : "好友已婉拒，重新选时间",
          action: "changeTime",
        };
      } else if (statusCode === "pending" && inviteStatus !== "confirmed") {
        primaryAction = { label: "邀请微信好友", action: "inviteFriend", share: true };
      } else if (awaitingInviteResponse) {
        primaryAction = { label: "重新发送改期邀请", action: "inviteFriend", share: true };
      } else {
        primaryAction = { label: "✓ 打卡完成", action: "completePlan" };
      }

      if (needReservation && reservationStatus !== "confirmed") {
        secondaryActions.push({ label: "标记已预约", action: "markReserved" });
        secondaryActions.push({ label: "预约未成功", action: "reservationFailed" });
      }

      if (statusCode !== "draft") {
        secondaryActions.push({ label: "修改时间/改期", action: "changeTime" });
      }
      secondaryActions.push({ label: "同步至系统日历", action: "addToCalendar" });
      secondaryActions.push({ label: "取消计划", action: "cancelPlan", danger: true });
    } else if (statusCode === "expired" || statusCode === "cancelled") {
      primaryAction = { label: "重新安排", action: "changeTime" };
    }
  }

  return {
    canCancel: ["draft", "pending", "confirmed", "rescheduled", "risky"].includes(statusCode),
    canComplete: ["confirmed", "rescheduled", "risky"].includes(statusCode),
    canReschedule: ["draft", "pending", "confirmed", "rescheduled", "risky", "expired", "cancelled"].includes(statusCode),
    canConfirmFriend: statusCode === "pending",
    primaryAction,
    secondaryActions,
    hasActions: Boolean(primaryAction || secondaryActions.length),
    hasSecondaryActions: secondaryActions.length > 0,
    actionsExpanded: Boolean(actionsExpanded),
    expandedCancelAction: Boolean(actionsExpanded && secondaryActions.some((a) => a.action === "cancelPlan")),
  };
}

module.exports = {
  formatPlanForView,
  buildActionState,
};
