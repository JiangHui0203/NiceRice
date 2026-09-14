const ACTIVE_PLAN_STATUSES = Object.freeze([
  "draft",
  "pending",
  "confirmed",
  "rescheduled",
  "risky",
]);

function isActivePlanStatus(statusCode) {
  return ACTIVE_PLAN_STATUSES.includes(String(statusCode || ""));
}

module.exports = {
  ACTIVE_PLAN_STATUSES,
  isActivePlanStatus,
};
