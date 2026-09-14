const assert = require("assert");

const storage = new Map();
global.wx = {
  getStorageSync(key) {
    return storage.get(key);
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
};

const friendStore = require("../../utils/friendStore.js");
const planStore = require("../../utils/planStore.js");
const privacyService = require("../../utils/privacyService.js");
const {
  buildSharePayload,
  calculateHeatmapMatrix,
  ensureHeatmapEnrichment,
  getLocalDateForWeekday,
  getStoredVotes,
  loadInitialSelfAndFriends,
  loadStoredScenes,
  loadSelectedFriendIds,
  parseInviteParams,
  parseMin,
  saveBulkSlotsToPlans,
  timeRangesOverlap,
  resolvePlanStatus,
} = require("./heatmapHelper.js");

const customScenes = [
  { id: "custom_late", name: "深夜局", start: "23:00", end: "01:00", timeRange: "23:00 - 01:00" },
];
storage.set("life_helper_heatmap_preset_key", "custom");
storage.set("life_helper_heatmap_scenes", customScenes);
const normalizedCustomState = loadStoredScenes();
assert.strictEqual(normalizedCustomState.presetKey, "custom");
assert.deepStrictEqual(normalizedCustomState.scenes[0], {
  id: "custom_late",
  name: "深夜局",
  icon: "social",
  emoji: "🍻",
  start: "23:00",
  end: "01:00",
  timeRange: "23:00 - 01:00",
});

storage.delete("life_helper_heatmap_preset_key");
storage.set("life_helper_heatmap_scenes", [
  { title: "旧版早茶", time: "7:05 至 9:30", icon: "breakfast" },
  { name: "损坏时间", start: "25:00", end: "26:00" },
  null,
]);
privacyService.clearMemoryCache("life_helper_heatmap_scenes");
const migratedLegacyState = loadStoredScenes();
assert.strictEqual(migratedLegacyState.presetKey, "custom");
assert.deepStrictEqual(migratedLegacyState.scenes, [{
  id: "s_migrated_1",
  name: "旧版早茶",
  icon: "breakfast",
  emoji: "🥐",
  timeRange: "07:05 - 09:30",
  start: "07:05",
  end: "09:30",
}]);

storage.set("life_helper_heatmap_preset_key", "legacy_custom_v1");
storage.set("life_helper_heatmap_scenes", [{ name: "旧版夜场", startTime: "20:00", endTime: "23:30" }]);
privacyService.clearMemoryCache("life_helper_heatmap_scenes");
const migratedPresetState = loadStoredScenes();
assert.strictEqual(migratedPresetState.presetKey, "custom");
assert.strictEqual(migratedPresetState.scenes[0].timeRange, "20:00 - 23:30");

storage.set("life_helper_heatmap_preset_key", "custom");
storage.set("life_helper_heatmap_scenes", "损坏的场景结构");
privacyService.clearMemoryCache("life_helper_heatmap_scenes");
const recoveredSceneState = loadStoredScenes();
assert.strictEqual(recoveredSceneState.presetKey, "default");
assert.deepStrictEqual(recoveredSceneState.scenes.map((scene) => scene.name), ["午餐", "下午茶", "晚餐"]);
assert.strictEqual(resolvePlanStatus([{ id: "self", status: "confirmed" }], true), "confirmed");
assert.strictEqual(resolvePlanStatus([{ id: "friend_self", status: "confirmed" }], true), "confirmed");
assert.strictEqual(resolvePlanStatus([
  { id: "self", status: "confirmed" },
  { id: "friend_1", status: "pending" },
], true), "pending");
assert.strictEqual(resolvePlanStatus([{ id: "friend_1", status: "pending" }], false), "confirmed");

const initialPeople = loadInitialSelfAndFriends("我").combinedFriends;
assert.strictEqual(initialPeople[0].id, "self", "heatmap self identity must match the plan domain");
storage.set("life_helper_heatmap_selected_ids", []);
assert.deepStrictEqual(loadSelectedFriendIds(initialPeople), [], "an explicit empty selection must remain empty");
storage.set("life_helper_heatmap_selected_ids", ["friend_self"]);
privacyService.clearMemoryCache("life_helper_heatmap_selected_ids");
assert.deepStrictEqual(loadSelectedFriendIds(initialPeople), ["self"], "legacy self selections should migrate");

storage.set("life_helper_slot_votes", {
  "周一_午餐": { options: [{ id: "vote_1", name: "午餐", votes: ["friend_self", "self"] }] },
});
assert.deepStrictEqual(getStoredVotes()["周一_午餐"].options[0].votes, ["self"]);

assert.strictEqual(parseMin("00:00"), 0);
assert.strictEqual(parseMin("24:00"), null);
assert.strictEqual(timeRangesOverlap("18:00", "20:00", "19:00", "21:00"), true);
assert.strictEqual(timeRangesOverlap("18:00", "20:00", "20:00", "21:00"), false);
assert.strictEqual(timeRangesOverlap("22:30", "02:00", "23:00", "01:00"), true);
assert.strictEqual(timeRangesOverlap("bad", "02:00", "23:00", "01:00"), false);
assert.strictEqual(
  getLocalDateForWeekday("周五", "02:00", "22:30", new Date(2026, 7, 28, 3, 0)),
  "2026-08-28",
  "a cross-midnight scene later the same day must not jump a week",
);
assert.strictEqual(
  getLocalDateForWeekday("周五", "02:00", "22:30", new Date(2026, 7, 29, 1, 0)),
  "2026-08-28",
  "an active cross-midnight scene must retain its start date",
);
assert.strictEqual(
  getLocalDateForWeekday("周五", "02:00", "22:30", new Date(2026, 7, 29, 3, 0)),
  "2026-09-04",
  "an ended cross-midnight scene should advance to next week",
);

const originalGetPlans = planStore.getPlans;
let getPlansCalls = 0;
planStore.getPlans = () => {
  getPlansCalls += 1;
  return [];
};

const matrix = calculateHeatmapMatrix(
  [{ id: "self", name: "我", slots: ["周一 12:00-14:00"] }],
  [{ id: "lunch", name: "午餐", start: "12:00", end: "14:00", timeRange: "12:00 - 14:00" }],
  {},
  { "周一_午餐": { id: "plan_1", title: "海底捞套餐" } },
);

assert.strictEqual(getPlansCalls, 0, "矩阵计算不应读取 planStore");
assert.strictEqual(matrix[0].cells[0].overlapCount, 1);
assert.deepStrictEqual(matrix[0].cells[0].winningOptions, ["📌海底捞"]);
assert.strictEqual(matrix[0].cells[0].availableFriends[0].id, "self");
planStore.getPlans = originalGetPlans;

const originalGetStoredPlans = planStore.getStoredPlans;
const originalBulkUpsertPlans = planStore.bulkUpsertPlans;
const storedPlans = [];
planStore.getStoredPlans = () => [];
planStore.bulkUpsertPlans = (plans) => {
  storedPlans.push(...plans);
  return { success: true, successIds: plans.map((plan) => plan.id), plans };
};
const bulkSlot = [{ day: "周一", scene: "午餐", time: "12:00 - 14:00", activity: "一起吃饭" }];
const bulkScenes = [{ name: "午餐" }];
saveBulkSlotsToPlans(bulkSlot, bulkScenes, [{ cells: [{ availableFriends: [] }] }], true);
assert.strictEqual(storedPlans[0].statusCode, "confirmed");
assert.deepStrictEqual(storedPlans[0].participants.map((participant) => participant.id), ["self"]);

saveBulkSlotsToPlans(bulkSlot, bulkScenes, [{ cells: [{ availableFriends: [{ id: "friend_1", name: "小李" }] }] }], true);
assert.strictEqual(storedPlans[1].statusCode, "pending");
assert.deepStrictEqual(storedPlans[1].participants.map((participant) => participant.id), ["self", "friend_1"]);
planStore.getStoredPlans = originalGetStoredPlans;
planStore.bulkUpsertPlans = originalBulkUpsertPlans;

const malformedSlotsShare = buildSharePayload("小明", "不是数组", "self_1");
assert.ok(malformedSlotsShare.path);
const numericNameInvite = buildSharePayload(123, ["周五 18:00-20:00", null], "other_1");
const inviteParam = numericNameInvite.path.split("invite=")[1];
assert.doesNotThrow(() => parseInviteParams(inviteParam, "self_1"));

privacyService.writeLocalData("life_helper_friends", [
  { id: "custom_1", name: "小李", slots: [] },
  { id: "friend_real_xiaowang", name: "小王", slots: [] },
  { name: "小王", slots: [] },
  { id: null, name: "阿强", slots: [] },
  { id: "friend_1", name: "真实好友", slots: [] },
]);

assert.doesNotThrow(() => ensureHeatmapEnrichment());
assert.deepStrictEqual(
  friendStore.readFriends().map((friend) => friend.name),
  ["小李", "小王", "真实好友"],
);

console.log("friend heatmap helper tests ok");
