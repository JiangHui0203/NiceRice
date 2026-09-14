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

async function findInviteById(inviteId) {
  const result = await db.collection("plan_invites").where({ _id: inviteId }).limit(1).get();
  return result && result.data && result.data[0] || null;
}

async function refreshOwnedInvite(inviteId, incoming, openid, initialInvite = null) {
  let current = initialInvite;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!current) current = await findInviteById(inviteId);
    if (!current) throw createError("not_found", "邀请不存在");
    if (isInviteRevoked(current)) throw createError("invite_revoked", "邀请已撤销");
    if (isInviteExpired(current)) {
      try {
        await revokeInviteIfUnchanged(inviteId, current, "expired");
      } catch (error) {
        console.warn("expired invite revocation failed", boundedText(error && error.code, 64) || "unknown");
      }
      throw createError("invite_expired", "邀请已过期，请创建新的邀请");
    }
    toPublicInvite(current, openid);
    if (current.creatorOpenid !== openid || current.planId !== incoming.planId) {
      throw createError("invite_id_conflict", "邀请 ID 冲突，请重试");
    }
    const versionComparison = comparePlanUpdatedAt(incoming.planUpdatedAt, current.planUpdatedAt);
    if (versionComparison < 0) {
      throw createError("invite_changed", "邀请已被更新，请重新打开最新版本");
    }
    if (versionComparison === 0) {
      if (sameInviteRevisionContent(incoming, current)) return current;
      throw createError("invite_changed", "同一版本的邀请内容不一致，请重新打开");
    }
    if (["confirmed", "rejected"].includes(current.status)
      && incoming.status === "pending"
      && sameJson(buildInviteContentFingerprint(incoming), buildInviteContentFingerprint(current))) {
      throw createError("invite_terminal", "已响应的邀请不能在内容未变化时重新打开");
    }

    const condition = addUnexpiredInviteCondition(
      addActiveInviteCondition({ _id: inviteId, creatorOpenid: openid }),
      current,
    );
    if (Object.prototype.hasOwnProperty.call(current, "planUpdatedAt")) {
      condition.planUpdatedAt = current.planUpdatedAt;
    } else {
      condition.planUpdatedAt = db.command.exists(false);
    }
    const patch = buildInviteRefreshPatch(incoming);
    const result = await db.collection("plan_invites").where(condition).update({ data: patch });
    if (getUpdatedCount(result) > 0) return Object.assign({}, current, patch);
    current = null;
  }

  const latest = await findInviteById(inviteId);
  if (latest && latest.creatorOpenid === openid && latest.planId === incoming.planId) {
    if (isInviteRevoked(latest)) throw createError("invite_revoked", "邀请已撤销");
    if (isInviteExpired(latest)) {
      try {
        await revokeInviteIfUnchanged(inviteId, latest, "expired");
      } catch (error) {
        console.warn("expired invite revocation failed", boundedText(error && error.code, 64) || "unknown");
      }
      throw createError("invite_expired", "邀请已过期，请创建新的邀请");
    }
    toPublicInvite(latest, openid);
    const versionComparison = comparePlanUpdatedAt(latest.planUpdatedAt, incoming.planUpdatedAt);
    if (versionComparison > 0) {
      throw createError("invite_changed", "邀请已被更新，请重新打开最新版本");
    }
    if (versionComparison === 0 && sameInviteRevisionContent(incoming, latest)) return latest;
  }
  throw createError("invite_conflict", "邀请刚刚被更新，请重试");
}

async function revokeInviteIfUnchanged(inviteId, invite = {}, reason = "revoked") {
  if (isInviteRevoked(invite)) return true;
  const condition = addActiveInviteCondition({ _id: inviteId });
  if (Object.prototype.hasOwnProperty.call(invite, "updatedAt")) {
    condition.updatedAt = invite.updatedAt;
  } else if (Object.prototype.hasOwnProperty.call(invite, "createdAt")) {
    condition.createdAt = invite.createdAt;
  } else {
    return false;
  }
  const result = await db.collection("plan_invites").where(condition).update({
    data: buildRevokedInvitePatch(invite, reason),
  });
  return getUpdatedCount(result) > 0;
}

async function insertRevokedInviteTombstone(inviteId, creatorOpenid, reason = "revoked") {
  const now = new Date();
  try {
    await db.collection("plan_invites").add({
      data: Object.assign({
        _id: inviteId,
        creatorOpenid,
        createdAt: now,
      }, buildRevokedInvitePatch({}, reason, now)),
    });
    return true;
  } catch (error) {
    // Insert-only is intentional: a concurrent create/revoke owns the ID now
    // and must be inspected instead of overwritten.
    return false;
  }
}

async function getMutableInviteOrThrow(inviteId, viewerOpenid) {
  const latest = await findInviteById(inviteId);
  if (!latest) throw createError("not_found", "邀请不存在");
  if (isInviteRevoked(latest)) throw createError("invite_revoked", "邀请已撤销");
  if (isInviteExpired(latest)) {
    try {
      await revokeInviteIfUnchanged(inviteId, latest, "expired");
    } catch (error) {
      console.warn("expired invite revocation failed", boundedText(error && error.code, 64) || "unknown");
    }
    throw createError("invite_expired", "邀请已过期");
  }
  toPublicInvite(latest, viewerOpenid);
  return latest;
}

module.exports = {
  findInviteById,
  refreshOwnedInvite,
  revokeInviteIfUnchanged,
  insertRevokedInviteTombstone,
  getMutableInviteOrThrow,
};
