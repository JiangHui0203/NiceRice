const assert = require("assert");

const storage = new Map();
global.wx = {
  getStorageSync(key) {
    return storage.get(key);
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  showToast() {},
};
global.getApp = () => ({ globalData: {} });

const planStore = require("../../utils/planStore.js");
const couponStore = require("../../utils/couponStore.js");
const friendStore = require("../../utils/friendStore.js");
const privacyService = require("../../utils/privacyService.js");

const originalGetPlans = planStore.getPlans;
const originalGetCoupons = couponStore.getAllCoupons;
let getPlansCalls = 0;
let getCouponsCalls = 0;

planStore.getPlans = () => {
  getPlansCalls += 1;
  return [{
    id: "plan_1",
    title: "海底捞套餐",
    selectedTime: { label: "周一 午餐", scene: "午餐" },
  }];
};
couponStore.getAllCoupons = () => {
  getCouponsCalls += 1;
  return [];
};

let pageConfig = null;
global.Page = (config) => {
  pageConfig = config;
};
require("./index.js");

const page = Object.assign({}, pageConfig, {
  data: Object.assign({}, pageConfig.data, {
    friends: [{ id: "self", name: "我", slots: ["周一 12:00-14:00"], selected: true }],
    scenes: [{ id: "lunch", name: "午餐", start: "12:00", end: "14:00", timeRange: "12:00 - 14:00" }],
    activeDayIdx: 0,
    activeSceneIdx: 0,
  }),
});
page.setData = function setData(patch, callback) {
  Object.assign(this.data, patch || {});
  if (typeof callback === "function") callback.call(this);
};

page.calculateHeatmap();

assert.strictEqual(getPlansCalls, 1, "每次热力图重算只应读取一次计划");
assert.strictEqual(getCouponsCalls, 1, "每次热力图重算只应读取一次优惠券");
assert.strictEqual(page.planSlotMap["周一_午餐"].id, "plan_1");
assert.deepStrictEqual(page.data.heatmapRows[0].cells[0].winningOptions, ["📌海底捞"]);
assert.strictEqual(page.data.activeCellPlan.id, "plan_1");

storage.delete("life_helper_heatmap_selected_ids");
const selectionPage = Object.assign({}, pageConfig, {
  data: Object.assign({}, pageConfig.data),
});
selectionPage.setData = page.setData;
selectionPage.loadData();
assert.ok(selectionPage.data.selectedFriendIds.includes("self"));
selectionPage.toggleSelectAll();
assert.deepStrictEqual(privacyService.readLocalData("life_helper_heatmap_selected_ids", null), []);

const reopenedPage = Object.assign({}, pageConfig, {
  data: Object.assign({}, pageConfig.data, { selectedFriendIds: [] }),
});
reopenedPage.setData = page.setData;
reopenedPage.loadData();
assert.deepStrictEqual(reopenedPage.data.selectedFriendIds, [], "reopening must preserve select-none");

privacyService.clearMemoryCache();
friendStore.saveFriends([]);
storage.set("life_helper_heatmap_selected_ids", ["self"]);
const importPage = Object.assign({}, pageConfig, {
  data: Object.assign({}, pageConfig.data, {
    selectedFriendIds: ["self"],
    inviteData: { name: "新好友", inviterId: "invite_new_friend", slots: ["周六 14:00-17:30"] },
    isInviteUpdate: false,
    existingFriendId: null,
  }),
});
importPage.setData = page.setData;
importPage.confirmImportInvite();
const importedFriend = friendStore.readFriends().find((friend) => friend.inviterId === "invite_new_friend");
assert.ok(importedFriend && importedFriend.id, "import should persist the new friend");
assert.ok(
  privacyService.readLocalData("life_helper_heatmap_selected_ids", []).includes(importedFriend.id),
  "imported friend should be selected for the heatmap as promised by the success message"
);

const candidatePage = Object.assign({}, pageConfig, {
  data: Object.assign({}, pageConfig.data),
});
candidatePage.setData = page.setData;
candidatePage.loadData = () => {};
let candidateDrawerOpenCount = 0;
let openedSharedCandidates = null;
candidatePage.openSharedCandidateDrawer = (sharedCandidates) => {
  candidateDrawerOpenCount += 1;
  openedSharedCandidates = sharedCandidates;
};
const sharedCandidatePayload = encodeURIComponent(JSON.stringify({
  v: 1,
  i: [{ t: "桌游", s: "u" }],
}));
candidatePage.onLoad({ mode: "candidates", candidates: sharedCandidatePayload });
assert.ok(candidatePage._pendingSharedCandidates, "onLoad should retain valid shared candidates for onShow");
assert.strictEqual(candidateDrawerOpenCount, 0, "onLoad must not mutate the drawer before the page is shown");
candidatePage.onShow();
assert.strictEqual(candidateDrawerOpenCount, 1, "onShow should open the pending shared-candidate drawer");
assert.strictEqual(candidatePage._pendingSharedCandidates, null, "shared candidates should be consumed once");
assert.strictEqual(openedSharedCandidates.customCandidates[0].title, "桌游");
candidatePage.onShow();
assert.strictEqual(candidateDrawerOpenCount, 1, "repeated onShow must not reopen an already-consumed share");

const unloadedCandidatePage = Object.assign({}, pageConfig, {
  data: Object.assign({}, pageConfig.data),
});
unloadedCandidatePage.setData = page.setData;
unloadedCandidatePage.loadData = () => {};
let unloadedDrawerOpenCount = 0;
unloadedCandidatePage.openSharedCandidateDrawer = () => {
  unloadedDrawerOpenCount += 1;
};
unloadedCandidatePage.onLoad({ mode: "candidates", candidates: sharedCandidatePayload });
unloadedCandidatePage.onUnload();
unloadedCandidatePage.onShow();
assert.strictEqual(unloadedDrawerOpenCount, 0, "an unloaded page must not open shared-candidate UI");

planStore.getPlans = originalGetPlans;
couponStore.getAllCoupons = originalGetCoupons;

console.log("friend heatmap page tests ok");
