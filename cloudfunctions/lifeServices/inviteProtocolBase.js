const {
  cloud,
  https,
  db,
  INVITE_TTL_MS,
  INVITE_RECORD_ACTIVE,
  INVITE_RECORD_REVOKED,
  MAX_PROVIDER_RESPONSE_BYTES,
  MAX_OCR_TEXT_LENGTH,
  MAX_EVENT_DATA_BYTES,
  INVITE_STATUSES,
  SHAREABLE_PLAN_STATUSES,
  RESERVATION_STATUSES,
  rateLimitBuckets,
  serviceErrors,
  ACTION_DATA_FIELDS,
  ROUTE_MODES,
  normalizeRouteMode,
  createError,
  isRecord,
  mergeRecords,
  normalizeEvent,
  boundedText,
} = require("./serviceContext.js");

function dateValue(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getInviteExpiry(now = Date.now()) {
  return new Date(now + INVITE_TTL_MS);
}

function isInviteExpired(invite = {}, now = Date.now()) {
  const expiry = dateValue(invite.expiresAt);
  if (expiry) return expiry <= now;
  const legacyTimestamp = dateValue(invite.updatedAt || invite.createdAt);
  return !legacyTimestamp || legacyTimestamp + INVITE_TTL_MS <= now;
}

function isInviteRevoked(invite = {}) {
  return Boolean(invite && (
    invite.revoked === true
    || invite.recordState === INVITE_RECORD_REVOKED
  ));
}

function buildRevokedInvitePatch(invite = {}, reason = "revoked", now = new Date()) {
  const revokedAt = now instanceof Date ? now : new Date(now);
  return {
    // Keep the document itself forever as the capability tombstone. The
    // payload is compacted to fixed-size fields so an expired/revoked share ID
    // can never become insertable again without retaining private plan data.
    recordState: INVITE_RECORD_REVOKED,
    revoked: true,
    revokedReason: reason === "expired" ? "expired" : "revoked",
    revokedAt,
    planId: "",
    couponId: "",
    title: "",
    selectedTime: {},
    planSnapshot: {},
    friendName: "",
    status: "rejected",
    planUpdatedAt: "",
    responderOpenid: "",
    proposal: null,
    proposalUpdatedAt: "",
    proposedByOpenid: "",
    updatedAt: revokedAt,
    // Null keeps a database TTL index (if one is configured later) from
    // physically deleting the capability tombstone and releasing the ID.
    expiresAt: null,
  };
}

function normalizeInviteStatus(status, fallback = "pending") {
  if (status === undefined || status === null || status === "") return fallback;
  const normalized = String(status);
  if (!INVITE_STATUSES.has(normalized)) {
    throw createError("invalid_status", "邀请状态无效");
  }
  return normalized;
}

function normalizeInviteId(value, options = {}) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw createError("invalid_invite_id", "邀请 ID 无效");
  }
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!text && options.allowEmpty) return "";
  if (!text) throw createError("missing_invite", "缺少邀请 ID");
  if (text.length > 96 || !/^[A-Za-z0-9_-]{6,96}$/.test(text)) {
    throw createError("invalid_invite_id", "邀请 ID 无效");
  }
  return text;
}

function normalizeRequestedInviteId(value) {
  const inviteId = normalizeInviteId(value, { allowEmpty: true });
  if (inviteId && !/^inv_[a-z0-9]{6,16}_[a-z0-9]{24,64}$/.test(inviteId)) {
    throw createError("invalid_invite_id", "自定义邀请 ID 强度不足");
  }
  return inviteId;
}

function normalizePlanId(value) {
  if (typeof value !== "string") throw createError("invalid_plan", "计划 ID 无效");
  const text = value.trim();
  if (!text) throw createError("missing_plan", "缺少计划 ID");
  if (text.length > 96) throw createError("invalid_plan", "计划 ID 过长");
  if (/[\u0000-\u001F\u007F]/.test(text)) throw createError("invalid_plan", "计划 ID 无效");
  return text;
}

function normalizePlanUpdatedAt(value, fallback = "") {
  if (value === undefined || value === null || value === "") return fallback;
  if (value instanceof Date && !Number.isFinite(value.getTime())) {
    throw createError("invalid_plan_version", "计划版本时间无效");
  }
  const text = value instanceof Date ? value.toISOString() : boundedText(value, 40);
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/);
  if (!matched) {
    throw createError("invalid_plan_version", "计划版本时间无效");
  }
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const hour = Number(matched[4]);
  const minute = Number(matched[5]);
  const second = Number(matched[6]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  const timezoneHour = matched[8] === undefined ? 0 : Number(matched[8]);
  const timezoneMinute = matched[9] === undefined ? 0 : Number(matched[9]);
  if (year < 1000
    || calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day
    || hour > 23 || minute > 59 || second > 59
    || timezoneHour > 23 || timezoneMinute > 59) {
    throw createError("invalid_plan_version", "计划版本时间无效");
  }
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) throw createError("invalid_plan_version", "计划版本时间无效");
  return new Date(timestamp).toISOString();
}

function normalizeRecordTimestamp(value, options = {}) {
  if (value === undefined || value === null || value === "") {
    if (options.required) throw createError("invalid_record", `${options.label || "记录"}时间缺失`);
    return "";
  }
  try {
    return normalizePlanUpdatedAt(value);
  } catch (error) {
    throw createError("invalid_record", `${options.label || "记录"}时间无效`);
  }
}

function normalizeInviteDate(value) {
  const text = boundedText(value, 32);
  if (!text) return "";
  const matched = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!matched) return "";
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeInviteClock(value) {
  const text = boundedText(value, 32);
  if (!text) return "";
  const matched = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return "";
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeInviteSelectedTime(selectedTime = {}, options = {}) {
  const source = mergeRecords(selectedTime);
  const normalized = {};
  ["weekday", "scene", "label"].forEach((key) => {
    if (source[key] !== undefined && source[key] !== null) {
      const maxLength = key === "label" ? 64 : 32;
      if (options.strict && typeof source[key] !== "string" && typeof source[key] !== "number") {
        throw createError("invalid_selected_time", "计划时间描述无效");
      }
      const rawText = boundedText(source[key], maxLength + 1);
      if (options.strict && rawText.length > maxLength) {
        throw createError("invalid_selected_time", "计划时间描述过长");
      }
      normalized[key] = rawText.slice(0, maxLength);
    }
  });
  if (source.date !== undefined && source.date !== null) {
    if (options.strict && typeof source.date !== "string") {
      throw createError("invalid_selected_time", "计划日期无效");
    }
    const rawDate = boundedText(source.date, 33);
    if (options.strict && rawDate.length > 32) {
      throw createError("invalid_selected_time", "计划日期无效");
    }
    const date = normalizeInviteDate(rawDate);
    if (rawDate && !date && options.strict) {
      throw createError("invalid_selected_time", "计划日期无效");
    }
    normalized.date = date;
  }
  ["startTime", "endTime"].forEach((key) => {
    if (source[key] === undefined || source[key] === null) return;
    if (options.strict && typeof source[key] !== "string") {
      throw createError("invalid_selected_time", key === "startTime" ? "计划开始时间无效" : "计划结束时间无效");
    }
    const rawTime = boundedText(source[key], 33);
    if (options.strict && rawTime.length > 32) {
      throw createError("invalid_selected_time", key === "startTime" ? "计划开始时间无效" : "计划结束时间无效");
    }
    const time = normalizeInviteClock(rawTime);
    if (rawTime && !time && options.strict) {
      throw createError("invalid_selected_time", key === "startTime" ? "计划开始时间无效" : "计划结束时间无效");
    }
    normalized[key] = time;
  });
  return normalized;
}

function normalizePlanText(value, maxLength, label) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") {
    throw createError("invalid_plan", `${label}格式无效`);
  }
  const text = String(value).trim();
  if (text.length > maxLength) throw createError("invalid_plan", `${label}过长`);
  return text;
}

function normalizePlanTimestamp(value, label) {
  if (value === undefined || value === null || value === "") return "";
  try {
    return normalizePlanUpdatedAt(value);
  } catch (error) {
    throw createError("invalid_plan", `${label}无效`);
  }
}

function normalizeFriendName(value) {
  if (value === undefined || value === null || value === "") return "朋友";
  if (typeof value !== "string" && typeof value !== "number") {
    throw createError("invalid_invite", "好友称呼格式无效");
  }
  const text = String(value).trim();
  if (text.length > 24) throw createError("invalid_invite", "好友称呼过长");
  return text || "朋友";
}


module.exports = {
  dateValue,
  getInviteExpiry,
  isInviteExpired,
  isInviteRevoked,
  buildRevokedInvitePatch,
  normalizeInviteStatus,
  normalizeInviteId,
  normalizeRequestedInviteId,
  normalizePlanId,
  normalizePlanUpdatedAt,
  normalizeRecordTimestamp,
  normalizeInviteDate,
  normalizeInviteClock,
  normalizeInviteSelectedTime,
  normalizePlanText,
  normalizePlanTimestamp,
  normalizeFriendName,
};
