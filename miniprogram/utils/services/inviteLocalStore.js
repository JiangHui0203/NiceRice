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

function normalizeStoredInviteList(items, maxLength = MAX_STORED_INVITES) {
  const normalized = [];
  const seen = new Set();
  const source = Array.isArray(items) ? items : [];
  for (let index = 0; index < source.length && normalized.length < maxLength; index += 1) {
    const invite = sanitizeStoredInvite(source[index]);
    const inviteId = getInviteId(invite);
    if (!invite || !inviteId || seen.has(inviteId)) continue;
    seen.add(inviteId);
    normalized.push(invite);
  }
  return normalized;
}

function readInvites() {
  const stored = privacyService.readLocalData(INVITE_KEY, []);
  return normalizeStoredInviteList(stored);
}

function writeInvites(invites, requiredInviteId = "") {
  const source = Array.isArray(invites) ? invites : [];
  const normalized = normalizeStoredInviteList(invites);
  const requiredId = requiredInviteId ? normalizeInviteId(requiredInviteId) : "";
  // Creation/update callers can require that their target survived validation;
  // otherwise writing only the old tail would falsely look like a successful
  // save of a malformed new record.
  if (requiredInviteId) {
    const requiredHead = sanitizeStoredInvite(source[0]);
    if (!requiredId || getInviteId(requiredHead) !== requiredId
      || !normalized.some((item) => getInviteId(item) === requiredId)) return false;
  }
  const written = privacyService.writeLocalData(INVITE_KEY, normalized);
  if (!written) console.warn("invite storage failed");
  return Boolean(written);
}

function removeLocalInvite(inviteId) {
  const invites = readInvites();
  const remaining = invites.filter((item) => getInviteId(item) !== inviteId);
  if (remaining.length === invites.length) return true;
  return writeInvites(remaining);
}

function readInviteTombstones() {
  const stored = privacyService.readLocalData(INVITE_TOMBSTONE_KEY, []);
  // Invite IDs are capability URLs. Expiring a local tombstone could make an
  // old share card valid again if a stale plan snapshot reused the same ID.
  // Keep the bounded tombstone list durable instead of time-expiring entries.
  return normalizePendingInviteTombstones(stored, MAX_PENDING_INVITE_TOMBSTONES);
}

function normalizePendingInviteTombstones(items, maxLength) {
  const seen = new Set();
  const pending = [];
  const source = Array.isArray(items) ? items : [];
  for (let index = 0; index < source.length; index += 1) {
    const item = normalizeInviteTombstone(source[index]);
    const inviteId = item && item.inviteId;
    // Once the server confirmed its durable revocation tombstone, the
    // capability no longer resolves and the local copy can be compacted. Never
    // let those rows evict unresolved/blocked revocations protecting old cards.
    if (!inviteId || seen.has(inviteId)) continue;
    seen.add(inviteId);
    if (item.remoteDeleted) continue;
    pending.push(item);
    if (Number.isFinite(maxLength) && pending.length >= maxLength) break;
  }
  return pending;
}

function writeInviteTombstones(items) {
  // Collect one item beyond the durable bound so overflow is reported instead
  // of silently discarding a still-unresolved capability revocation.
  const pending = normalizePendingInviteTombstones(items, MAX_PENDING_INVITE_TOMBSTONES + 1);
  // Never make room by forgetting an unresolved capability. When the bounded
  // queue is full, the caller must keep the live invite and retry after remote
  // revocations have been confirmed and compacted.
  if (pending.length > MAX_PENDING_INVITE_TOMBSTONES) return false;
  return Boolean(privacyService.writeLocalData(INVITE_TOMBSTONE_KEY, pending));
}

function hasInviteTombstone(inviteId) {
  return isLegacyInviteId(inviteId)
    || knownInvalidInviteIds.has(inviteId)
    || readInviteTombstones().some((item) => item.inviteId === inviteId);
}

function markInviteTombstone(inviteId) {
  const remaining = readInviteTombstones().filter((item) => item.inviteId !== inviteId);
  const saved = writeInviteTombstones([{
    inviteId,
    deletedAt: new Date().toISOString(),
    remoteDeleted: false,
  }].concat(remaining));
  if (saved) rememberInvalidInviteId(inviteId);
  return saved;
}

function markTombstoneRemoteDeleted(inviteId) {
  const updated = readInviteTombstones().map((item) => item.inviteId === inviteId
    ? Object.assign({}, item, { remoteDeleted: true })
    : item);
  return writeInviteTombstones(updated);
}

function markTombstoneRemoteBlocked(inviteId, errorCode) {
  const updated = readInviteTombstones().map((item) => item.inviteId === inviteId
    ? Object.assign({}, item, { remoteDeleteBlocked: true, remoteDeleteError: errorCode || "unauthorized" })
    : item);
  return writeInviteTombstones(updated);
}

function buildInvalidInvite(inviteId) {
  return { id: inviteId, inviteId, status: "invalid", invalid: true, syncStatus: "cloud" };
}

function ensureLocalInvite(plan, friendName = "朋友", existingInvite = null) {
  if (!plan || typeof plan !== "object" || !normalizePlanId(plan.id)) return null;
  const invites = readInvites();
  const existingInviteId = getInviteId(existingInvite);
  let migratedFromInviteId = "";
  let candidate = null;
  if (isLegacyInviteId(existingInviteId)) {
    migratedFromInviteId = existingInviteId;
    // A crash between persisting the replacement and attaching it to the plan
    // leaves the plan pointing at the legacy ID. Reuse the durable mapping on
    // the next share instead of minting and silently losing another invite.
    candidate = invites.find((item) => (
      item.migratedFromInviteId === migratedFromInviteId
      && normalizePlanId(item.planId) === normalizePlanId(plan.id)
      && isStrongInviteId(getInviteId(item))
      && !hasInviteTombstone(getInviteId(item))
    )) || buildInvite(plan, (existingInvite && existingInvite.friendName) || friendName);
  } else {
    candidate = existingInviteId ? existingInvite : buildInvite(plan, friendName);
  }
  // A revoked capability URL is never reusable. Re-sharing the same plan must
  // mint a fresh ID while the old tombstone remains durable.
  if (candidate && hasInviteTombstone(getInviteId(candidate))) {
    candidate = buildInvite(plan, friendName);
  }
  if (!candidate) return null;

  const inviteId = getInviteId(candidate);
  if (!inviteId || isLegacyInviteId(inviteId) || hasInviteTombstone(inviteId)) return null;
  if (!migratedFromInviteId && isLegacyInviteId(candidate.migratedFromInviteId)) {
    migratedFromInviteId = normalizeInviteId(candidate.migratedFromInviteId);
  }
  const stored = invites.find((item) => getInviteId(item) === inviteId);
  const currentPlanSnapshot = buildPlanSnapshot(plan);
  if (!isShareablePlanSnapshot(currentPlanSnapshot)) return null;
  const previousPlanSnapshot = (stored && stored.planSnapshot) || candidate.planSnapshot;
  const previousUpdatedAt = normalizeRfc3339Timestamp((stored && stored.updatedAt) || candidate.updatedAt);
  const previousPlanUpdatedAt = normalizeRfc3339Timestamp(
    (stored && stored.planUpdatedAt) || candidate.planUpdatedAt,
  );
  const planSnapshotChanged = !sameSnapshot(
    buildInviteContentFingerprint(previousPlanSnapshot),
    buildInviteContentFingerprint(currentPlanSnapshot),
  );
  const refreshedAt = nextPlanUpdatedAt(previousPlanUpdatedAt);
  const previousSyncStatus = (stored && stored.syncStatus) || candidate.syncStatus || "local";
  // The durable local record may already contain a terminal response received
  // after the page snapshot was created. Never let that stale page snapshot
  // reopen the invitation.
  const rawPreviousStatus = (stored && stored.status) || candidate.status || "pending";
  const previousStatus = INVITE_STATUSES.has(rawPreviousStatus) ? rawPreviousStatus : "pending";
  const localInvite = Object.assign({}, candidate, stored || {}, {
    id: inviteId,
    inviteId,
    planId: currentPlanSnapshot.id,
    couponId: currentPlanSnapshot.couponId,
    title: currentPlanSnapshot.title,
    selectedTime: currentPlanSnapshot.selectedTime || {},
    // Status/updatedAt changes caused by accepting the invite are not a new
    // invitation revision. Preserve the existing envelope unless schedule or
    // location content genuinely changed.
    planSnapshot: planSnapshotChanged ? currentPlanSnapshot : (previousPlanSnapshot || currentPlanSnapshot),
    friendName: boundedText(candidate.friendName || friendName || "朋友", 24) || "朋友",
    // A changed plan snapshot must be uploaded again even when this invite ID
    // had already completed an earlier cloud sync.
    syncStatus: planSnapshotChanged ? "local" : previousSyncStatus,
    statusSyncStatus: planSnapshotChanged
      ? "local"
      : ((stored && stored.statusSyncStatus) || candidate.statusSyncStatus || previousSyncStatus),
    status: planSnapshotChanged ? "pending" : previousStatus,
    proposal: planSnapshotChanged
      ? null
      : (stored && Object.prototype.hasOwnProperty.call(stored, "proposal")
        ? stored.proposal
        : (candidate.proposal || null)),
    proposalSyncStatus: planSnapshotChanged
      ? "local"
      : ((stored && stored.proposalSyncStatus) || candidate.proposalSyncStatus || "cloud"),
    createdAt: normalizeRfc3339Timestamp((stored && stored.createdAt) || candidate.createdAt)
      || new Date().toISOString(),
    planUpdatedAt: planSnapshotChanged || !previousPlanUpdatedAt ? refreshedAt : previousPlanUpdatedAt,
    updatedAt: planSnapshotChanged || !previousUpdatedAt ? refreshedAt : previousUpdatedAt,
    migratedFromInviteId: migratedFromInviteId || undefined,
  });
  const written = writeInvites([localInvite].concat(invites.filter((item) => (
    getInviteId(item) !== inviteId
    && (!migratedFromInviteId || getInviteId(item) !== migratedFromInviteId)
    && (!migratedFromInviteId || item.migratedFromInviteId !== migratedFromInviteId)
  ))), inviteId);
  return written ? localInvite : null;
}

module.exports = {
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
};
