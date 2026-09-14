/**
 * timeOptionsHelper.js
 * 纯函数层：负责时段冲突比对、自定义时段评估及文案构建
 */
const planStore = require("../../utils/planStore.js");
const recommendation = require("../../utils/recommendation.js");
const { planConflictsWithSlot } = require("../../utils/recommendation/slotGenerator.js");

function planOverlapsOption(plan = {}, option = {}) {
  return planConflictsWithSlot(plan, option);
}

/**
 * 校验并标记候选时段与用户已有计划的日程冲突
 */
function attachConflictWarnings(options = [], existingPlans = []) {
  return options.map((opt) => {
    const conflict = existingPlans.find((plan) => planOverlapsOption(plan, opt));
    return Object.assign({}, opt, {
      hasConflict: Boolean(conflict),
      conflictTitle: conflict ? conflict.title : "",
    });
  });
}

/**
 * 生成推荐候选时段
 */
function generateTimeOptionsList(targetCoupon, existingPlans = []) {
  const context = recommendation.buildRecommendationContext({ existingPlans });
  const rawOptions = recommendation.generateTimeOptions(targetCoupon, context).slice(0, 4);
  return attachConflictWarnings(rawOptions, existingPlans);
}

/**
 * 评估自定义时段
 */
function evaluateCustomTimeSlot(coupon, customDate, customTime, planId, currentOptions = []) {
  if (!coupon || !customDate || !customTime) return null;
  const plan = planStore.getPlanById(planId);
  const existingPlans = planStore.getPlans().filter((item) => item.id !== (plan && plan.id));
  const context = recommendation.buildRecommendationContext({ existingPlans });
  const customOption = recommendation.evaluateCustomSlot(coupon, customDate, customTime, context);

  const enrichedCustom = attachConflictWarnings([customOption], existingPlans)[0];
  const options = currentOptions.filter((o) => o.label !== "自定义");
  options.push(enrichedCustom);

  return {
    options,
    selectedIndex: options.length - 1,
    selectedOption: enrichedCustom,
  };
}

module.exports = {
  attachConflictWarnings,
  generateTimeOptionsList,
  evaluateCustomTimeSlot,
};
