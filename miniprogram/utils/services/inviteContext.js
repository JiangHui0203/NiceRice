const INVITE_KEY = "life_helper_plan_invites";
const INVITE_TOMBSTONE_KEY = "life_helper_plan_invite_tombstones";
const MAX_STORED_INVITES = 100;
const MAX_PENDING_INVITE_TOMBSTONES = 1000;
const MAX_TOMBSTONE_FLUSH_BATCH = 20;
const TOMBSTONE_FLUSH_CONCURRENCY = 2;
const MAX_TRACKED_PENDING_INVITE_CREATES = 200;
const pendingInviteCreateIds = new Set();
const knownInvalidInviteIds = new Set();
const INVITE_STATUSES = new Set(["pending", "confirmed", "rejected"]);
const SHAREABLE_PLAN_STATUSES = new Set(["pending", "confirmed", "rescheduled"]);
const RESERVATION_STATUSES = new Set(["unknown", "not_required", "required", "pending", "confirmed", "failed"]);
const REQUIRED_RESERVATION_STATUSES = new Set(["required", "pending", "confirmed", "failed"]);
const PERMANENT_CREATE_ERROR_CODES = new Set([
  "invite_id_conflict",
  "invite_terminal",
  "invalid_status",
  "invite_changed",
  "invite_conflict",
  "invite_expired",
  "invite_revoked",
  "invalid_invite_id",
  "invalid_invite",
  "invalid_plan",
  "invalid_plan_status",
  "invalid_plan_version",
  "invalid_record",
  "invalid_request",
  "invalid_selected_time",
  "missing_plan",
  "missing_invite",
  "not_found",
  "request_too_large",
  "unauthorized",
]);
const PERMANENT_STATUS_ERROR_CODES = new Set([
  "invalid_role",
  "unauthorized",
  "invalid_status",
  "invalid_invite_id",
  "invalid_invite",
  "invalid_plan",
  "invalid_plan_status",
  "invalid_plan_version",
  "invalid_proposal",
  "invalid_record",
  "invalid_request",
  "invalid_selected_time",
  "invite_changed",
  "invite_already_claimed",
  "invite_conflict",
  "invite_expired",
  "invite_revoked",
  "invite_terminal",
  "missing_plan",
  "missing_invite",
  "no_changes",
  "not_found",
  "request_too_large",
]);
const PERMANENT_DELETE_ERROR_CODES = new Set([
  "unauthorized",
  "invalid_role",
  "missing_invite",
  "invalid_invite_id",
  "invalid_request",
  "request_too_large",
]);
const PERMANENT_PLAN_UPDATE_ERROR_CODES = new Set([
  "invalid_role",
  "unauthorized",
  "invalid_status",
  "invalid_plan",
  "invalid_plan_status",
  "invalid_plan_version",
  "invalid_record",
  "invalid_selected_time",
  "invalid_invite_id",
  "invalid_invite",
  "invite_changed",
  "invite_conflict",
  "invite_id_conflict",
  "invite_terminal",
  "invite_already_claimed",
  "invite_expired",
  "invite_revoked",
  "missing_invite",
  "missing_plan",
  "no_changes",
  "not_found",
  "invalid_proposal",
  "invalid_request",
  "request_too_large",
]);

function rememberInvalidInviteId(inviteId) {
  if (!inviteId) return;
  knownInvalidInviteIds.add(inviteId);
  while (knownInvalidInviteIds.size > 200) {
    knownInvalidInviteIds.delete(knownInvalidInviteIds.values().next().value);
  }
}

function trackPendingInviteCreate(inviteId) {
  pendingInviteCreateIds.add(inviteId);
  while (pendingInviteCreateIds.size > MAX_TRACKED_PENDING_INVITE_CREATES) {
    pendingInviteCreateIds.delete(pendingInviteCreateIds.values().next().value);
  }
}

module.exports = {
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
};
