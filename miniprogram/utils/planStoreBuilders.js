/**
 * planStore.js
 * 计划履约数据层（Facade 门面）
 * 串联 planNormalizer (模型转换与清洗)、planRiskEvaluator (风险评估规则链) 与 planRepository (本地仓储与缓存)
 */

const normalizer = require("./plan/planNormalizer.js");
const riskEvaluator = require("./plan/planRiskEvaluator.js");
const repository = require("./plan/planRepository.js");
const eventLogger = require("./eventLogger.js");
const {
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
} = require("./planStoreCore.js");
const {
  createPlan,
  restoreCouponSnapshots,
  bulkUpsertPlans,
} = require("./planStoreTransaction.js");

function upsertStoredPlan(planData, options = {}) {
  return createPlan(planData, options);
}

function savePlan(planData, options = {}) {
  return createPlan(planData, options);
}

function buildPlanFromRecommendation(coupon = {}, rec = {}, participants = [], options = {}) {
  const plan = normalizer.createPlanFromRecommendation(coupon, rec, participants, options);
  if (plan && options.temporaryDirectUse === true) plan.temporaryDirectUse = true;
  return plan;
}

function createPlanFromRecommendation(coupon = {}, rec = {}, participants = [], options = {}) {
  return createPlan(buildPlanFromRecommendation(coupon, rec, participants, options), options);
}

function restorePlanSnapshot(snapshot) {
  if (!snapshot || !snapshot.id) return false;
  const persistedStatusCode = typeof riskEvaluator.getPersistedStatusCode === "function"
    ? asValidStatusCode(riskEvaluator.getPersistedStatusCode(snapshot))
    : "";
  const durableSnapshot = persistedStatusCode && snapshot.statusCode === "expired"
    ? Object.assign({}, snapshot, { statusCode: persistedStatusCode })
    : snapshot;
  const current = repository.getStoredPlans();
  const index = current.findIndex((item) => item.id === durableSnapshot.id);
  if (index > -1) current[index] = durableSnapshot;
  else current.unshift(durableSnapshot);
  return repository.saveStoredPlans(current);
}

function removeTemporaryDirectUsePlan(id, couponId = "") {
  if (!id) return false;
  const current = repository.getStoredPlans();
  const index = current.findIndex((item) => item.id === id);
  if (index < 0) return true;
  const plan = current[index];
  const isExpectedCoupon = !couponId || plan.couponId === couponId;
  // Completed records are history and must never be removed by a late retry.
  if (plan.temporaryDirectUse !== true || !isExpectedCoupon || plan.statusCode === "completed") return false;
  current.splice(index, 1);
  return repository.saveStoredPlans(current);
}

function removeImportedPlan(id, couponId = "") {
  if (!id) return false;
  const current = repository.getStoredPlans();
  const index = current.findIndex((item) => item.id === id);
  if (index < 0) return true;
  const plan = current[index];
  if (plan.isImported !== true || (couponId && plan.couponId !== couponId)) return false;
  const next = current.slice();
  next.splice(index, 1);
  return repository.saveStoredPlans(next);
}

function createManualPlanFromSpin(candidate = {}, options = {}) {
  const title = String(candidate.title || "").trim();
  if (!title) return null;
  const candidateScore = candidate.score !== "" ? Number(candidate.score) : NaN;

  const selectedTime = options.selectedTime || {
    date: "",
    weekday: "",
    startTime: "待定",
    endTime: "",
    scene: "自定义",
    label: "时间待定",
  };
  const statusCode = options.statusCode || (options.selectedTime ? "confirmed" : "draft");

  return createPlan({
    id: `plan_spin_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    couponId: "",
    title,
    category: candidate.categoryKey || candidate.category || "other",
    statusCode,
    selectedTime,
    location: {
      name: "待定",
      address: "",
      distanceText: "待估算",
    },
    participants: [{ id: "self", name: "我", status: "confirmed" }],
    recommendationSnapshot: {
      score: Number.isFinite(candidateScore) ? candidateScore : null,
      level: candidate.level || "custom",
      reasons: [candidate.reason || "由今天吃啥转盘选中"],
      warnings: [],
    },
    note: "由今天吃啥转盘生成",
    changeLogs: [{
      type: "created",
      text: options.selectedTime ? "已从转盘生成并安排时间。" : "已从转盘生成，等待选择时间。",
      createdAt: normalizer.nowText(),
    }],
  });
}

module.exports = {
  upsertStoredPlan,
  savePlan,
  buildPlanFromRecommendation,
  createPlanFromRecommendation,
  restorePlanSnapshot,
  removeTemporaryDirectUsePlan,
  removeImportedPlan,
  createManualPlanFromSpin,
};
