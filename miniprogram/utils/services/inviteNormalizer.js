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

function boundedText(value, maxLength) {
  return String(value === undefined || value === null ? "" : value)
    .slice(0, maxLength * 2)
    .trim()
    .slice(0, maxLength);
}

function normalizeInviteTombstone(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const inviteId = normalizeInviteId(item.inviteId);
  if (!inviteId) return null;
  return {
    inviteId,
    deletedAt: boundedText(item.deletedAt, 40),
    remoteDeleted: item.remoteDeleted === true,
    remoteDeleteBlocked: item.remoteDeleteBlocked === true,
    remoteDeleteError: boundedText(item.remoteDeleteError, 64),
  };
}

function normalizeInviteId(value) {
  const text = String(value === undefined || value === null ? "" : value).slice(0, 192).trim();
  if (!text || text.length > 96 || !/^[A-Za-z0-9_-]{6,96}$/.test(text)) return "";
  return text;
}

function isLegacyInviteId(value) {
  const inviteId = normalizeInviteId(value);
  return Boolean(inviteId && inviteId.indexOf("invite_") === 0);
}

function isStrongInviteId(value) {
  return /^inv_[a-z0-9]{6,16}_[a-z0-9]{24,64}$/.test(normalizeInviteId(value));
}

function normalizePlanId(value) {
  const text = String(value === undefined || value === null ? "" : value).slice(0, 192).trim();
  return text && text.length <= 96 ? text : "";
}

function normalizeSnapshotDate(value) {
  const text = boundedText(value, 32);
  const matched = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!matched) return "";
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeSnapshotClock(value) {
  const text = boundedText(value, 32);
  const matched = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return "";
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeRfc3339Timestamp(value) {
  if (value === undefined || value === null || value === "") return "";
  if (value instanceof Date && !Number.isFinite(value.getTime())) return "";
  const text = value instanceof Date ? value.toISOString() : boundedText(value, 40);
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/);
  if (!matched) return "";
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
    || timezoneHour > 23 || timezoneMinute > 59) return "";
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function createCapabilityToken() {
  // Invite IDs are public capabilities embedded in share cards. Prefer the
  // platform cryptographic RNG when exposed; the long PRNG fallback only
  // preserves compatibility with older JS runtimes.
  try {
    const cryptoApi = typeof globalThis !== "undefined" && globalThis.crypto;
    if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    }
  } catch (error) {}
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 13).padEnd(11, "0")).join("");
}

function createStrongInviteId() {
  return `inv_${Date.now().toString(36)}_${createCapabilityToken()}`;
}

function buildInvite(plan, friendName = "朋友") {
  if (!plan || typeof plan !== "object" || !normalizePlanId(plan.id)) return null;
  const inviteId = createStrongInviteId();
  const createdAt = new Date().toISOString();
  const planSnapshot = buildPlanSnapshot(plan);
  if (!isShareablePlanSnapshot(planSnapshot)) return null;
  const safeFriendName = boundedText(friendName || "朋友", 24) || "朋友";
  return {
    id: inviteId,
    inviteId,
    planId: planSnapshot.id,
    couponId: planSnapshot.couponId || "",
    title: planSnapshot.title || "",
    selectedTime: planSnapshot.selectedTime || {},
    planSnapshot,
    friendName: safeFriendName,
    status: "pending",
    message: `${safeFriendName}待确认这个计划`,
    sharePath: `/pages/plan-detail/index?id=${encodeURIComponent(planSnapshot.id)}&inviteId=${inviteId}&friend=${encodeURIComponent(safeFriendName)}`,
    syncStatus: "local",
    planUpdatedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  };
}

function getInviteId(invite = {}) {
  const value = invite || {};
  return normalizeInviteId(value.inviteId || value.id);
}

function responseMatchesInviteId(response, inviteId) {
  if (!response || typeof response !== "object" || Array.isArray(response)) return false;
  return normalizeInviteId(response.inviteId || response.id || response._id) === inviteId;
}

function buildPlanSnapshot(plan = {}) {
  const snapshot = {};
  [
    "id", "couponId", "title", "category", "statusCode", "venue", "address",
    "travelTime", "durationMinutes", "needReservation", "reservationStatus",
    "revision", "updatedAt", "createdAt",
  ].forEach((key) => {
    if (plan[key] !== undefined && plan[key] !== null) snapshot[key] = plan[key];
  });
  snapshot.id = normalizePlanId(plan.id);
  snapshot.couponId = boundedText(plan.couponId, 96);
  snapshot.title = boundedText(plan.title, 64);
  snapshot.category = boundedText(plan.category, 24);
  const statusCode = boundedText(plan.statusCode || "pending", 24);
  snapshot.statusCode = SHAREABLE_PLAN_STATUSES.has(statusCode) ? statusCode : "";
  snapshot.venue = boundedText(plan.venue, 64);
  snapshot.address = boundedText(plan.address, 160);
  snapshot.travelTime = boundedText(plan.travelTime, 32);
  const hasDuration = plan.durationMinutes !== undefined
    && plan.durationMinutes !== null
    && plan.durationMinutes !== "";
  const durationMinutes = hasDuration ? Number(plan.durationMinutes) : NaN;
  snapshot.durationMinutes = Number.isFinite(durationMinutes) && durationMinutes >= 1
    ? Math.min(7 * 24 * 60, Math.round(durationMinutes))
    : undefined;
  const rawReservationStatus = boundedText(plan.reservationStatus, 24);
  if (REQUIRED_RESERVATION_STATUSES.has(rawReservationStatus)) {
    snapshot.reservationStatus = rawReservationStatus;
    snapshot.needReservation = true;
  } else if (rawReservationStatus === "not_required") {
    snapshot.reservationStatus = "not_required";
    snapshot.needReservation = false;
  } else if (plan.needReservation === true) {
    snapshot.reservationStatus = "required";
    snapshot.needReservation = true;
  } else if (plan.needReservation === false) {
    snapshot.reservationStatus = "not_required";
    snapshot.needReservation = false;
  } else {
    snapshot.reservationStatus = "unknown";
    delete snapshot.needReservation;
  }
  snapshot.updatedAt = normalizeRfc3339Timestamp(plan.updatedAt);
  snapshot.createdAt = normalizeRfc3339Timestamp(plan.createdAt);
  if (snapshot.revision !== undefined) {
    const revision = Number(snapshot.revision);
    snapshot.revision = Number.isSafeInteger(revision) && revision >= 0 && revision <= 1000000000
      ? revision
      : undefined;
  }
  if (plan.selectedTime && typeof plan.selectedTime === "object") {
    snapshot.selectedTime = {};
    ["weekday", "scene", "label"].forEach((key) => {
      if (plan.selectedTime[key] !== undefined && plan.selectedTime[key] !== null) {
        snapshot.selectedTime[key] = boundedText(plan.selectedTime[key], key === "label" ? 64 : 32);
      }
    });
    if (plan.selectedTime.date !== undefined && plan.selectedTime.date !== null) {
      snapshot.selectedTime.date = normalizeSnapshotDate(plan.selectedTime.date);
    }
    ["startTime", "endTime"].forEach((key) => {
      if (plan.selectedTime[key] !== undefined && plan.selectedTime[key] !== null) {
        // Draft plans historically used the display sentinel "待定" here.
        // Cloud snapshots keep an empty value instead of presenting it as a
        // provider-confirmed clock time.
        snapshot.selectedTime[key] = normalizeSnapshotClock(plan.selectedTime[key]);
      }
    });
  }
  if (plan.location && typeof plan.location === "object") {
    snapshot.location = {
      name: boundedText(plan.location.name || plan.venue, 64),
      address: boundedText(plan.location.address || plan.address, 160),
    };
  }
  return snapshot;
}

function isShareablePlanSnapshot(snapshot = {}) {
  if (!normalizePlanId(snapshot.id) || !boundedText(snapshot.title, 64)) return false;
  if (!SHAREABLE_PLAN_STATUSES.has(snapshot.statusCode)) return false;
  const selectedTime = snapshot.selectedTime || {};
  if (!normalizeSnapshotDate(selectedTime.date) || !normalizeSnapshotClock(selectedTime.startTime)) return false;
  if (selectedTime.endTime && (!normalizeSnapshotClock(selectedTime.endTime)
    || selectedTime.endTime === selectedTime.startTime)) return false;
  if (selectedTime.weekday) {
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const parts = selectedTime.date.split("-").map(Number);
    const expected = weekdays[new Date(parts[0], parts[1] - 1, parts[2]).getDay()];
    if (!weekdays.includes(selectedTime.weekday) || selectedTime.weekday !== expected) return false;
  }
  const reservationStatus = String(snapshot.reservationStatus || "");
  if (!RESERVATION_STATUSES.has(reservationStatus)) return false;
  if (REQUIRED_RESERVATION_STATUSES.has(reservationStatus) && snapshot.needReservation !== true) return false;
  if (reservationStatus === "not_required" && snapshot.needReservation !== false) return false;
  if (reservationStatus === "unknown" && typeof snapshot.needReservation === "boolean") return false;
  if (snapshot.durationMinutes !== undefined) {
    const durationMinutes = Number(snapshot.durationMinutes);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080) return false;
  }
  if (snapshot.revision !== undefined) {
    const revision = Number(snapshot.revision);
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > 1000000000) return false;
  }
  if (snapshot.updatedAt && normalizeRfc3339Timestamp(snapshot.updatedAt) !== snapshot.updatedAt) return false;
  if (snapshot.createdAt && normalizeRfc3339Timestamp(snapshot.createdAt) !== snapshot.createdAt) return false;
  return true;
}

function buildSelectedTimeSnapshot(selectedTime = {}) {
  return buildPlanSnapshot({ id: "time_snapshot", selectedTime }).selectedTime || {};
}

function hasValidReservationTriState(snapshot = {}) {
  const reservationStatus = snapshot.reservationStatus;
  if (!RESERVATION_STATUSES.has(reservationStatus)) return false;
  if (REQUIRED_RESERVATION_STATUSES.has(reservationStatus)) return snapshot.needReservation === true;
  if (reservationStatus === "not_required") return snapshot.needReservation === false;
  return reservationStatus === "unknown" && typeof snapshot.needReservation !== "boolean";
}

function sanitizeRemoteInvite(remote, stableInviteId, options = {}) {
  if (!responseMatchesInviteId(remote, stableInviteId)) return null;
  const rawSnapshot = remote.planSnapshot && typeof remote.planSnapshot === "object" && !Array.isArray(remote.planSnapshot)
    ? remote.planSnapshot
    : {};
  if (!options.allowLegacyNormalization) {
    if (!SHAREABLE_PLAN_STATUSES.has(rawSnapshot.statusCode)
      || !hasValidReservationTriState(rawSnapshot)
      || (rawSnapshot.updatedAt && !normalizeRfc3339Timestamp(rawSnapshot.updatedAt))
      || (rawSnapshot.createdAt && !normalizeRfc3339Timestamp(rawSnapshot.createdAt))) return null;
  }
  const planId = normalizePlanId(remote.planId || rawSnapshot.id);
  if (!planId) return null;
  const selectedTime = buildSelectedTimeSnapshot(remote.selectedTime || rawSnapshot.selectedTime || {});
  const planSnapshot = buildPlanSnapshot(Object.assign({}, rawSnapshot, {
    id: planId,
    couponId: remote.couponId !== undefined ? remote.couponId : rawSnapshot.couponId,
    title: remote.title !== undefined ? remote.title : rawSnapshot.title,
    selectedTime,
  }));
  if (!isShareablePlanSnapshot(planSnapshot)) return null;
  const status = INVITE_STATUSES.has(remote.status)
    ? remote.status
    : (options.allowLegacyNormalization ? "pending" : "");
  if (!status) return null;
  const planUpdatedAt = normalizeRfc3339Timestamp(remote.planUpdatedAt);
  const createdAt = normalizeRfc3339Timestamp(remote.createdAt);
  const updatedAt = normalizeRfc3339Timestamp(remote.updatedAt);
  const expiresAt = normalizeRfc3339Timestamp(remote.expiresAt);
  if (!options.allowLegacyNormalization && ((remote.planUpdatedAt && !planUpdatedAt)
    || (remote.createdAt && !createdAt)
    || (remote.updatedAt && !updatedAt)
    || (remote.expiresAt && !expiresAt))) return null;
  const sanitized = {
    id: stableInviteId,
    inviteId: stableInviteId,
    planId,
    couponId: planSnapshot.couponId,
    title: planSnapshot.title,
    selectedTime,
    planSnapshot,
    friendName: boundedText(remote.friendName || "朋友", 24) || "朋友",
    status,
    planUpdatedAt,
    createdAt,
    updatedAt,
    expiresAt,
    hasResponder: Boolean(remote.hasResponder),
    respondedByCurrentUser: Boolean(remote.respondedByCurrentUser),
  };
  const rawProposal = remote.proposal && typeof remote.proposal === "object" && !Array.isArray(remote.proposal)
    ? remote.proposal
    : null;
  if (rawProposal) {
    const proposalTime = buildSelectedTimeSnapshot(rawProposal.selectedTime || {});
    const proposalCreatedAt = normalizeRfc3339Timestamp(rawProposal.createdAt);
    sanitized.proposal = isValidProposalTime(proposalTime) && proposalCreatedAt
      ? {
        selectedTime: proposalTime,
        createdAt: proposalCreatedAt,
      }
      : null;
  } else {
    sanitized.proposal = null;
  }
  return sanitized;
}

function sanitizeStoredInvite(invite) {
  if (!invite || typeof invite !== "object" || Array.isArray(invite)) return null;
  // The downstream sanitizer is an explicit whitelist; copying the entire
  // stored object here would transiently retain arbitrary/private payloads.
  const stripped = invite;
  const inviteId = getInviteId(stripped);
  if (!inviteId) return null;
  const base = sanitizeRemoteInvite(stripped, inviteId, { allowLegacyNormalization: true });
  if (!base) return null;
  const syncStatus = stripped.syncStatus === "cloud" ? "cloud" : "local";
  const statusSyncStatus = stripped.statusSyncStatus === "cloud" ? "cloud" : "local";
  const proposalSyncStatus = stripped.proposalSyncStatus === "local" ? "local" : "cloud";
  return Object.assign({}, base, {
    message: boundedText(stripped.message, 80) || `${base.friendName || "朋友"}待确认这个计划`,
    sharePath: `/pages/plan-detail/index?id=${encodeURIComponent(base.planId)}&inviteId=${inviteId}&friend=${encodeURIComponent(base.friendName || "朋友")}`,
    syncStatus,
    statusSyncStatus,
    proposalSyncStatus,
    migratedFromInviteId: isLegacyInviteId(stripped.migratedFromInviteId)
      && stripped.migratedFromInviteId !== inviteId
      ? normalizeInviteId(stripped.migratedFromInviteId)
      : undefined,
  });
}

function isValidProposalTime(selectedTime = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedTime.date || "")
    || !/^\d{2}:\d{2}$/.test(selectedTime.startTime || "")) return false;
  const [year, month, day] = selectedTime.date.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const [hour, minute] = selectedTime.startTime.split(":").map(Number);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
    || hour > 23 || minute > 59) return false;
  if (selectedTime.endTime) {
    if (!/^\d{2}:\d{2}$/.test(selectedTime.endTime)) return false;
    const [endHour, endMinute] = selectedTime.endTime.split(":").map(Number);
    if (endHour > 23 || endMinute > 59) return false;
  }
  return true;
}

function sameSnapshot(left, right) {
  try {
    return JSON.stringify(left || {}) === JSON.stringify(right || {});
  } catch (error) {
    return false;
  }
}

function buildInviteContentFingerprint(snapshot = {}) {
  const value = snapshot && typeof snapshot === "object" ? snapshot : {};
  return {
    id: value.id || "",
    couponId: value.couponId || "",
    title: value.title || "",
    category: value.category || "",
    venue: value.venue || "",
    address: value.address || "",
    travelTime: value.travelTime || "",
    durationMinutes: value.durationMinutes || "",
    needReservation: typeof value.needReservation === "boolean" ? value.needReservation : null,
    reservationStatus: value.reservationStatus || "",
    selectedTime: value.selectedTime || {},
    location: value.location || {},
  };
}

function comparePlanVersions(left = {}, right = {}) {
  const leftValue = String(left.planUpdatedAt || "");
  const rightValue = String(right.planUpdatedAt || "");
  if (leftValue === rightValue) return 0;
  const leftTimestamp = Date.parse(leftValue);
  const rightTimestamp = Date.parse(rightValue);
  if (Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp)) {
    if (leftTimestamp === rightTimestamp) return 0;
    return leftTimestamp > rightTimestamp ? 1 : -1;
  }
  if (Number.isFinite(leftTimestamp)) return 1;
  if (Number.isFinite(rightTimestamp)) return -1;
  return leftValue > rightValue ? 1 : -1;
}

function nextPlanUpdatedAt(previousValue) {
  const canonicalPrevious = normalizeRfc3339Timestamp(previousValue);
  const previousTimestamp = Date.parse(canonicalPrevious || "");
  const timestamp = Number.isFinite(previousTimestamp)
    ? Math.max(Date.now(), previousTimestamp + 1)
    : Date.now();
  return new Date(timestamp).toISOString();
}

// Sharing callbacks must return synchronously, so the local record is created
// before any cloud request starts. Reusing the same id also keeps a card that
// was shared while offline valid after the cloud sync completes.

module.exports = {
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
};
