const assert = require("assert");

const storage = new Map();
let pageDefinition = null;

global.wx = {
  getStorageSync(key) {
    return storage.get(key);
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  removeStorageSync(key) {
    storage.delete(key);
  },
  showModal() {},
  showToast() {},
  navigateBack() {},
  setClipboardData() {},
};
global.getApp = () => ({ globalData: {} });
global.Page = (definition) => {
  pageDefinition = definition;
};

const friendStore = require("../../utils/friendStore.js");
const couponStore = require("../../utils/couponStore.js");
const planStore = require("../../utils/planStore.js");
const originals = {
  readFriends: friendStore.readFriends,
  getAllCoupons: couponStore.getAllCoupons,
  upsertStoredPlan: planStore.upsertStoredPlan,
};

friendStore.readFriends = () => [];
couponStore.getAllCoupons = () => [];
let savedPlan = null;
let saveCount = 0;
planStore.upsertStoredPlan = (plan) => {
  saveCount += 1;
  savedPlan = plan;
  return plan;
};

storage.set("life_helper_heatmap_preset_key", "custom");
storage.set("life_helper_heatmap_scenes", [{
  id: "custom_late",
  name: "深夜局",
  icon: "social",
  emoji: "🍻",
  timeRange: "23:00 - 01:00",
  start: "23:00",
  end: "01:00",
}]);
storage.set("life_helper_self_slots", ["周五 深夜局 23:00-01:00"]);
storage.set("life_helper_heatmap_selected_ids", ["self"]);

require("./index.js");
assert.ok(pageDefinition, "detail page should register itself");

const page = Object.assign({}, pageDefinition, {
  data: JSON.parse(JSON.stringify(pageDefinition.data)),
  setData(patch) {
    this.data = Object.assign({}, this.data, patch);
  },
});

page.onLoad({ day: "周五", scene: "深夜局" });
page.loadDetails();
assert.strictEqual(page.data.timeRange, "23:00 - 01:00", "detail must use the stored custom scene range");
assert.strictEqual(page.data.friendStatus.length, 1);
assert.strictEqual(page.data.friendStatus[0].id, "self");

page.saveToMyPlans();
assert.ok(savedPlan);
assert.strictEqual(savedPlan.statusCode, "confirmed", "a self-only plan must be confirmed");
assert.strictEqual(saveCount, 1);

page.saveToMyPlans();
assert.strictEqual(saveCount, 1, "the saved-plan lock must prevent duplicate submissions");

page.setData({
  friendStatus: page.data.friendStatus.concat({
    id: "friend_1",
    name: "真实好友",
    isSelf: false,
    isAvailable: true,
    isSelected: true,
  }),
});
page.savedPlanId = null;
page.saveToMyPlans();
assert.strictEqual(savedPlan.statusCode, "pending", "a plan with a real pending friend must remain pending");
assert.deepStrictEqual(savedPlan.participants.map((participant) => participant.id), ["self", "friend_1"]);

page.setData({
  selectedCoupon: { id: "coupon_1", title: "双人套餐", dishes: "锅底\n牛肉" },
  planNote: "靠窗位",
  exportChecks: Object.assign({}, page.data.exportChecks, {
    includeCoupon: false,
    includeDishes: false,
    includeNote: false,
  }),
});
page.savedPlanId = null;
page.saveToMyPlans();
assert.strictEqual(savedPlan.dishes, "");
assert.ok(!savedPlan.note.includes("锅底"), "disabled dishes must not leak into the plan note");
assert.ok(!savedPlan.note.includes("靠窗位"), "disabled note must not leak into the plan note");

friendStore.readFriends = originals.readFriends;
couponStore.getAllCoupons = originals.getAllCoupons;
planStore.upsertStoredPlan = originals.upsertStoredPlan;

console.log("friend heatmap detail tests ok");
