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
const {
  updateInviteStatus,
  updateInvitePlan,
  proposeInviteTime,
} = require("./inviteMutations.js");

function deleteInvite(inviteId) {
  inviteId = normalizeInviteId(inviteId);
  if (!inviteId) return Promise.resolve({ success: false, code: "missing_invite" });
  const previousTombstones = readInviteTombstones();
  if (!markInviteTombstone(inviteId)) {
    return Promise.resolve({ success: false, code: "storage_failed", message: "邀请撤销标记保存失败" });
  }
  const invites = readInvites();
  const index = invites.findIndex((item) => item.inviteId === inviteId || item.id === inviteId);
  let removed = false;
  if (index > -1) {
    invites.splice(index, 1);
    removed = writeInvites(invites);
  }
  if (index > -1 && !removed) {
    const tombstoneRestored = writeInviteTombstones(previousTombstones);
    if (tombstoneRestored) knownInvalidInviteIds.delete(inviteId);
    return Promise.resolve({
      success: false,
      code: "storage_failed",
      message: tombstoneRestored
        ? "本地邀请删除失败，已恢复原状态"
        : "本地邀请删除失败，且撤销标记恢复失败，请重新打开",
      rollbackFailed: !tombstoneRestored,
    });
  }
  if (!privacyService.isCloudUploadAllowed()) {
    return Promise.resolve({ success: true, localOnly: true, code: "privacy_local_only" });
  }
  const cloudUnavailable = cloudService.getCloudUnavailableError("邀请同步");
  if (cloudUnavailable) {
    return Promise.resolve({
      success: true,
      localOnly: true,
      code: cloudUnavailable.code,
      message: "已在本机撤销；云环境配置完成后可继续清理远端邀请",
    });
  }
  return callCloud("deletePlanInvite", { inviteId })
    .then((result) => {
      if (!responseMatchesInviteId(result, inviteId)) {
        return {
          success: false,
          localDeleted: true,
          code: "invite_changed",
          message: "已在本机撤销，但云端返回的邀请不匹配",
        };
      }
      // An earlier create request may still reach the server after this delete.
      // Keep the tombstone queued until that request has settled.
      if (!pendingInviteCreateIds.has(inviteId)) markTombstoneRemoteDeleted(inviteId);
      return Object.assign({ success: true }, result);
    })
    .catch((error) => {
      console.warn("Cloud invite deletion failed:", error);
      if (["not_found", "missing_invite", "invite_expired", "invite_revoked"].includes(error && error.code)) {
        const marked = markTombstoneRemoteDeleted(inviteId);
        return {
          success: marked,
          localDeleted: true,
          remoteAbsent: true,
          code: marked ? "remote_absent" : "storage_failed",
          message: marked ? "已在本机撤销，远端邀请已不存在" : "本地撤销已完成，但远端清理状态保存失败",
        };
      }
      if (PERMANENT_DELETE_ERROR_CODES.has(error && error.code)) {
        markTombstoneRemoteBlocked(inviteId, error.code);
        return {
          success: false,
          localDeleted: true,
          code: error.code,
          message: "已在本机撤销，但当前账号无权删除远端邀请",
        };
      }
      return {
        success: true,
        localOnly: true,
        code: error && error.code || "cloud_unavailable",
        message: "已在本机撤销，云端将在恢复后保持失效标记",
      };
    });
}

let pendingTombstoneFlushPromise = null;

function flushInviteTombstones() {
  if (pendingTombstoneFlushPromise) return pendingTombstoneFlushPromise;
  if (!privacyService.isCloudUploadAllowed() || cloudService.getCloudUnavailableError("邀请同步")) {
    return Promise.resolve(false);
  }
  const pending = readInviteTombstones()
    .filter((item) => !item.remoteDeleted && !item.remoteDeleteBlocked)
    .slice(0, MAX_TOMBSTONE_FLUSH_BATCH);
  if (!pending.length) return Promise.resolve(true);
  const results = new Array(pending.length);
  let cursor = 0;
  const consume = () => {
    const index = cursor;
    cursor += 1;
    if (index >= pending.length) return Promise.resolve();
    const item = pending[index];
    return callCloud("deletePlanInvite", { inviteId: item.inviteId })
      .then((result) => {
        results[index] = responseMatchesInviteId(result, item.inviteId)
          && markTombstoneRemoteDeleted(item.inviteId);
      })
      .catch((error) => {
        if (["not_found", "missing_invite", "invite_expired", "invite_revoked"].includes(error && error.code)) {
          results[index] = markTombstoneRemoteDeleted(item.inviteId);
          return;
        }
        if (PERMANENT_DELETE_ERROR_CODES.has(error && error.code)) {
          markTombstoneRemoteBlocked(item.inviteId, error.code);
        }
        results[index] = false;
      })
      .then(consume);
  };
  const workers = Array.from(
    { length: Math.min(TOMBSTONE_FLUSH_CONCURRENCY, pending.length) },
    consume,
  );
  const run = Promise.all(workers).then(() => results.every(Boolean));
  pendingTombstoneFlushPromise = run.then((result) => {
    pendingTombstoneFlushPromise = null;
    return result;
  }, (error) => {
    pendingTombstoneFlushPromise = null;
    throw error;
  });
  return pendingTombstoneFlushPromise;
}

module.exports = {
  deleteInvite,
  flushInviteTombstones,
};
