const assert = require("assert");
const {
  buildActiveCell,
  buildPlanSlotMap,
  buildSceneCouponCache,
  findPlanForSlot,
  getRecommendedCoupons,
} = require("./heatmapViewHelper.js");

const scenes = [
  { name: "下午茶", emoji: "☕", start: "14:00", end: "17:00", timeRange: "14:00 - 17:00" },
  { name: "晚餐", emoji: "🍽️", start: "18:00", end: "21:00", timeRange: "18:00 - 21:00" },
];
const heatmapRows = [
  { cells: [{ overlapCount: 2, friendStatus: [{ name: "小李" }] }] },
  { cells: [{ overlapCount: 1 }] },
];
const cell = buildActiveCell({
  heatmapRows,
  scenes,
  weekdays: ["周六"],
  dayIndex: 0,
  sceneIndex: 0,
});
assert.strictEqual(cell.day, "周六");
assert.strictEqual(cell.scene, "下午茶");
assert.strictEqual(cell.friendStatus.length, 1);
assert.strictEqual(buildActiveCell({ heatmapRows: [], scenes, weekdays: ["周六"], dayIndex: 0, sceneIndex: 0 }), null);

const plans = [
  { id: "p1", selectedTime: { label: "周六 下午茶", scene: "下午茶" } },
  { id: "p2", selectedTime: { label: "周日 18:00", scene: "晚餐" } },
];
assert.strictEqual(findPlanForSlot(plans, "周日", "晚餐").id, "p2");
const planMap = buildPlanSlotMap(plans, ["周六", "周日"], scenes);
assert.strictEqual(planMap["周六_下午茶"].id, "p1");
assert.strictEqual(planMap["周日_晚餐"].id, "p2");

const coupons = [
  { id: "coffee", type: "咖啡甜品", stateClass: "normal", score: 99 },
  { id: "play", type: "其他", category: "play", stateClass: "urgent", score: 1 },
  { id: "food", type: "火锅", stateClass: "priority", score: 80 },
  { id: "used", type: "咖啡甜品", statusCode: "used", stateClass: "urgent" },
];
assert.deepStrictEqual(getRecommendedCoupons(coupons, "下午茶").map((item) => item.id), ["play", "coffee"]);
assert.deepStrictEqual(getRecommendedCoupons(coupons, "晚餐").map((item) => item.id), ["play", "food"]);
const couponCache = buildSceneCouponCache(coupons, scenes);
assert.strictEqual(couponCache["下午茶"].length, 2);

console.log("friend heatmap view helper tests ok");
