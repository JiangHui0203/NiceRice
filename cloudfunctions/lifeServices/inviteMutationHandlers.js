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
const {
  findInviteById,
  refreshOwnedInvite,
  revokeInviteIfUnchanged,
  insertRevokedInviteTombstone,
  getMutableInviteOrThrow,
} = require("./inviteRepository.js");
const { toPublicInvite } = require("./invitePublicView.js");
const {
  isAllowedOcrFileId,
  enforceRateLimit,
  enforceEventRateLimit,
} = require("./serviceSecurity.js");

async function updatePlanInvite(event = {}) {
  const data = event.data || {};
  const inviteId = normalizeInviteId(data.inviteId);
  const wxContext = enforceEventRateLimit("updatePlanInvite", 60);
  const invite = await findInviteById(inviteId);
  if (!invite) throw createError("not_found", "邀请不存在");
  if (isInviteRevoked(invite)) throw createError("invite_revoked", "邀请已撤销");

  if (isInviteExpired(invite)) {
    try {
      await revokeInviteIfUnchanged(inviteId, invite, "expired");
    } catch (error) {
      console.warn("expired invite revocation failed", boundedText(error && error.code, 64) || "unknown");
    }
    throw createError("invite_expired", "邀请已过期，请创建新的邀请");
  }
  toPublicInvite(invite, wxContext.OPENID);

  const currentStatus = normalizeInviteStatus(invite.status, "");
  if (!currentStatus) throw createError("invalid_record", "邀请状态缺失");
  const hasStatus = data.status !== undefined && data.status !== null && data.status !== "";
  const requestedStatus = normalizeInviteStatus(data.status, currentStatus);
  const contentUpdateRequested = ["couponId", "title", "selectedTime", "planSnapshot"]
    .some((key) => Object.prototype.hasOwnProperty.call(data, key));
  const incomingPlanUpdatedAt = normalizePlanUpdatedAt(data.planUpdatedAt, "");

  // 权限校验：仅创建者或当前受邀响应者有权修改
  const isCreator = Boolean(invite.creatorOpenid && invite.creatorOpenid === wxContext.OPENID);
  if (isCreator && hasStatus && ["confirmed", "rejected"].includes(requestedStatus)) {
    throw createError("invalid_role", "邀请发起人不能代替好友响应");
  }
  if (isCreator && hasStatus && requestedStatus === "pending"
    && currentStatus !== "pending" && !contentUpdateRequested) {
    throw createError("invite_terminal", "已响应的邀请需要修改计划内容后才能重新发起");
  }
  if (isCreator && contentUpdateRequested && currentStatus !== "pending"
    && (!hasStatus || requestedStatus !== "pending")) {
    throw createError("invalid_status", "修改已响应邀请时必须明确重新发起");
  }
  if (isCreator && !contentUpdateRequested) {
    if (!hasStatus) throw createError("no_changes", "没有需要更新的邀请内容");
    return {
      inviteId,
      status: currentStatus,
      planUpdatedAt: invite.planUpdatedAt || "",
      planSnapshot: normalizeInvitePlanSnapshot(invite.planSnapshot || {}, invite.planId),
      respondedByCurrentUser: false,
      idempotent: true,
    };
  }
  if (!isCreator) {
    if (contentUpdateRequested) throw createError("unauthorized", "受邀人无权修改计划内容");
    if (!hasStatus || (requestedStatus !== "confirmed" && requestedStatus !== "rejected")) {
      throw createError("unauthorized", "无权修改此邀请的内容");
    }
    if (comparePlanUpdatedAt(incomingPlanUpdatedAt, invite.planUpdatedAt || "") !== 0) {
      throw createError("invite_changed", "计划已更新，请返回后重新打开最新邀请");
    }
    if (currentStatus !== "pending") {
      if (invite.responderOpenid === wxContext.OPENID && invite.status === requestedStatus) {
        if (invite.proposal) {
          const clearCondition = addUnexpiredInviteCondition(
            addActiveInviteCondition(addPlanVersionCondition({
              _id: inviteId,
              status: requestedStatus,
              responderOpenid: wxContext.OPENID,
            }, invite)),
            invite,
          );
          const cleared = await db.collection("plan_invites").where(clearCondition).update({
            data: {
              proposal: null,
              proposalUpdatedAt: "",
              proposedByOpenid: "",
              updatedAt: new Date(),
            },
          });
          if (!getUpdatedCount(cleared)) {
            await getMutableInviteOrThrow(inviteId, wxContext.OPENID);
            throw createError("invite_changed", "邀请已被更新，请重新打开最新版本");
          }
        }
        return { inviteId, status: requestedStatus, idempotent: true };
      }
      throw createError("invite_already_claimed", "该邀请已经响应，不能重复修改");
    }
    if (invite.responderOpenid && invite.responderOpenid !== wxContext.OPENID) {
      throw createError("invite_already_claimed", "该邀请已由其他用户响应");
    }
  }

  const updateData = {
    updatedAt: new Date(),
  };
  if (hasStatus) updateData.status = requestedStatus;
  if (isCreator && contentUpdateRequested) {
    if (!incomingPlanUpdatedAt) throw createError("invalid_plan_version", "修改邀请时缺少计划版本时间");
    const hasPlanSnapshot = Object.prototype.hasOwnProperty.call(data, "planSnapshot");
    if (hasPlanSnapshot && !isRecord(data.planSnapshot)) {
      throw createError("invalid_plan", "计划快照格式无效");
    }
    const incomingSnapshot = hasPlanSnapshot ? mergeRecords(data.planSnapshot) : Object.create(null);
    if (incomingSnapshot.id && normalizePlanId(incomingSnapshot.id) !== invite.planId) {
      throw createError("invalid_plan", "不能把邀请改为另一个计划");
    }
    // Supplying planSnapshot means replacing the complete snapshot. Partial
    // top-level edits keep the previous snapshot as their base, but omitted
    // fields in an explicit snapshot must not leak in from the old revision.
    const snapshotBase = hasPlanSnapshot
      ? incomingSnapshot
      : mergeRecords(invite.planSnapshot || {});
    const selectedTime = Object.prototype.hasOwnProperty.call(data, "selectedTime")
      ? normalizeInviteSelectedTime(data.selectedTime, { strict: true })
      : normalizeInviteSelectedTime(snapshotBase.selectedTime, { strict: true });
    const planSnapshot = normalizeInvitePlanSnapshot(mergeRecords(
      snapshotBase,
      {
        id: invite.planId,
        couponId: Object.prototype.hasOwnProperty.call(data, "couponId")
          ? data.couponId
          : snapshotBase.couponId,
        title: Object.prototype.hasOwnProperty.call(data, "title")
          ? data.title
          : snapshotBase.title,
        selectedTime,
      },
    ), invite.planId);
    validateInvitePlanSnapshot(planSnapshot);
    updateData.couponId = planSnapshot.couponId;
    updateData.title = planSnapshot.title;
    updateData.selectedTime = selectedTime;
    updateData.planSnapshot = planSnapshot;
    updateData.planUpdatedAt = incomingPlanUpdatedAt;
    updateData.expiresAt = getInviteExpiry();
  }

  let finalInvite = invite;
  if (!isCreator) {
    // Old rows did not have responderOpenid. Initialize only records where it
    // is still absent, then claim with a conditional update so two recipients
    // cannot both win after reading the same pending invitation.
    const unclaimedCondition = addUnexpiredInviteCondition(addActiveInviteCondition({
      _id: inviteId,
      responderOpenid: db.command.exists(false),
    }), invite);
    addPlanVersionCondition(unclaimedCondition, invite);
    await db.collection("plan_invites").where(unclaimedCondition).update({ data: { responderOpenid: "" } });
    updateData.responderOpenid = wxContext.OPENID;
    updateData.proposal = null;
    updateData.proposalUpdatedAt = "";
    updateData.proposedByOpenid = "";
    const claimCondition = addUnexpiredInviteCondition(addActiveInviteCondition({
      _id: inviteId,
      responderOpenid: db.command.in(["", wxContext.OPENID]),
      status: "pending",
    }), invite);
    addPlanVersionCondition(claimCondition, invite);
    const claimed = await db.collection("plan_invites").where(claimCondition).update({ data: updateData });
    const updatedCount = getUpdatedCount(claimed);
    if (!updatedCount) {
      const latest = await getMutableInviteOrThrow(inviteId, wxContext.OPENID);
      if (comparePlanUpdatedAt(latest.planUpdatedAt, invite.planUpdatedAt) !== 0) {
        throw createError("invite_changed", "计划已更新，请返回后重新打开最新邀请");
      }
      throw createError("invite_already_claimed", "该邀请已由其他用户响应");
    }
    finalInvite = Object.assign({}, invite, updateData);
  } else if (contentUpdateRequested) {
    const incomingInvite = Object.assign({}, invite, updateData, {
      planId: invite.planId,
      status: hasStatus ? requestedStatus : (invite.status || "pending"),
      planUpdatedAt: updateData.planUpdatedAt,
      expiresAt: updateData.expiresAt || invite.expiresAt,
    });
    finalInvite = await refreshOwnedInvite(inviteId, incomingInvite, wxContext.OPENID, invite);
  }
  return {
    inviteId,
    status: hasStatus ? requestedStatus : "updated",
    planUpdatedAt: finalInvite.planUpdatedAt,
    planSnapshot: normalizeInvitePlanSnapshot(finalInvite.planSnapshot || {}, finalInvite.planId || invite.planId),
    respondedByCurrentUser: Boolean(
      finalInvite.responderOpenid && finalInvite.responderOpenid === wxContext.OPENID
    ),
  };
}

async function proposePlanInviteTime(event = {}) {
  const data = event.data || {};
  const inviteId = normalizeInviteId(data.inviteId);
  const wxContext = enforceEventRateLimit("proposePlanInviteTime", 30);
  const invite = await findInviteById(inviteId);
  if (!invite) throw createError("not_found", "邀请不存在");
  if (isInviteRevoked(invite)) throw createError("invite_revoked", "邀请已撤销");
  if (isInviteExpired(invite)) {
    try {
      await revokeInviteIfUnchanged(inviteId, invite, "expired");
    } catch (error) {
      console.warn("expired invite revocation failed", boundedText(error && error.code, 64) || "unknown");
    }
    throw createError("invite_expired", "邀请已过期");
  }
  toPublicInvite(invite, wxContext.OPENID);
  if (invite.creatorOpenid === wxContext.OPENID) {
    throw createError("invalid_role", "发起人请直接修改计划时间");
  }
  if (invite.status !== "pending") throw createError("invite_already_claimed", "邀请已响应，不能再提议改期");
  const incomingPlanUpdatedAt = normalizePlanUpdatedAt(data.planUpdatedAt, "");
  if (comparePlanUpdatedAt(incomingPlanUpdatedAt, invite.planUpdatedAt || "") !== 0) {
    throw createError("invite_changed", "计划已更新，请重新打开最新邀请");
  }
  const selectedTime = normalizeProposalTime(data.selectedTime);
  const currentSelectedTime = normalizeInviteSelectedTime(invite.selectedTime || {});
  if (selectedTime.date === currentSelectedTime.date
    && selectedTime.startTime === currentSelectedTime.startTime
    && String(selectedTime.endTime || "") === String(currentSelectedTime.endTime || "")) {
    throw createError("invalid_proposal", "改期时间不能与当前计划相同");
  }
  const now = new Date();
  const proposal = {
    selectedTime,
    createdAt: now.toISOString(),
  };

  if (!Object.prototype.hasOwnProperty.call(invite, "proposedByOpenid")) {
    const migrationCondition = addUnexpiredInviteCondition(
      addActiveInviteCondition(addPlanVersionCondition({
        _id: inviteId,
        proposedByOpenid: db.command.exists(false),
      }, invite)),
      invite,
    );
    await db.collection("plan_invites").where(migrationCondition).update({ data: { proposedByOpenid: "" } });
  }
  const condition = addUnexpiredInviteCondition(addActiveInviteCondition({
    _id: inviteId,
    status: "pending",
    proposedByOpenid: db.command.in(["", wxContext.OPENID]),
  }), invite);
  addPlanVersionCondition(condition, invite);
  const updated = await db.collection("plan_invites").where(condition).update({
    data: {
      proposal,
      proposalUpdatedAt: now,
      proposedByOpenid: wxContext.OPENID,
      updatedAt: now,
    },
  });
  if (!getUpdatedCount(updated)) {
    const latest = await getMutableInviteOrThrow(inviteId, wxContext.OPENID);
    if (comparePlanUpdatedAt(latest.planUpdatedAt, invite.planUpdatedAt) !== 0) {
      throw createError("invite_changed", "计划已更新，请重新打开最新邀请");
    }
    throw createError("proposal_already_sent", "已有其他人提交了改期提议");
  }
  return { inviteId, proposal };
}

async function deletePlanInvite(event = {}) {
  const data = event.data || {};
  const inviteId = normalizeInviteId(data.inviteId);
  const wxContext = enforceEventRateLimit("deletePlanInvite", 30);
  let existing = await findInviteById(inviteId);
  if (!existing) {
    const inserted = await insertRevokedInviteTombstone(inviteId, wxContext.OPENID, "revoked");
    if (inserted) {
      return { inviteId, deleted: true, revoked: true, tombstoneCreated: true };
    }
    existing = await findInviteById(inviteId);
    if (!existing) throw createError("delete_failed", "云端邀请撤销失败，请重试");
  }
  if (!existing.creatorOpenid || existing.creatorOpenid !== wxContext.OPENID) {
    throw createError("unauthorized", "只有邀请创建者可以删除邀请");
  }
  if (isInviteRevoked(existing)) {
    return { inviteId, deleted: true, revoked: true, idempotent: true };
  }
  const condition = addActiveInviteCondition({
    _id: inviteId,
    creatorOpenid: wxContext.OPENID,
  });
  const revoked = await db.collection("plan_invites").where(condition).update({
    data: buildRevokedInvitePatch(existing, "revoked"),
  });
  if (getUpdatedCount(revoked) > 0) return { inviteId, deleted: true, revoked: true };
  const latest = await findInviteById(inviteId);
  if (latest && latest.creatorOpenid !== wxContext.OPENID) {
    throw createError("unauthorized", "只有邀请创建者可以删除邀请");
  }
  if (latest && isInviteRevoked(latest)) {
    return { inviteId, deleted: true, revoked: true, idempotent: true };
  }
  if (latest) throw createError("delete_failed", "云端邀请撤销失败，请重试");
  const inserted = await insertRevokedInviteTombstone(inviteId, wxContext.OPENID, "revoked");
  if (inserted) return { inviteId, deleted: true, revoked: true, tombstoneCreated: true };
  const finalInvite = await findInviteById(inviteId);
  if (finalInvite && finalInvite.creatorOpenid !== wxContext.OPENID) {
    throw createError("unauthorized", "只有邀请创建者可以删除邀请");
  }
  if (finalInvite && isInviteRevoked(finalInvite)) {
    return { inviteId, deleted: true, revoked: true, idempotent: true };
  }
  throw createError("delete_failed", "云端邀请撤销失败，请重试");
}

module.exports = {
  updatePlanInvite,
  proposePlanInviteTime,
  deletePlanInvite,
};
