const part1 = require("./couponConstants.js");
const part2 = require("./couponBaseNormalizer.js");
const part3 = require("./couponTimeRules.js");
const part4 = require("./couponUsageRules.js");
const part5 = require("./couponPresentation.js");
const part6 = require("./couponMediaNormalizer.js");
const part7 = require("./couponModelNormalizer.js");

const parts = Object.assign({}, part1, part2, part3, part4, part5, part6, part7);

module.exports = {
  normalizeDateText: parts.normalizeDateText,
  getExactDateTimestamp: parts.getExactDateTimestamp,
  daysBetween: parts.daysBetween,
  expireText: parts.expireText,
  normalizeStatus: parts.normalizeStatus,
  normalizeClockText: parts.normalizeClockText,
  validateUsableTimeText: parts.validateUsableTimeText,
  parseTimeRange: parts.parseTimeRange,
  getDefaultDuration: parts.getDefaultDuration,
  parseDayRules: parts.parseDayRules,
  normalizePeopleCount: parts.normalizePeopleCount,
  buildUsageRules: parts.buildUsageRules,
  buildRefundInfo: parts.buildRefundInfo,
  computeCouponLifeState: parts.computeCouponLifeState,
  computeCouponLifeProgress: parts.computeCouponLifeProgress,
  formatUsedAt: parts.formatUsedAt,
  computeDiscountText: parts.computeDiscountText,
  buildCouponNotices: parts.buildCouponNotices,
  sanitizeStoredScreenshots: parts.sanitizeStoredScreenshots,
  normalizeCoupon: parts.normalizeCoupon,
  buildCoupon: parts.buildCoupon,
};
