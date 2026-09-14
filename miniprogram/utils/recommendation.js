/**
 * Recommendation Engine Façade
 * 统一智能排程与优惠券推荐算法门面
 * 
 * 模块架构分拆：
 * - ./recommendation/slotGenerator.js   : 候选时段生成器、时间工具与冲突检测
 * - ./recommendation/weatherScorer.js  : 气象亲和度模型与极端天气评估
 * - ./recommendation/preferenceScorer.js : 紧急度、距离、口味疲劳、清洁缓冲、预约等子评分器
 * - ./recommendation/scoringEngine.js   : 多维调度微内核、综合评分与周排程组合
 */

const slotGenerator = require("./recommendation/slotGenerator.js");
const weatherScorer = require("./recommendation/weatherScorer.js");
const preferenceScorer = require("./recommendation/preferenceScorer.js");
const scoringEngine = require("./recommendation/scoringEngine.js");

module.exports = {
  // 1. 核心上下文与方案生成 (Core Context & Recommendations)
  buildRecommendationContext: scoringEngine.buildRecommendationContext,
  buildHumanReadableRationale: scoringEngine.buildHumanReadableRationale,
  generateCandidateSlots: slotGenerator.generateCandidateSlots,
  generateTimeOptions: scoringEngine.generateTimeOptions,
  generateRecommendation: scoringEngine.generateRecommendation,
  generateRecommendations: scoringEngine.generateRecommendations,
  getTopRecommendations: scoringEngine.getTopRecommendations,
  getRecommendationByCouponId: scoringEngine.getRecommendationByCouponId,
  mergeCouponRecommendation: scoringEngine.mergeCouponRecommendation,
  generateWeeklyArrangement: scoringEngine.generateWeeklyArrangement,
  evaluateCustomSlot: scoringEngine.evaluateCustomSlot,
  scoreSlot: scoringEngine.scoreSlot,
  getLevel: scoringEngine.getLevel,
  normalizeStatusLabel: scoringEngine.normalizeStatusLabel,
  buildReasonItems: scoringEngine.buildReasonItems,
  getHighlightTags: scoringEngine.getHighlightTags,
  classifyWarnings: scoringEngine.classifyWarnings,
  getPostDiningSuggestion: scoringEngine.getPostDiningSuggestion,

  // 2. 气象亲和度算法 (Weather Scoring)
  getSlotWeather: weatherScorer.getSlotWeather,
  isIndoorFriendly: weatherScorer.isIndoorFriendly,
  isOutdoor: weatherScorer.isOutdoor,
  isHeavyMeal: weatherScorer.isHeavyMeal,
  scoreWeather: weatherScorer.scoreWeather,

  // 3. 偏好与约束子评分器 (Preferences & Sub-Scorers)
  scoreUrgency: preferenceScorer.scoreUrgency,
  scoreDiscountValue: preferenceScorer.scoreDiscountValue,
  scoreSchedule: preferenceScorer.scoreSchedule,
  scoreDistance: preferenceScorer.scoreDistance,
  scorePreference: preferenceScorer.scorePreference,
  scoreTimePreference: preferenceScorer.scoreTimePreference,
  scoreCleanup: preferenceScorer.scoreCleanup,
  scoreTasteFatigue: preferenceScorer.scoreTasteFatigue,
  scoreReservation: preferenceScorer.scoreReservation,
  getDurationMinutes: preferenceScorer.getDurationMinutes,
  getCleanupMinutes: preferenceScorer.getCleanupMinutes,
  getNeedReservation: preferenceScorer.getNeedReservation,
  getReservationStatus: preferenceScorer.getReservationStatus,
  getUsageRules: preferenceScorer.getUsageRules,
  getRefundInfo: preferenceScorer.getRefundInfo,

  // 4. 时段与冲突工具 (Slot Generator Utilities)
  WEEKDAYS: slotGenerator.WEEKDAYS,
  DAY_KEYS: slotGenerator.DAY_KEYS,
  SCENE_SLOTS: slotGenerator.SCENE_SLOTS,
  TYPE_SCENES: slotGenerator.TYPE_SCENES,
  pad: slotGenerator.pad,
  dateText: slotGenerator.dateText,
  dateTime: slotGenerator.dateTime,
  slotDateTime: slotGenerator.slotDateTime,
  expireEndTime: slotGenerator.expireEndTime,
  addDays: slotGenerator.addDays,
  daysUntil: slotGenerator.daysUntil,
  parseNumber: slotGenerator.parseNumber,
  timeToMinutes: slotGenerator.timeToMinutes,
  minutesToTime: slotGenerator.minutesToTime,
  rangesOverlap: slotGenerator.rangesOverlap,
  rangeContains: slotGenerator.rangeContains,
  isActivePlan: slotGenerator.isActivePlan,
  planConflictsWithSlot: slotGenerator.planConflictsWithSlot,
  getExistingPlanConflict: slotGenerator.getExistingPlanConflict,
  isSlotAllowedByRules: slotGenerator.isSlotAllowedByRules,
  getCouponType: slotGenerator.getCouponType,
};
