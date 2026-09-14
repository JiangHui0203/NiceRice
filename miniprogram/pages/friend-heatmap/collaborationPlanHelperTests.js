const assert = require("assert");
const {
  buildCandidateSlotPlan,
  buildCouponSlotPlan,
  buildParticipants,
  buildSlotScheduleText,
  findBestAvailableCell,
} = require("./collaborationPlanHelper.js");

const friends = [{ id: "a", name: "小李" }, { id: "b", name: "小王" }];
const participants = buildParticipants(friends, ["a", "b"], [{ name: "小李" }]);
assert.deepStrictEqual(participants.map((item) => item.id), ["self", "a", "b"]);
assert.deepStrictEqual(participants.map((item) => item.status), ["confirmed", "pending", "pending"]);

const couponPlan = buildCouponSlotPlan({
  coupon: { id: "c1", title: "火锅", venue: "火锅店" },
  activeCell: { day: "周六", scene: "晚餐", start: "18:00", end: "21:00", availableFriends: [{ name: "小李" }] },
  friends,
  selectedFriendIds: ["a", "b"],
  now: () => 123,
});
assert.strictEqual(couponPlan.id, "plan_hm_123");
assert.strictEqual(couponPlan.statusCode, "pending");
assert.strictEqual(couponPlan.participants[1].status, "pending");

const selfOnlyPlan = buildCouponSlotPlan({
  coupon: { id: "c_self", title: "自己吃饭" },
  activeCell: { day: "周六", scene: "晚餐", start: "18:00", end: "21:00", availableFriends: [] },
  friends: [{ id: "self", name: "我", isSelf: true }],
  selectedFriendIds: ["self"],
  now: () => 124,
});
assert.strictEqual(selfOnlyPlan.statusCode, "confirmed");
assert.deepStrictEqual(selfOnlyPlan.participants.map((item) => item.id), ["self"]);

const fallback = findBestAvailableCell([{ cells: [{
  activeClass: "level-full",
  day: "周日",
  sceneName: "下午茶",
  start: "14:00",
  end: "17:00",
}] }]);
assert.strictEqual(fallback.scene, "下午茶");

const candidate = buildCandidateSlotPlan({
  selectedCustom: { title: "桌游" },
  heatmapRows: [{ cells: [{
    activeClass: "level-full",
    day: "周日",
    sceneName: "下午茶",
    start: "14:00",
    end: "17:00",
  }] }],
  friends,
  selectedFriendIds: ["a"],
  now: () => 456,
});
assert.strictEqual(candidate.plan.id, "plan_cand_456");
assert.strictEqual(candidate.plan.title, "桌游");
assert.strictEqual(candidate.day, "周日");
assert.strictEqual(candidate.plan.statusCode, "pending");

const scheduleText = buildSlotScheduleText({
  activeCell: { day: "周六", scene: "晚餐", timeRange: "18:00-21:00", availableFriends: [{ name: "小李" }] },
  friends,
  selectedFriendIds: ["a", "b"],
  recommendedCoupons: [{ title: "烤肉", venue: "一号店", price: "99" }],
});
assert.ok(scheduleText.includes("小王"));
assert.ok(scheduleText.includes("烤肉"));

console.log("friend heatmap collaboration plan helper tests ok");
