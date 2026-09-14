const couponStore = require("../../utils/couponStore.js");
const planStore = require("../../utils/planStore.js");
const friendStore = require("../../utils/friendStore.js");
const inviteService = require("../../utils/services/inviteService.js");
const storageManager = require("../../utils/storageManager.js");
const privacyService = require("../../utils/privacyService.js");
const { isActivePlanStatus } = require("../../utils/plan/planStatus.js");
const { normalizeExactId } = require("../../utils/idUtils.js");
const {
  WEEKDAYS,
  WEEKDAY_MAP,
  SELF_PARTICIPANT_ID,
  LEGACY_SELF_PARTICIPANT_ID,
  HEATMAP_SELECTION_KEY,
  MAX_HEATMAP_SCENES,
  MAX_VOTE_SLOTS,
  MAX_VOTE_OPTIONS,
  MAX_VOTERS_PER_OPTION,
  MAX_SHARED_AVAILABILITY_SLOTS,
  MAX_SHARE_PATH_LENGTH,
  ICON_EMOJI_MAP,
  PRESET_SCENES,
  DEFAULT_VOTES_MAP,
} = require("./heatmapConstants.js");
const {
  parseMin,
  timeRangesOverlap,
  getLocalDateForWeekday,
  checkFriendSlotOverlap,
  calculateHeatmapMatrix,
  getVoteNames,
} = require("./heatmapMatrix.js");
const {
  normalizeParticipantId,
  normalizeSelfId,
  normalizeVoteSlotKey,
  buildVoteSlotKey,
  isSelfParticipant,
  ensureSelfParticipant,
  loadSelectedFriendIds,
  saveSelectedFriendIds,
  getStoredVotes,
  setStoredVotes,
  initDefaultVotes,
  addVoteOption,
  toggleVoteOption,
  deleteVoteOption,
  clearVotes,
} = require("./heatmapVotes.js");

function parseInviteParams(inviteParam, selfId) {
  if (!inviteParam || typeof inviteParam !== "string" || inviteParam.length > 8192) return null;
  try {
    const inviteData = JSON.parse(storageManager.decodeBase64(inviteParam));
    if (!inviteData || typeof inviteData !== "object" || !inviteData.name || !inviteData.inviterId) return null;
    inviteData.name = typeof inviteData.name === "string" || typeof inviteData.name === "number"
      ? String(inviteData.name).trim().slice(0, 32)
      : "";
    inviteData.inviterId = normalizeSelfId(inviteData.inviterId);
    inviteData.slots = Array.isArray(inviteData.slots)
      ? [...new Set(inviteData.slots.slice(0, MAX_SHARED_AVAILABILITY_SLOTS)
        .map(friendStore.normalizeAvailabilitySlot)
        .filter(Boolean))].slice(0, MAX_SHARED_AVAILABILITY_SLOTS)
      : [];
    if (!inviteData.name || !inviteData.inviterId) return null;

    if (inviteData.name === "我" || inviteData.name === "我 (我)") inviteData.name = "好友";
    const localSelfName = String(privacyService.readLocalData("life_helper_self_name", "我") || "我");
    if (inviteData.name.toLowerCase() === localSelfName.toLowerCase()) {
      inviteData.name += " (客)";
    }
    if (inviteData.inviterId === selfId) return { isSelf: true };

    const existing = (friendStore.readFriends() || []).find((f) =>
      (f.inviterId && f.inviterId === inviteData.inviterId) || (f.name.toLowerCase() === inviteData.name.toLowerCase())
    );

    return { isSelf: false, inviteData, isInviteUpdate: !!existing, existingFriendId: existing ? existing.id : null };
  } catch (e) {
    console.error("Failed to parse invite parameter", e);
    return null;
  }
}

function buildSharePayload(selfName = "我", selfSlots = [], selfId = "") {
  const slots = Array.isArray(selfSlots)
    ? [...new Set(selfSlots.slice(0, 64).map(friendStore.normalizeAvailabilitySlot).filter(Boolean))]
    : [];
  let storedSelfId = "";
  if (!selfId) {
    try { storedSelfId = privacyService.readLocalData("life_helper_self_id", "") || ""; } catch (error) {}
  }
  const payload = {
    name: String(selfName || "我").trim().slice(0, 32) || "我",
    slots: slots.slice(0, MAX_SHARED_AVAILABILITY_SLOTS).map((item) => item.trim().slice(0, 100)),
    inviterId: normalizeSelfId(selfId || storedSelfId),
  };
  if (!payload.inviterId) return { title: "空档分享暂不可用", path: "/pages/friend-heatmap/index", imageUrl: "" };
  const buildPath = () => `/pages/friend-heatmap/index?invite=${storageManager.encodeBase64Url(JSON.stringify(payload))}`;
  let path = buildPath();
  while (payload.slots.length > 0 && path.length > MAX_SHARE_PATH_LENGTH) {
    payload.slots.pop();
    path = buildPath();
  }
  if (path.length > MAX_SHARE_PATH_LENGTH) {
    return { title: "空档分享暂不可用", path: "/pages/friend-heatmap/index", imageUrl: "" };
  }
  const countText = payload.slots.length > 0
    ? `本次共享${payload.slots.length}个空档`
    : "本次尚未填写空档";
  return {
    title: `📊 ${countText}，来看看我们哪天能约？`,
    path,
    imageUrl: ""
  };
}

function importFriendInvite(inviteData, isInviteUpdate, existingFriendId) {
  if (!inviteData) return false;
  const { name, slots = [], inviterId } = inviteData;
  if (isInviteUpdate && existingFriendId) {
    return Boolean(friendStore.updateFriend(existingFriendId, { slots, inviterId }));
  }
  const friend = friendStore.addFriend(name);
  if (friend) {
    if (friendStore.updateFriend(friend.id, { slots, inviterId })) return true;
    friendStore.removeFriend(friend.id);
  }
  return false;
}

function buildExportableSlots(scenes = [], heatmapRows = [], allVotes = {}) {
  const exportable = [];
  WEEKDAYS.forEach((day, dayIdx) => {
    scenes.forEach((scene, sceneIdx) => {
      const key = `${day}_${scene.name}`;
      const slotVotes = allVotes[key];
      if (slotVotes && slotVotes.options) {
        const voted = slotVotes.options.filter((o) => o.votes && o.votes.length).sort((a, b) => b.votes.length - a.votes.length);
        if (voted.length > 0) {
          const cell = heatmapRows[sceneIdx] && heatmapRows[sceneIdx].cells[dayIdx];
          exportable.push({
            key, day, scene: scene.name, time: scene.timeRange,
            activity: voted[0].name, attendingCount: cell ? cell.overlapCount : 0, checked: true
          });
        }
      }
    });
  });
  return exportable;
}

module.exports = {
  parseInviteParams,
  buildSharePayload,
  importFriendInvite,
  buildExportableSlots,
};
