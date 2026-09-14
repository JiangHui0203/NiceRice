/**
 * planRepository.js
 * 履约计划本地持久化与仓储管理
 * 封装 privacyService.readLocalData / writeLocalData，支持安全透明解密与缓存
 */

const privacyService = require("../privacyService.js");
const { normalizePlan, parsePlanStart } = require("./planNormalizer.js");
const { applyRisk } = require("./planRiskEvaluator.js");

const PLAN_KEY = "life_helper_plans_v2";
const MAX_STORED_PLANS = 500;
const BULK_TRANSACTION_KIND = "plan_bulk_upsert_v1";

function readStorage(key, fallback = []) {
  const data = privacyService.readLocalData(key, fallback);
  return Array.isArray(data) ? data : fallback;
}

function isPersistedMockPlan(plan) {
  // `source: "mock"` is the marker used by the former demo seeding path.
  // Do not guess from titles or ids: those values can also belong to real plans.
  return Boolean(plan && plan.source === "mock");
}

function getStoredPlans(options = {}) {
  const settings = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const rawStored = readStorage(PLAN_KEY, []);
  const realPlans = [];
  const seenIds = new Set();
  let needsMigration = rawStored.length > MAX_STORED_PLANS;
  rawStored.slice(0, MAX_STORED_PLANS).forEach((rawPlan) => {
    const plan = normalizePlan(rawPlan);
    if (!plan || isPersistedMockPlan(plan) || seenIds.has(plan.id)) {
      needsMigration = true;
      return;
    }
    seenIds.add(plan.id);
    realPlans.push(plan);
  });

  // Best-effort migration for data written by the old demo seeding behavior.
  // Even if persistence fails, callers still receive only real plans so mock
  // entries cannot affect recommendations or be included in an export.
  if (settings.persistMigration !== false && (needsMigration || realPlans.length !== rawStored.length)) {
    privacyService.writeLocalData(PLAN_KEY, realPlans);
  }

  return realPlans;
}

function saveStoredPlans(plans = []) {
  if (!Array.isArray(plans) || plans.length > MAX_STORED_PLANS) return false;
  const realPlans = plans.map(normalizePlan);
  if (realPlans.some((plan) => !plan || isPersistedMockPlan(plan))) return false;
  const ids = realPlans.map((plan) => plan.id);
  if (new Set(ids).size !== ids.length) return false;
  return privacyService.writeLocalData(PLAN_KEY, realPlans);
}

function bulkFailure(code, details = {}) {
  return Object.assign({ success: false, code }, details);
}

/**
 * Builds a complete all-or-nothing plan-set mutation without writing storage.
 * Callers may finish cross-domain preconditions (for example coupon links)
 * before committing the prepared set exactly once.
 */
function prepareBulkUpsert(planInputs = []) {
  if (!Array.isArray(planInputs) || !planInputs.length) return bulkFailure("invalid_batch");
  if (planInputs.length > MAX_STORED_PLANS) {
    return bulkFailure("batch_limit", { maximum: MAX_STORED_PLANS });
  }

  const candidates = [];
  const candidateIds = new Set();
  for (let index = 0; index < planInputs.length; index += 1) {
    const plan = normalizePlan(planInputs[index]);
    if (!plan || isPersistedMockPlan(plan)) {
      return bulkFailure("invalid_plan", { failedIndex: index });
    }
    if (candidateIds.has(plan.id)) {
      return bulkFailure("duplicate_plan_id", { duplicateId: plan.id, failedIndex: index });
    }
    candidateIds.add(plan.id);
    candidates.push(plan);
  }

  // Do not persist read-time cleanup here. A successful bulk transaction must
  // be the operation's only plan-library write.
  const previousPlans = getStoredPlans({ persistMigration: false });
  const nextPlans = previousPlans.slice();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const existingIndex = nextPlans.findIndex((plan) => plan.id === candidate.id);
    if (existingIndex > -1) {
      if (String(nextPlans[existingIndex].couponId || "") !== String(candidate.couponId || "")) {
        return bulkFailure("coupon_relink_not_supported", {
          failedIndex: index,
          planId: candidate.id,
        });
      }
      nextPlans[existingIndex] = candidate;
    } else {
      // Match the existing single-upsert ordering: every new record is placed
      // at the front, so the last candidate is the most recent item.
      nextPlans.unshift(candidate);
    }
  }

  if (nextPlans.length > MAX_STORED_PLANS) {
    return bulkFailure("stored_plan_limit", {
      maximum: MAX_STORED_PLANS,
      currentCount: previousPlans.length,
      requestedCount: candidates.length,
    });
  }

  return {
    success: true,
    kind: BULK_TRANSACTION_KIND,
    candidates,
    previousPlans,
    nextPlans,
  };
}

function commitPreparedBulkUpsert(transaction) {
  if (!transaction
    || transaction.success !== true
    || transaction.kind !== BULK_TRANSACTION_KIND
    || !Array.isArray(transaction.candidates)
    || !transaction.candidates.length
    || !Array.isArray(transaction.nextPlans)
    || transaction.nextPlans.length > MAX_STORED_PLANS) return false;
  const seenIds = new Set();
  const normalizedPlans = [];
  for (let index = 0; index < transaction.nextPlans.length; index += 1) {
    const plan = normalizePlan(transaction.nextPlans[index]);
    if (!plan || isPersistedMockPlan(plan) || seenIds.has(plan.id)) return false;
    seenIds.add(plan.id);
    normalizedPlans.push(plan);
  }
  if (transaction.candidates.some((candidate) => !candidate || !seenIds.has(candidate.id))) return false;
  return privacyService.writeLocalData(PLAN_KEY, normalizedPlans);
}

function fetchAllPlans(context = {}, forceRefresh = false) {
  if (forceRefresh) privacyService.clearMemoryCache(PLAN_KEY);

  const stored = getStoredPlans();
  const mapped = stored.map((plan) => applyRisk(plan, context));
  mapped.sort((a, b) => parsePlanStart(a) - parsePlanStart(b));
  return mapped;
}

function invalidateCache() {
  privacyService.clearMemoryCache(PLAN_KEY);
}

module.exports = {
  MAX_STORED_PLANS,
  getStoredPlans,
  saveStoredPlans,
  prepareBulkUpsert,
  commitPreparedBulkUpsert,
  fetchAllPlans,
  invalidateCache,
};
