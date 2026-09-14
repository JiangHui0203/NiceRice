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
const { toPublicInvite } = require("./invitePublicView.js");
const {
  findInviteById,
  refreshOwnedInvite,
  revokeInviteIfUnchanged,
  insertRevokedInviteTombstone,
  getMutableInviteOrThrow,
} = require("./inviteRepository.js");
const {
  isAllowedOcrFileId,
  enforceRateLimit,
  enforceEventRateLimit,
} = require("./serviceSecurity.js");

async function createPlanInvite(event = {}) {
  const data = event.data || {};
  const wxContext = enforceEventRateLimit("createPlanInvite", 30);
  const requestedStatus = normalizeInviteStatus(data.status, "pending");
  if (requestedStatus !== "pending") {
    throw createError("invalid_status", "新邀请必须从待确认状态开始");
  }
  const now = Date.now();
  if (data.planSnapshot !== undefined && data.planSnapshot !== null && !isRecord(data.planSnapshot)) {
    throw createError("invalid_plan", "计划快照格式无效");
  }
  const rawSnapshot = mergeRecords(data.planSnapshot);
  const planId = normalizePlanId(data.planId || rawSnapshot.id);
  if (rawSnapshot.id && normalizePlanId(rawSnapshot.id) !== planId) {
    throw createError("invalid_plan", "计划快照 ID 与邀请不一致");
  }
  const selectedTime = normalizeInviteSelectedTime(
    data.selectedTime || rawSnapshot.selectedTime,
    { strict: true },
  );
  const planSnapshot = normalizeInvitePlanSnapshot(mergeRecords(rawSnapshot, {
    id: planId,
    couponId: data.couponId !== undefined ? data.couponId : rawSnapshot.couponId,
    title: data.title !== undefined ? data.title : rawSnapshot.title,
    selectedTime,
  }), planId);
  validateInvitePlanSnapshot(planSnapshot);
  const planUpdatedAt = normalizePlanUpdatedAt(data.planUpdatedAt, "");
  if (!planUpdatedAt) throw createError("invalid_plan_version", "创建邀请时缺少计划版本时间");
  const invite = {
    recordState: INVITE_RECORD_ACTIVE,
    revoked: false,
    revokedReason: "",
    revokedAt: "",
    planId,
    couponId: planSnapshot.couponId,
    title: planSnapshot.title,
    selectedTime,
    planSnapshot,
    friendName: normalizeFriendName(data.friendName),
    status: requestedStatus,
    planUpdatedAt,
    creatorOpenid: wxContext.OPENID,
    responderOpenid: "",
    createdAt: new Date(now),
    updatedAt: new Date(now),
    expiresAt: getInviteExpiry(now),
  };
  const requestedInviteId = normalizeRequestedInviteId(data.inviteId);
  let inviteId = "";
  let storedInvite = invite;
  if (requestedInviteId) {
    try {
      // A custom _id passed to add is insert-only. doc.set would allow a
      // concurrent request to overwrite an invitation it did not create.
      await db.collection("plan_invites").add({
        data: Object.assign({ _id: requestedInviteId }, invite),
      });
    } catch (error) {
      const existingInvite = await findInviteById(requestedInviteId);
      if (!existingInvite) throw error;
      if (isInviteRevoked(existingInvite)) {
        throw createError("invite_revoked", "邀请已撤销，请创建新的邀请");
      }
      if (isInviteExpired(existingInvite)) {
        try {
          await revokeInviteIfUnchanged(requestedInviteId, existingInvite, "expired");
        } catch (revokeError) {
          console.warn("expired invite revocation failed", boundedText(revokeError && revokeError.code, 64) || "unknown");
        }
        throw createError("invite_expired", "邀请已过期，请创建新的邀请");
      }
      storedInvite = await refreshOwnedInvite(
        requestedInviteId,
        invite,
        wxContext.OPENID,
        existingInvite,
      );
    }
    inviteId = requestedInviteId;
  } else {
    const record = await db.collection("plan_invites").add({ data: invite });
    inviteId = record._id;
  }
  return Object.assign(toPublicInvite(Object.assign({ _id: inviteId }, storedInvite)), {
    inviteId,
    path: `/pages/plan-detail/index?id=${encodeURIComponent(storedInvite.planId)}&inviteId=${inviteId}`,
  });
}

async function getPlanInvite(event = {}) {
  const inviteId = normalizeInviteId(event.data && event.data.inviteId);
  const wxContext = enforceEventRateLimit("getPlanInvite", 60);
  const invite = await findInviteById(inviteId);
  if (!invite || isInviteRevoked(invite)) return null;
  if (invite && isInviteExpired(invite)) {
    try {
      const revoked = await revokeInviteIfUnchanged(inviteId, invite, "expired");
      if (!revoked) {
        const latest = await findInviteById(inviteId);
        if (latest && !isInviteRevoked(latest) && !isInviteExpired(latest)) {
          return toPublicInvite(latest, wxContext.OPENID);
        }
      }
    } catch (error) {
      console.warn("expired invite revocation failed", boundedText(error && error.code, 64) || "unknown");
      const latest = await findInviteById(inviteId);
      if (latest && !isInviteRevoked(latest) && !isInviteExpired(latest)) {
        return toPublicInvite(latest, wxContext.OPENID);
      }
    }
    return null;
  }
  return toPublicInvite(invite, wxContext.OPENID);
}

module.exports = {
  createPlanInvite,
  toPublicInvite,
  getPlanInvite,
};
