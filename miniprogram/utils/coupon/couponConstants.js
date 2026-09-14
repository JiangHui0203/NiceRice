const STATUS_ALIAS_MAP = {
  草稿: "draft",
  待安排: "pending",
  未安排: "pending",
  已推荐: "pending",
  待确认: "pending",
  已安排: "planned",
  已使用: "used",
  已核销: "used",
  已过期: "expired",
  draft: "draft",
  pending: "pending",
  unplanned: "pending",
  recommended: "pending",
  planned: "planned",
  used: "used",
  completed: "used",
  completed_used: "used",
  expired: "expired",
};

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_MAP = { 一: "mon", 二: "tue", 三: "wed", 四: "thu", 五: "fri", 六: "sat", 日: "sun", 天: "sun" };

const DEFAULT_DURATIONS = {
  粉面: 60,
  咖啡甜品: 75,
  火锅: 150,
  烧烤: 150,
  烤肉: 150,
  电影: 150,
  展览: 150,
  博物馆: 150,
  公园: 180,
  户外: 180,
  温泉: 240,
};

const DAY_MATCHERS = [
  { pattern: /工作日可用|仅工作日|周一至周五|周一到周五/, days: ["mon", "tue", "wed", "thu", "fri"] },
  { pattern: /周末可用|仅周末|周六周日/, days: ["sat", "sun"] },
];

const UNAVAILABLE_DAY_MATCHERS = [
  { pattern: /周末不可用|周六不可用|周日不可用/, days: ["sat", "sun"] },
  { pattern: /周一不可用/, days: ["mon"] },
  { pattern: /周二不可用/, days: ["tue"] },
  { pattern: /周三不可用/, days: ["wed"] },
  { pattern: /周四不可用/, days: ["thu"] },
  { pattern: /周五不可用/, days: ["fri"] },
];

const REFUND_TYPE_RULES = [
  { pattern: /不可退|过期不退/, type: "non_refundable" },
  { pattern: /手动退|随时退/, type: "manual" },
  { pattern: /部分退|手续费/, type: "partial" },
];

const STATIC_STATE_MAP = {
  draft: { state: "草稿", stateClass: "draft" },
  pending: { state: "待安排", stateClass: "pending" },
  planned: { state: "已安排", stateClass: "planned" },
  used: { state: "已使用", stateClass: "used" },
  expired: { state: "已过期", stateClass: "expired" },
};

const REFUND_TYPES = new Set(["unknown", "auto", "manual", "partial", "non_refundable"]);
const RESERVATION_STATUSES = new Set(["not_required", "required", "pending", "confirmed", "failed", "unknown"]);

module.exports = {
  STATUS_ALIAS_MAP,
  DAY_ORDER,
  DAY_MAP,
  DEFAULT_DURATIONS,
  DAY_MATCHERS,
  UNAVAILABLE_DAY_MATCHERS,
  REFUND_TYPE_RULES,
  STATIC_STATE_MAP,
  REFUND_TYPES,
  RESERVATION_STATUSES,
};
