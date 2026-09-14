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

function createInvite(plan, friendName = "朋友", options = {}) {
  const localInvite = ensureLocalInvite(plan, friendName, options.localInvite);
  if (!localInvite) return Promise.reject(new Error("缺少可分享的计划"));
  const stableInviteId = getInviteId(localInvite);
  const cloudUnavailable = cloudService.getCloudUnavailableError("邀请同步");
  if (!privacyService.isCloudUploadAllowed() || cloudUnavailable) {
    return Promise.resolve(localInvite);
  }
  trackPendingInviteCreate(stableInviteId);
  const request = callCloud("createPlanInvite", {
    inviteId: stableInviteId,
    planId: localInvite.planSnapshot.id,
    couponId: localInvite.planSnapshot.couponId,
    title: localInvite.planSnapshot.title,
    selectedTime: localInvite.planSnapshot.selectedTime || {},
    planSnapshot: localInvite.planSnapshot || buildPlanSnapshot(plan),
    friendName: localInvite.friendName,
    // createPlanInvite is insert-or-read-current and always starts new records
    // pending. A duplicate may safely return a terminal status from the server.
    status: "pending",
    planUpdatedAt: localInvite.planUpdatedAt,
  }).then((result) => {
    // Cancellation can win locally while createPlanInvite is still in flight.
    // Delete once more after the create response so delete-before-create cannot
    // resurrect an already revoked capability URL.
    if (hasInviteTombstone(stableInviteId)) {
      return callCloud("deletePlanInvite", { inviteId: stableInviteId })
        .then((deleteResult) => {
          if (responseMatchesInviteId(deleteResult, stableInviteId)) {
            markTombstoneRemoteDeleted(stableInviteId);
          }
          return buildInvalidInvite(stableInviteId);
        })
        .catch(() => buildInvalidInvite(stableInviteId));
    }
    const latest = readInvites().find((item) => getInviteId(item) === stableInviteId);
    const requestIsCurrent = Boolean(
      latest
      && latest.planUpdatedAt === localInvite.planUpdatedAt
      && sameSnapshot(latest.planSnapshot, localInvite.planSnapshot)
    );
    // A newer local re-share may have been queued while this request was in
    // flight. Never let the older response recreate or overwrite that state.
    if (!requestIsCurrent) return latest || localInvite;
    const remoteInvite = sanitizeRemoteInvite(result, stableInviteId);
    const responseMatchesRequest = Boolean(remoteInvite)
      && comparePlanVersions(remoteInvite, localInvite) === 0
      && sameSnapshot(
        buildInviteContentFingerprint(remoteInvite.planSnapshot),
        buildInviteContentFingerprint(localInvite.planSnapshot),
      );
    if (!responseMatchesRequest) {
      // A stale or conflicting server response must not mark this local
      // revision as synchronized. A later force-cloud read will reconcile it.
      return latest || localInvite;
    }
    const invite = Object.assign({}, latest, remoteInvite, {
      // The client-generated id is part of a card that may already have been
      // sent, so it remains canonical even if an old backend returns another id.
      inviteId: stableInviteId,
      id: stableInviteId,
      sharePath: localInvite.sharePath,
      syncStatus: "cloud",
      statusSyncStatus: "cloud",
      proposalSyncStatus: "cloud",
      migratedFromInviteId: latest.migratedFromInviteId || localInvite.migratedFromInviteId,
    });
    // Do not route the response back through ensureLocalInvite: the stored
    // pending envelope would win that merge and could reopen a terminal status
    // already chosen by the recipient. Persist the validated server state as-is.
    const currentInvites = readInvites();
    const persisted = writeInvites([invite].concat(
      currentInvites.filter((item) => getInviteId(item) !== stableInviteId),
    ), stableInviteId);
    if (!persisted) return Object.assign({}, invite, { persistenceError: true });
    return readInvites().find((item) => getInviteId(item) === stableInviteId) || invite;
  }).catch((err) => {
    if (hasInviteTombstone(stableInviteId)) return buildInvalidInvite(stableInviteId);
    if (PERMANENT_CREATE_ERROR_CODES.has(err && err.code)) {
      const tombstoneSaved = markInviteTombstone(stableInviteId);
      const localRemoved = tombstoneSaved ? removeLocalInvite(stableInviteId) : false;
      if (!tombstoneSaved || !localRemoved) {
        err.persistenceError = true;
        err.message = `${err.message || "邀请同步失败"}，且本地失效状态未完整保存`;
      }
      throw err;
    }
    console.warn("Cloud invite sync failed, using local:", err);
    const api = getWx();
    if (!options.silent && api && typeof api.showToast === "function") {
      api.showToast({
        title: "网络异常，已降级为本地邀请",
        icon: "none",
      });
    }
    return localInvite;
  });
  return request.then((result) => {
    pendingInviteCreateIds.delete(stableInviteId);
    return result;
  }, (error) => {
    pendingInviteCreateIds.delete(stableInviteId);
    throw error;
  });
}

function getInvite(inviteId, options = {}) {
  inviteId = normalizeInviteId(inviteId);
  if (!inviteId) return Promise.resolve(null);
  if (hasInviteTombstone(inviteId)) return Promise.resolve(buildInvalidInvite(inviteId));
  const local = readInvites().find((item) => item.inviteId === inviteId || item.id === inviteId);
  if (local && !options.forceCloud) return Promise.resolve(local);
  if (!privacyService.isCloudUploadAllowed()) return Promise.resolve(local || null);
  return callCloud("getPlanInvite", { inviteId })
    .then((result) => {
      const remote = sanitizeRemoteInvite(result.invite, inviteId);
      if (!remote) {
        if (result.invite) return local || null;
        if (local && (local.syncStatus === "local" || local.statusSyncStatus === "local")) {
          if (options.syncLocalNewer && local.syncStatus === "local") {
            return createInvite(local.planSnapshot || local, local.friendName || "朋友", {
              localInvite: local,
              silent: true,
            });
          }
          return local;
        }
        const tombstoneSaved = markInviteTombstone(inviteId);
        const localRemoved = tombstoneSaved ? removeLocalInvite(inviteId) : false;
        return Object.assign(buildInvalidInvite(inviteId), {
          persistenceError: !tombstoneSaved || !localRemoved,
        });
      }
      // The capability from the opened card remains canonical. Never replace
      // it with an identifier returned by an older or incompatible backend.
      const remoteInviteId = remote.inviteId;
      const stableInviteId = inviteId;
      const localPlanId = normalizePlanId(local && (local.planId || (local.planSnapshot && local.planSnapshot.id)));
      if (localPlanId && remote.planId !== localPlanId) return local;
      const versionComparison = local ? comparePlanVersions(remote, local) : 1;
      if (local && versionComparison < 0) {
        if (options.syncLocalNewer && local.syncStatus === "local") {
          return createInvite(local.planSnapshot || local, local.friendName || "朋友", {
            localInvite: local,
            silent: true,
          });
        }
        return local;
      }

      const localDecisionPending = Boolean(
        local
        && versionComparison === 0
        && local.statusSyncStatus === "local"
        && ["confirmed", "rejected"].includes(local.status)
      );
      if (localDecisionPending && remote.status === "pending") {
        return callCloud("updatePlanInvite", {
          inviteId: stableInviteId,
          status: local.status,
          planUpdatedAt: local.planUpdatedAt || "",
        }).then((statusResult) => {
          if (!responseMatchesInviteId(statusResult, stableInviteId)
            || statusResult.status !== local.status) return local;
          const synchronized = Object.assign({}, local, {
            id: stableInviteId,
            inviteId: stableInviteId,
            syncStatus: "cloud",
            statusSyncStatus: "cloud",
            updatedAt: new Date().toISOString(),
          });
          const latest = readInvites();
          const persisted = writeInvites(
            [synchronized].concat(latest.filter((item) => getInviteId(item) !== stableInviteId)),
            stableInviteId,
          );
          return persisted ? synchronized : Object.assign({}, synchronized, { persistenceError: true });
        }).catch(() => local);
      }
      const normalized = Object.assign({}, local || {}, remote, {
        id: stableInviteId,
        inviteId: stableInviteId,
        remoteInviteId: remoteInviteId && remoteInviteId !== stableInviteId ? remoteInviteId : undefined,
        syncStatus: "cloud",
        statusSyncStatus: "cloud",
      });
      const latest = readInvites();
      const persisted = writeInvites([normalized].concat(latest.filter((item) => {
        const itemId = getInviteId(item);
        return itemId !== stableInviteId && (!remoteInviteId || itemId !== remoteInviteId);
      })), stableInviteId);
      return persisted ? normalized : Object.assign({}, normalized, { persistenceError: true });
    })
    .catch((error) => {
      if (["not_found", "invite_expired", "invite_revoked", "missing_invite"].includes(error && error.code)
        && !(local && (local.syncStatus === "local" || local.statusSyncStatus === "local"))) {
        const tombstoneSaved = markInviteTombstone(inviteId);
        const localRemoved = tombstoneSaved ? removeLocalInvite(inviteId) : false;
        return Object.assign(buildInvalidInvite(inviteId), {
          persistenceError: !tombstoneSaved || !localRemoved,
        });
      }
      return local || null;
    });
}

module.exports = {
  createInvite,
  getInvite,
};
