const friendStore = require("../../utils/friendStore.js");

const DEFAULT_MOCK_NAMES = ["小李", "阿强", "小雅", "大伟", "晓敏"];
const DEFAULT_MOCK_SLOTS = [
  "周五 18:00 - 22:00",
  "周六 14:00 - 17:30",
  "周日 12:00 - 14:00",
  "周六 18:00 - 22:00",
];

function buildInviteShareText(selfName = "我", selfSlots = []) {
  const name = String(selfName || "我").trim().slice(0, 24) || "我";
  const slots = [...new Set((Array.isArray(selfSlots) ? selfSlots : []).slice(0, 64)
    .map(friendStore.normalizeAvailabilitySlot)
    .filter(Boolean))]
    .slice(0, 64);
  const slotText = slots.length
    ? slots.map((slot) => `• 🕒 ${slot}`).join("\n")
    : "• 尚未填写本周空档";

  return [
    `👋 嗨！我是【${name}】`,
    "这是我本周的空档时间安排：",
    "--------------------------------",
    slotText,
    "--------------------------------",
    "打开小程序「有时好饭」，一起来比对空档时间、挑选餐厅聚餐吧！🎯",
  ].join("\n");
}

function buildSimulatedFriendDraft(existingFriends = [], options = {}) {
  const mockNames = options.mockNames || DEFAULT_MOCK_NAMES;
  const presetSlots = options.presetSlots || DEFAULT_MOCK_SLOTS;
  const random = typeof options.random === "function" ? options.random : Math.random;
  const name = mockNames.find((candidate) => (
    !existingFriends.some((friend) => String(friend.name || "").includes(candidate))
  )) || `好友${existingFriends.length + 1}`;
  const slotCount = Math.min(presetSlots.length, 2 + Math.floor(random() * 2));
  return { name, slots: presetSlots.slice(0, slotCount) };
}

module.exports = {
  buildInviteShareText,
  buildSimulatedFriendDraft,
};
