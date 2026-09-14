const assert = require("assert");
const {
  buildInviteShareText,
  buildSimulatedFriendDraft,
} = require("./collaborationShareHelper.js");

const text = buildInviteShareText("小明", ["周六 14:00 - 17:30"]);
assert.ok(text.includes("【小明】"));
assert.ok(text.includes("• 🕒 周六 14:00-17:30"));
assert.ok(buildInviteShareText("", []).includes("尚未填写本周空档"));

const draft = buildSimulatedFriendDraft([{ name: "小李" }], { random: () => 0.99 });
assert.strictEqual(draft.name, "阿强");
assert.strictEqual(draft.slots.length, 3);
const fallback = buildSimulatedFriendDraft(
  ["小李", "阿强", "小雅", "大伟", "晓敏"].map((name) => ({ name })),
  { random: () => 0 }
);
assert.strictEqual(fallback.name, "好友6");

console.log("friend heatmap collaboration share helper tests ok");
