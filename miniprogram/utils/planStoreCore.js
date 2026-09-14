/**
 * planStore.js
 * 计划履约数据层（Facade 门面）
 * 串联 planNormalizer (模型转换与清洗)、planRiskEvaluator (风险评估规则链) 与 planRepository (本地仓储与缓存)
 */

const normalizer = require("./plan/planNormalizer.js");
const riskEvaluator = require("./plan/planRiskEvaluator.js");
const repository = require("./plan/planRepository.js");
const eventLogger = require("./eventLogger.js");

const VALID_TRANSITIONS = Object.freeze({
  pending: Object.freeze(["confirmed", "rescheduled", "cancelled"]),
  confirmed: Object.freeze(["completed", "rescheduled", "cancelled", "pending"]),
  // A user can change the time more than once before the plan is completed.
  rescheduled: Object.freeze(["confirmed", "completed", "cancelled", "rescheduled"]),
  completed: Object.freeze([]),
  // The detail page explicitly supports arranging cancelled plans again.
  cancelled: Object.freeze(["pending", "confirmed", "rescheduled"]),
  // Drafts can be arranged or cancelled, but cannot be completed before they
  // have become an actionable plan.
  draft: Object.freeze(["pending", "confirmed", "rescheduled", "cancelled"]),
  // `expired` can be a live risk-derived state rather than a persisted state.
  // A passed plan explicitly asks the user to confirm whether it happened;
  // completing it must remain possible without persisting the derived status.
  expired: Object.freeze(["completed", "cancelled", "pending", "rescheduled"]),
});

const VALID_STATUS_CODES = new Set(Object.keys(VALID_TRANSITIONS));

function asValidStatusCode(value) {
  if (typeof value !== "string") return "";
  const statusCode = value.trim();
  return VALID_STATUS_CODES.has(statusCode) ? statusCode : "";
}

function canTransitionPlanStatus(fromStatus, toStatus) {
  const source = asValidStatusCode(fromStatus);
  const target = asValidStatusCode(toStatus);
  return Boolean(source && target && VALID_TRANSITIONS[source].includes(target));
}

function getPlans(context = {}, forceRefresh = false) {
  return repository.fetchAllPlans(context, forceRefresh);
}

function getStoredPlans(options = {}) {
  return repository.getStoredPlans(options);
}

function saveStoredPlans(plans) {
  return repository.saveStoredPlans(plans);
}

function findPlan(id) {
  if (!id) return null;
  const list = getPlans({}, true);
  return list.find((item) => item.id === id) || null;
}

function findStoredPlan(id) {
  if (typeof id !== "string" || !id || id !== id.trim()) return null;
  return repository.getStoredPlans().find((item) => item.id === id) || null;
}

function getPlanById(id) {
  return findPlan(id);
}

function getPlan(id) {
  return findPlan(id);
}

module.exports = {
  VALID_TRANSITIONS,
  VALID_STATUS_CODES,
  asValidStatusCode,
  canTransitionPlanStatus,
  getPlans,
  getStoredPlans,
  saveStoredPlans,
  findPlan,
  findStoredPlan,
  getPlanById,
  getPlan,
};
