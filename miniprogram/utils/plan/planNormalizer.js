const part1 = require("./planConstants.js");
const part2 = require("./planBaseNormalizer.js");
const part3 = require("./planPolicyNormalizer.js");
const part4 = require("./planSnapshotNormalizer.js");
const part5 = require("./planModelSupport.js");
const part6 = require("./planModelNormalizer.js");
const part7 = require("./planBuilder.js");

const parts = Object.assign({}, part1, part2, part3, part4, part5, part6, part7);

module.exports = {
  STATUS_META: parts.STATUS_META,
  STATUS_ALIAS_MAP: parts.STATUS_ALIAS_MAP,
  WEEKDAYS: parts.WEEKDAYS,
  nowText: parts.nowText,
  normalizeStatus: parts.normalizeStatus,
  statusLabel: parts.statusLabel,
  statusClass: parts.statusClass,
  buildLocationFromCoupon: parts.buildLocationFromCoupon,
  selectedTimeFromLegacy: parts.selectedTimeFromLegacy,
  parsePlanStart: parts.parsePlanStart,
  normalizePlan: parts.normalizePlan,
  createPlanFromRecommendation: parts.createPlanFromRecommendation,
};
