const privacyService = require("../privacyService.js");
const cloudService = require("./cloudService.js");
const { getWx } = require("../wechatRuntime.js");
const {
  INVITE_KEY,
  INVITE_TOMBSTONE_KEY,
  MAX_STORED_INVITES,
  MAX_PENDING_INVITE_TOMBSTONES,
  MAX_TOMBSTONE_FLUSH_BATCH,
  TOMBSTONE_FLUSH_CONCURRENCY,
  MAX_TRACKED_PENDING_INVITE_CREATES,
  pendingInviteCreateIds,
  knownInvalidInviteIds,
  INVITE_STATUSES,
  SHAREABLE_PLAN_STATUSES,
  RESERVATION_STATUSES,
  REQUIRED_RESERVATION_STATUSES,
  PERMANENT_CREATE_ERROR_CODES,
  PERMANENT_STATUS_ERROR_CODES,
  PERMANENT_DELETE_ERROR_CODES,
  PERMANENT_PLAN_UPDATE_ERROR_CODES,
  rememberInvalidInviteId,
  trackPendingInviteCreate,
} = require("./inviteContext.js");
const {
  boundedText,
  normalizeInviteTombstone,
  normalizeInviteId,
  isLegacyInviteId,
  isStrongInviteId,
  normalizePlanId,
  normalizeSnapshotDate,
  normalizeSnapshotClock,
  normalizeRfc3339Timestamp,
  createCapabilityToken,
  createStrongInviteId,
  buildInvite,
  getInviteId,
  responseMatchesInviteId,
  buildPlanSnapshot,
  isShareablePlanSnapshot,
  buildSelectedTimeSnapshot,
  hasValidReservationTriState,
  sanitizeRemoteInvite,
  sanitizeStoredInvite,
  isValidProposalTime,
  sameSnapshot,
  buildInviteContentFingerprint,
  comparePlanVersions,
  nextPlanUpdatedAt,
} = require("./inviteNormalizer.js");
const {
  normalizeStoredInviteList,
  readInvites,
  writeInvites,
  removeLocalInvite,
  readInviteTombstones,
  normalizePendingInviteTombstones,
  writeInviteTombstones,
  hasInviteTombstone,
  markInviteTombstone,
  markTombstoneRemoteDeleted,
  markTombstoneRemoteBlocked,
  buildInvalidInvite,
  ensureLocalInvite,
} = require("./inviteLocalStore.js");
const {
  callCloud,
} = require("./inviteCloudTransport.js");
const {
  createInvite,
  getInvite,
} = require("./inviteCreateRead.js");

function updateInviteStatus(inviteId, status, options = {}) {
  inviteId = normalizeInviteId(inviteId);
  if (!inviteId || hasInviteTombstone(inviteId)) {
    return Promise.resolve({ success: false, code: "missing_invite", message: "邀请不存在或已撤销" });
  }
  if (!["confirmed", "rejected"].includes(status)) {
    return Promise.resolve({ success: false, code: "invalid_status", message: "邀请状态不合法" });
  }
  let invites = readInvites();
  let current = invites.find((item) => item.inviteId === inviteId || item.id === inviteId);
  if (!current && options.plan) {
    const seed = options.invite || {};
    const seedSnapshot = buildPlanSnapshot(options.plan);
    if (!isShareablePlanSnapshot(seedSnapshot)) {
      return Promise.resolve({ success: false, code: "invalid_plan", message: "计划信息不完整" });
    }
    const now = new Date().toISOString();
    current = {
      id: inviteId,
      inviteId,
      planId: seedSnapshot.id,
      couponId: seedSnapshot.couponId,
      title: seedSnapshot.title,
      selectedTime: seedSnapshot.selectedTime || {},
      planSnapshot: seedSnapshot,
      friendName: boundedText(seed.friendName || "朋友", 24) || "朋友",
      status: INVITE_STATUSES.has(seed.status) ? seed.status : "pending",
      message: boundedText(seed.message || "待确认这个计划", 80),
      sharePath: boundedText(seed.sharePath, 320),
      syncStatus: seed.syncStatus === "cloud" ? "cloud" : "local",
      planUpdatedAt: normalizeRfc3339Timestamp(seed.planUpdatedAt || options.planUpdatedAt) || now,
      createdAt: normalizeRfc3339Timestamp(seed.createdAt) || now,
      updatedAt: normalizeRfc3339Timestamp(seed.updatedAt) || now,
    };
    if (!writeInvites([current].concat(invites), inviteId)) {
      return Promise.resolve({ success: false, code: "storage_failed", message: "邀请保存失败" });
    }
    invites = readInvites();
  }
  if (!current) return Promise.resolve({ success: false, code: "missing_invite", message: "邀请不存在" });

  const persistLocalStatus = () => {
    const updatedAt = new Date().toISOString();
    const updated = readInvites().map((item) => item.inviteId === inviteId || item.id === inviteId ? Object.assign({}, item, {
      status,
      statusSyncStatus: "local",
      proposal: null,
      proposalSyncStatus: "local",
      updatedAt,
    }) : item);
    return writeInvites(updated);
  };
  const cloudUnavailable = cloudService.getCloudUnavailableError("邀请同步");
  if (!privacyService.isCloudUploadAllowed() || cloudUnavailable) {
    const persisted = persistLocalStatus();
    return Promise.resolve({
      success: persisted,
      localOnly: true,
      code: persisted ? (cloudUnavailable ? "cloud_unavailable" : "privacy_local_only") : "storage_failed",
      message: persisted ? "已在本机记录" : "本地邀请状态保存失败",
    });
  }
  return callCloud("updatePlanInvite", {
    inviteId,
    status,
    planUpdatedAt: current.planUpdatedAt || "",
  }).then((result) => {
    if (!responseMatchesInviteId(result, inviteId) || result.status !== status) {
      return {
        success: false,
        code: "invite_changed",
        message: "云端返回的邀请状态不匹配，请重新打开",
      };
    }
    const updatedAt = new Date().toISOString();
    const latest = readInvites().map((item) => item.inviteId === inviteId || item.id === inviteId ? Object.assign({}, item, {
      status,
      statusSyncStatus: "cloud",
      proposal: null,
      proposalSyncStatus: "cloud",
      updatedAt,
    }) : item);
    if (!writeInvites(latest)) {
      return { success: false, code: "storage_failed", remoteUpdated: true, message: "云端已更新，但本地保存失败" };
    }
    return Object.assign({ success: true }, result);
  }).catch((error) => {
    if (current.syncStatus === "local" && !PERMANENT_STATUS_ERROR_CODES.has(error && error.code)) {
      const persisted = persistLocalStatus();
      return {
        success: persisted,
        localOnly: true,
        code: persisted ? "local_invite_only" : "storage_failed",
        message: persisted ? "该邀请尚未上云，已在本机记录" : "本地邀请状态保存失败",
      };
    }
    return {
      success: false,
      code: error && error.code || "invite_failed",
      message: error && error.message || "邀请状态同步失败",
    };
  });
}

function updateInvitePlan(inviteId, plan, status = "pending") {
  inviteId = normalizeInviteId(inviteId);
  if (!inviteId || hasInviteTombstone(inviteId)) return Promise.resolve({ success: false, code: "missing_invite" });
  if (!plan || !normalizePlanId(plan.id)) return Promise.resolve({ success: false, code: "missing_plan" });
  if (!["pending", "confirmed", "rejected"].includes(status)) {
    return Promise.resolve({ success: false, code: "invalid_status" });
  }
  const planSnapshot = buildPlanSnapshot(plan);
  if (!isShareablePlanSnapshot(planSnapshot)) {
    return Promise.resolve({ success: false, code: "invalid_plan", message: "计划信息不完整，无法更新邀请" });
  }
  const invites = readInvites();
  const currentInvite = invites.find((item) => item.inviteId === inviteId || item.id === inviteId);
  const updatedAt = nextPlanUpdatedAt(currentInvite && currentInvite.planUpdatedAt);
  let found = false;
  const updated = invites.map((item) => {
    if (item.inviteId !== inviteId && item.id !== inviteId) return item;
    found = true;
    return Object.assign({}, item, {
      planId: planSnapshot.id,
      couponId: planSnapshot.couponId,
      title: planSnapshot.title,
      selectedTime: planSnapshot.selectedTime || {},
      planSnapshot,
      status,
      message: status === "pending" ? `${item.friendName || "朋友"}待确认新的计划时间` : item.message,
      proposal: null,
      proposalSyncStatus: "cloud",
      syncStatus: "local",
      planUpdatedAt: updatedAt,
      updatedAt,
    });
  });
  if (!found) return Promise.resolve({ success: false, code: "missing_invite" });
  if (!writeInvites(updated)) return Promise.resolve({ success: false, code: "storage_failed" });
  const rollbackOptimisticInvite = () => {
    const latest = readInvites();
    let matchedOptimisticRevision = false;
    const restored = latest.map((item) => {
      if (getInviteId(item) !== inviteId
        || item.planUpdatedAt !== updatedAt
        || !sameSnapshot(item.planSnapshot, planSnapshot)) return item;
      matchedOptimisticRevision = true;
      return currentInvite;
    });
    // A newer local edit won the race. It must not be overwritten by this
    // request's rollback, and it remains explicitly marked for synchronization.
    if (!matchedOptimisticRevision) return { persisted: true, superseded: true };
    return { persisted: writeInvites(restored), superseded: false };
  };
  const failureWithRollback = (failure) => {
    const rollback = rollbackOptimisticInvite();
    return Object.assign({}, failure, {
      persistenceError: !rollback.persisted,
      rollbackFailed: !rollback.persisted,
      superseded: rollback.superseded,
      message: rollback.persisted
        ? failure.message
        : `${failure.message || "邀请更新失败"}，且本地邀请恢复失败，请重新打开计划`,
    });
  };
  const cloudUnavailable = cloudService.getCloudUnavailableError("邀请同步");
  if (!privacyService.isCloudUploadAllowed() || cloudUnavailable) {
    return Promise.resolve({
      success: true,
      code: cloudUnavailable ? "cloud_unavailable" : "privacy_local_only",
      localOnly: true,
    });
  }
  return callCloud("updatePlanInvite", {
    inviteId,
    couponId: planSnapshot.couponId,
    title: planSnapshot.title,
    selectedTime: planSnapshot.selectedTime || {},
    planSnapshot,
    status,
    planUpdatedAt: updatedAt,
  }).then((result) => {
    const responseMatchesRequest = responseMatchesInviteId(result, inviteId)
      && comparePlanVersions(result, { planUpdatedAt: updatedAt }) === 0
      && sameSnapshot(
        buildInviteContentFingerprint(result.planSnapshot),
        buildInviteContentFingerprint(planSnapshot),
      );
    if (!responseMatchesRequest) {
      return failureWithRollback({
        success: false,
        code: "invite_changed",
        message: "云端邀请已更新，请重新打开",
      });
    }
    const latest = readInvites();
    const persisted = writeInvites(latest.map((item) => (
      item.inviteId === inviteId || item.id === inviteId
        ? (item.planUpdatedAt === updatedAt && sameSnapshot(item.planSnapshot, planSnapshot)
          ? Object.assign({}, item, { syncStatus: "cloud" })
          : item)
        : item
    )));
    return persisted ? result : { success: false, code: "storage_failed", remoteUpdated: true };
  }).catch((error) => {
    const failure = {
      success: false,
      code: error && error.code || "invite_failed",
      message: error && error.message || "邀请更新失败",
    };
    return PERMANENT_PLAN_UPDATE_ERROR_CODES.has(failure.code)
      ? failureWithRollback(failure)
      : failure;
  });
}

function proposeInviteTime(inviteId, selectedTime = {}, options = {}) {
  inviteId = normalizeInviteId(inviteId);
  if (!inviteId || hasInviteTombstone(inviteId)) {
    return Promise.resolve({ success: false, code: "missing_invite", message: "邀请不存在或已撤销" });
  }
  const invites = readInvites();
  const current = invites.find((item) => getInviteId(item) === inviteId);
  if (!current) return Promise.resolve({ success: false, code: "missing_invite", message: "邀请不存在" });
  const normalizedSelectedTime = buildSelectedTimeSnapshot(selectedTime);
  if (!isValidProposalTime(normalizedSelectedTime)) {
    return Promise.resolve({ success: false, code: "invalid_proposal", message: "改期日期或时间不合法" });
  }
  const proposal = {
    selectedTime: normalizedSelectedTime,
    createdAt: new Date().toISOString(),
  };
  const persistProposal = (syncStatus) => {
    const updated = readInvites().map((item) => getInviteId(item) === inviteId ? Object.assign({}, item, {
      proposal,
      proposalSyncStatus: syncStatus,
      updatedAt: proposal.createdAt,
    }) : item);
    return writeInvites(updated);
  };
  if (!persistProposal("local")) {
    return Promise.resolve({ success: false, code: "storage_failed", message: "改期提议保存失败" });
  }
  const cloudUnavailable = cloudService.getCloudUnavailableError("邀请同步");
  if (!privacyService.isCloudUploadAllowed() || cloudUnavailable || current.syncStatus === "local") {
    const privacyLocalOnly = !privacyService.isCloudUploadAllowed();
    const localInviteOnly = current.syncStatus === "local" && !cloudUnavailable && !privacyLocalOnly;
    return Promise.resolve({
      success: true,
      localOnly: true,
      code: cloudUnavailable
        ? "cloud_unavailable"
        : (privacyLocalOnly ? "privacy_local_only" : "local_invite_only"),
      message: cloudUnavailable
        ? "云环境未配置，提议仅保存在本机"
        : (localInviteOnly ? "邀请尚未同步到云端，提议仅保存在本机" : "隐私模式下，提议仅保存在本机"),
      proposal,
    });
  }
  return callCloud("proposePlanInviteTime", {
    inviteId,
    selectedTime: proposal.selectedTime,
    planUpdatedAt: normalizeRfc3339Timestamp(options.planUpdatedAt || current.planUpdatedAt),
  }).then((result) => {
    if (!responseMatchesInviteId(result, inviteId)) {
      throw Object.assign(new Error("云端返回的邀请不匹配"), { code: "invite_changed" });
    }
    const latest = readInvites();
    const persisted = writeInvites(latest.map((item) => (
      getInviteId(item) === inviteId
        && item.planUpdatedAt === current.planUpdatedAt
        && item.proposal
        && item.proposal.createdAt === proposal.createdAt
        ? Object.assign({}, item, {
          proposal: result.proposal || proposal,
          proposalSyncStatus: "cloud",
        })
        : item
    )));
    return persisted ? Object.assign({ success: true }, result) : {
      success: false,
      code: "storage_failed",
      remoteUpdated: true,
      message: "提议已发送，但本地保存失败",
    };
  }).catch((error) => {
    // A synchronized invite has no proposal retry queue. Remove the optimistic
    // local proposal on failure so an unsent proposal cannot later appear as
    // if it came from the server.
    const rolledBack = writeInvites(readInvites().map((item) => {
      if (getInviteId(item) !== inviteId
        || !item.proposal
        || item.proposal.createdAt !== proposal.createdAt) return item;
      return Object.assign({}, item, {
        proposal: current.proposal || null,
        proposalSyncStatus: current.proposalSyncStatus || "cloud",
        updatedAt: current.updatedAt,
      });
    }));
    return {
      success: false,
      code: error && error.code || "proposal_failed",
      message: rolledBack
        ? (error && error.message || "改期提议发送失败")
        : "改期提议发送失败，且本地状态恢复失败，请重新打开计划",
      persistenceError: !rolledBack,
    };
  });
}

module.exports = {
  updateInviteStatus,
  updateInvitePlan,
  proposeInviteTime,
};
