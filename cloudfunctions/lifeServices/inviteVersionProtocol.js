const {
  db,
  INVITE_TTL_MS,
  INVITE_RECORD_ACTIVE,
  INVITE_RECORD_REVOKED,
  createError,
} = require("./serviceContext.js");
const {
  dateValue,
  getInviteExpiry,
  normalizeInviteStatus,
  normalizeInviteSelectedTime,
} = require("./inviteProtocolBase.js");
const { validateInviteSelectedTime } = require("./inviteSnapshotProtocol.js");

function comparePlanUpdatedAt(left, right) {
  const leftText = left instanceof Date ? left.toISOString() : String(left || "");
  const rightText = right instanceof Date ? right.toISOString() : String(right || "");
  if (leftText === rightText) return 0;
  const leftTimestamp = dateValue(left);
  const rightTimestamp = dateValue(right);
  if (leftTimestamp && rightTimestamp) {
    if (leftTimestamp === rightTimestamp) return 0;
    return leftTimestamp > rightTimestamp ? 1 : -1;
  }
  if (leftTimestamp) return 1;
  if (rightTimestamp) return -1;
  return leftText > rightText ? 1 : -1;
}

function getUpdatedCount(result = {}) {
  const count = result && result.stats && result.stats.updated;
  if (Number.isFinite(Number(count))) return Number(count);
  return Number.isFinite(Number(result.updated)) ? Number(result.updated) : 0;
}

function addPlanVersionCondition(condition, invite = {}) {
  if (Object.prototype.hasOwnProperty.call(invite, "planUpdatedAt")) {
    condition.planUpdatedAt = invite.planUpdatedAt;
  } else {
    condition.planUpdatedAt = db.command.exists(false);
  }
  return condition;
}

function addActiveInviteCondition(condition) {
  condition.revoked = db.command.neq(true);
  condition.recordState = db.command.neq(INVITE_RECORD_REVOKED);
  return condition;
}

function addUnexpiredInviteCondition(condition, invite = {}, now = new Date()) {
  if (invite.expiresAt instanceof Date) {
    condition.expiresAt = db.command.gt(now);
    return condition;
  }
  const legacyField = invite.updatedAt instanceof Date
    ? "updatedAt"
    : (invite.createdAt instanceof Date ? "createdAt" : "");
  if (legacyField) {
    condition[legacyField] = db.command.gt(new Date(now.getTime() - INVITE_TTL_MS));
  }
  return condition;
}

function buildInviteRefreshPatch(invite = {}) {
  return {
    recordState: INVITE_RECORD_ACTIVE,
    revoked: false,
    revokedReason: "",
    revokedAt: "",
    couponId: invite.couponId || "",
    title: invite.title || "",
    selectedTime: invite.selectedTime || {},
    planSnapshot: invite.planSnapshot || {},
    friendName: invite.friendName || "朋友",
    status: normalizeInviteStatus(invite.status, "pending"),
    planUpdatedAt: invite.planUpdatedAt,
    responderOpenid: "",
    proposal: null,
    proposalUpdatedAt: "",
    proposedByOpenid: "",
    updatedAt: invite.updatedAt || new Date(),
    expiresAt: invite.expiresAt || getInviteExpiry(),
  };
}

function normalizeProposalTime(selectedTime = {}) {
  let normalized;
  try {
    normalized = normalizeInviteSelectedTime(selectedTime, { strict: true });
  } catch (error) {
    throw createError("invalid_proposal", "改期日期或时间无效");
  }
  try {
    validateInviteSelectedTime(normalized);
  } catch (error) {
    throw createError("invalid_proposal", "改期日期或时间无效");
  }
  return normalized;
}

function buildInviteContentFingerprint(invite = {}) {
  const snapshot = invite.planSnapshot && typeof invite.planSnapshot === "object"
    ? invite.planSnapshot
    : {};
  return {
    planId: invite.planId || snapshot.id || "",
    couponId: invite.couponId || snapshot.couponId || "",
    title: invite.title || snapshot.title || "",
    category: snapshot.category || "",
    venue: snapshot.venue || "",
    address: snapshot.address || "",
    travelTime: snapshot.travelTime || "",
    durationMinutes: snapshot.durationMinutes || "",
    needReservation: typeof snapshot.needReservation === "boolean" ? snapshot.needReservation : null,
    reservationStatus: snapshot.reservationStatus || "",
    selectedTime: invite.selectedTime || snapshot.selectedTime || {},
    location: snapshot.location || {},
  };
}

function sameJson(left, right) {
  try {
    return JSON.stringify(left || {}) === JSON.stringify(right || {});
  } catch (error) {
    return false;
  }
}

function sameSelectedTime(left = {}, right = {}) {
  return ["weekday", "scene", "label", "date", "startTime", "endTime"]
    .every((key) => String(left[key] || "") === String(right[key] || ""));
}

function sameInviteRevisionContent(left = {}, right = {}) {
  return left.friendName === right.friendName
    && sameJson(left.selectedTime, right.selectedTime)
    && sameJson(left.planSnapshot, right.planSnapshot)
    && left.couponId === right.couponId
    && left.title === right.title;
}


module.exports = {
  comparePlanUpdatedAt,
  getUpdatedCount,
  addPlanVersionCondition,
  addActiveInviteCondition,
  addUnexpiredInviteCondition,
  buildInviteRefreshPatch,
  normalizeProposalTime,
  buildInviteContentFingerprint,
  sameJson,
  sameSelectedTime,
  sameInviteRevisionContent,
};
