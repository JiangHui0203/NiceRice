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
const {
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
  normalizeInvitePlanSnapshot,
  validateInvitePlanSnapshot,
  validateInviteSelectedTime,
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
} = require("./inviteProtocol.js");

function toPublicInvite(invite = {}, viewerOpenid = "") {
  if (isInviteRevoked(invite)) throw createError("invite_revoked", "邀请已撤销");
  const inviteId = normalizeInviteId(invite.inviteId || invite.id || invite._id);
  const rawSnapshot = isRecord(invite.planSnapshot) ? invite.planSnapshot : {};
  const planId = normalizePlanId(invite.planId || rawSnapshot.id);
  if (rawSnapshot.id && normalizePlanId(rawSnapshot.id) !== planId) {
    throw createError("invalid_record", "邀请中的计划 ID 不一致");
  }
  const planSnapshot = normalizeInvitePlanSnapshot(rawSnapshot, planId);
  validateInvitePlanSnapshot(planSnapshot);
  const selectedTime = normalizeInviteSelectedTime(
    invite.selectedTime || planSnapshot.selectedTime,
    { strict: true },
  );
  validateInviteSelectedTime(selectedTime);
  if (!sameSelectedTime(selectedTime, planSnapshot.selectedTime)) {
    throw createError("invalid_record", "邀请时间与计划快照不一致");
  }
  const topCouponId = normalizePlanText(invite.couponId, 96, "卡券 ID");
  const topTitle = normalizePlanText(invite.title, 64, "计划标题");
  if ((topCouponId && topCouponId !== planSnapshot.couponId)
    || (topTitle && topTitle !== planSnapshot.title)) {
    throw createError("invalid_record", "邀请内容与计划快照不一致");
  }
  const status = normalizeInviteStatus(invite.status, "");
  if (!status) throw createError("invalid_record", "邀请状态缺失");
  const publicInvite = {
    id: inviteId,
    inviteId,
    planId: planSnapshot.id,
    couponId: planSnapshot.couponId,
    title: planSnapshot.title,
    selectedTime,
    planSnapshot,
    friendName: normalizeFriendName(invite.friendName),
    status,
    planUpdatedAt: normalizePlanUpdatedAt(invite.planUpdatedAt, ""),
    createdAt: normalizeRecordTimestamp(invite.createdAt, { label: "邀请创建" }),
    updatedAt: normalizeRecordTimestamp(invite.updatedAt, { label: "邀请更新" }),
    expiresAt: normalizeRecordTimestamp(invite.expiresAt, { label: "邀请过期" }),
    hasResponder: Boolean(invite.responderOpenid),
    respondedByCurrentUser: Boolean(
      viewerOpenid && invite.responderOpenid && invite.responderOpenid === viewerOpenid
    ),
  };
  if (invite.proposal && typeof invite.proposal === "object") {
    publicInvite.proposal = {
      selectedTime: normalizeProposalTime(invite.proposal.selectedTime),
      createdAt: normalizeRecordTimestamp(invite.proposal.createdAt, { required: true, label: "改期提议创建" }),
    };
  } else {
    publicInvite.proposal = null;
  }
  return publicInvite;
}

module.exports = {
  toPublicInvite,
};
