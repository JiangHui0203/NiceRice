const STATUS_META = {
  pending: { label: "待确认", className: "pending" },
  confirmed: { label: "已确认", className: "confirmed" },
  completed: { label: "已完成", className: "completed" },
  rescheduled: { label: "已改期", className: "rescheduled" },
  cancelled: { label: "已取消", className: "cancelled" },
  draft: { label: "草稿", className: "draft" },
  expired: { label: "已过期", className: "expired" },
};

const STATUS_ALIAS_MAP = {
  待确认: "pending",
  已确认: "confirmed",
  已完成: "completed",
  已改期: "rescheduled",
  已取消: "cancelled",
  草稿: "draft",
  已过期: "expired",
  pending: "pending",
  confirmed: "confirmed",
  completed: "completed",
  used: "completed",
  completed_used: "completed",
  rescheduled: "rescheduled",
  cancelled: "cancelled",
  expired: "expired",
  risky: "confirmed",
};

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const ACTIVE_SCHEDULE_STATUSES = new Set(["pending", "confirmed", "rescheduled"]);
const PARTICIPANT_STATUSES = new Set(["pending", "confirmed", "rejected"]);
const RESERVATION_STATUSES = new Set(["unknown", "not_required", "required", "pending", "confirmed", "failed"]);
const REFUND_TYPES = new Set(["unknown", "auto", "manual", "partial", "non_refundable"]);
const RECOMMENDATION_LEVELS = new Set([
  "blocked", "high", "medium", "low", "custom", "unknown", "pending", "coupon_match", "collaboration",
]);
const RISK_LEVELS = new Set(["none", "low", "medium", "high", "blocked"]);
const SCORE_BREAKDOWN_KEYS = [
  "urgency", "schedule", "timePreference", "timeOfDayAffinity", "weather", "distance",
  "preference", "cleanup", "reservation", "tasteFatigue", "discountValue",
];
const DAY_ALIASES = {
  mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat", sun: "sun",
  周一: "mon", 周二: "tue", 周三: "wed", 周四: "thu", 周五: "fri", 周六: "sat", 周日: "sun", 周天: "sun",
};

module.exports = {
  STATUS_META,
  STATUS_ALIAS_MAP,
  WEEKDAYS,
  ACTIVE_SCHEDULE_STATUSES,
  PARTICIPANT_STATUSES,
  RESERVATION_STATUSES,
  REFUND_TYPES,
  RECOMMENDATION_LEVELS,
  RISK_LEVELS,
  SCORE_BREAKDOWN_KEYS,
  DAY_ALIASES,
};
