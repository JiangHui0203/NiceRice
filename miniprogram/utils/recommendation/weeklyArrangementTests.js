const assert = require("assert");
const { generateWeeklyArrangement } = require("./weeklyArrangement.js");

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateText(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date, amount) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + amount);
  return next;
}

const coupons = [
  { id: "existing", title: "火锅", venue: "老店", type: "火锅", category: "food", heavy: true },
  { id: "first", title: "牛肉面", venue: "新店", type: "粉面", category: "food" },
  { id: "occupied", title: "咖啡", venue: "咖啡店", type: "咖啡甜品", category: "drink" },
  { id: "duplicateVenue", title: "新店甜品", venue: "新店", type: "咖啡甜品", category: "drink" },
  { id: "blocked", title: "户外票", venue: "公园", type: "公园", category: "outdoor" },
];
const recommendations = [
  { couponId: "first", recommendedTime: { date: "2026-08-25", weekday: "周二", scene: "午餐" }, score: 90, reasons: ["合适"] },
  { couponId: "occupied", recommendedTime: { date: "2026-08-25", weekday: "周二", scene: "午餐" }, score: 80, reasons: [] },
  { couponId: "duplicateVenue", recommendedTime: { date: "2026-08-26", weekday: "周三", scene: "下午" }, score: 70, reasons: [] },
];
const context = {
  now: new Date("2026-08-24T10:00:00"),
  existingPlans: [{
    id: "plan1",
    couponId: "existing",
    title: "已定火锅",
    statusCode: "confirmed",
    selectedTime: { date: "2026-08-24", weekday: "周一", scene: "晚餐" },
  }],
};

const result = generateWeeklyArrangement(coupons, context, {
  addDays,
  dateText,
  generateRecommendations: () => recommendations.concat({
    couponId: "blocked",
    level: "blocked",
    blockers: ["下雨"],
  }),
  getCategory: (coupon) => coupon.category,
  getCouponType: (coupon) => coupon.type,
  isHeavyMeal: (coupon) => Boolean(coupon.heavy),
  now: () => 123,
  pad,
});

assert.strictEqual(result.id, "batch_123");
assert.deepStrictEqual(result.range, { startDate: "2026-08-24", endDate: "2026-08-30" });
assert.deepStrictEqual(result.items.map((item) => item.couponId), ["existing", "first"]);
assert.strictEqual(result.conflicts.length, 2);
assert.ok(result.conflicts.some((item) => item.couponId === "occupied"));
assert.ok(result.conflicts.some((item) => item.couponId === "duplicateVenue"));
assert.deepStrictEqual(result.unscheduledCoupons, [{ couponId: "blocked", reason: "下雨" }]);

console.log("weekly arrangement tests ok");
