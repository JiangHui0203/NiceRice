const {
  SHAREABLE_PLAN_STATUSES,
  RESERVATION_STATUSES,
  createError,
  isRecord,
  mergeRecords,
} = require("./serviceContext.js");
const {
  normalizePlanId,
  normalizeInviteSelectedTime,
  normalizePlanText,
  normalizePlanTimestamp,
} = require("./inviteProtocolBase.js");

function normalizeInvitePlanSnapshot(snapshot = {}, fallbackPlanId = "") {
  const source = mergeRecords(snapshot);
  const id = normalizePlanId(source.id || fallbackPlanId);
  const normalized = {
    id,
    couponId: normalizePlanText(source.couponId, 96, "卡券 ID"),
    title: normalizePlanText(source.title, 64, "计划标题"),
    category: normalizePlanText(source.category, 24, "计划分类"),
    statusCode: normalizePlanText(source.statusCode, 24, "计划状态"),
    venue: normalizePlanText(source.venue, 64, "计划地点"),
    address: normalizePlanText(source.address, 160, "计划地址"),
    travelTime: normalizePlanText(source.travelTime, 32, "出行时间"),
    reservationStatus: normalizePlanText(source.reservationStatus, 24, "预约状态"),
    selectedTime: normalizeInviteSelectedTime(source.selectedTime, { strict: true }),
    updatedAt: normalizePlanTimestamp(source.updatedAt, "计划更新时间"),
    createdAt: normalizePlanTimestamp(source.createdAt, "计划创建时间"),
  };
  if (source.needReservation !== undefined && source.needReservation !== null) {
    if (typeof source.needReservation !== "boolean") {
      throw createError("invalid_plan", "预约要求格式无效");
    }
    normalized.needReservation = source.needReservation;
  }
  const durationMinutes = Number(source.durationMinutes);
  if (source.durationMinutes !== undefined && source.durationMinutes !== null && source.durationMinutes !== "") {
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080) {
      throw createError("invalid_plan", "计划时长无效");
    }
    normalized.durationMinutes = Math.round(durationMinutes);
  }
  const revision = Number(source.revision);
  if (source.revision !== undefined && source.revision !== null && source.revision !== "") {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > 1000000000) {
      throw createError("invalid_plan", "计划修订版本无效");
    }
    normalized.revision = revision;
  }
  if (source.location !== undefined && source.location !== null && !isRecord(source.location)) {
    throw createError("invalid_plan", "计划地点格式无效");
  }
  if (isRecord(source.location)) {
    const location = mergeRecords(source.location);
    normalized.location = {
      name: normalizePlanText(location.name || source.venue, 64, "地点名称"),
      address: normalizePlanText(location.address || source.address, 160, "地点地址"),
    };
  }
  return normalized;
}

function validateInvitePlanSnapshot(snapshot = {}) {
  if (!snapshot.title) throw createError("invalid_plan", "计划标题不能为空");
  if (!SHAREABLE_PLAN_STATUSES.has(snapshot.statusCode)) {
    throw createError("invalid_plan_status", "当前计划状态不能创建邀请");
  }
  validateInviteSelectedTime(snapshot.selectedTime || {});
  if (!RESERVATION_STATUSES.has(snapshot.reservationStatus)) {
    throw createError("invalid_plan", "预约状态无效");
  }
  if (snapshot.needReservation === true
    && !["required", "pending", "confirmed", "failed"].includes(snapshot.reservationStatus)) {
    throw createError("invalid_plan", "预约要求与预约状态不一致");
  }
  if (snapshot.needReservation === false
    && snapshot.reservationStatus !== "not_required") {
    throw createError("invalid_plan", "预约要求与预约状态不一致");
  }
  if (typeof snapshot.needReservation !== "boolean" && snapshot.reservationStatus !== "unknown") {
    throw createError("invalid_plan", "预约要求与预约状态不一致");
  }
  return snapshot;
}

function validateInviteSelectedTime(selectedTime = {}) {
  if (!selectedTime.date || !selectedTime.startTime) {
    throw createError("invalid_selected_time", "邀请必须包含有效日期和开始时间");
  }
  if (selectedTime.endTime && selectedTime.endTime === selectedTime.startTime) {
    throw createError("invalid_selected_time", "计划开始时间和结束时间不能相同");
  }
  if (selectedTime.weekday) {
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const parts = selectedTime.date.split("-").map(Number);
    const expected = weekdays[new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay()];
    if (!weekdays.includes(selectedTime.weekday) || selectedTime.weekday !== expected) {
      throw createError("invalid_selected_time", "计划星期与日期不一致");
    }
  }
  return selectedTime;
}


module.exports = {
  normalizeInvitePlanSnapshot,
  validateInvitePlanSnapshot,
  validateInviteSelectedTime,
};
