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
  normalizeClockText,
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
const {
  parseInviteParams,
  buildSharePayload,
  importFriendInvite,
  buildExportableSlots,
} = require("./heatmapInviteCodec.js");
const {
  normalizeBulkText,
  getBulkSlotFailureKey,
  isValidBulkDate,
  normalizeBulkSlot,
  getHeatmapCell,
  formatBulkInviteText,
  saveBulkSlotsToPlans,
} = require("./heatmapBulkPlans.js");
const { resolvePlanStatus } = require("./heatmapIdentity.js");

function ensureHeatmapEnrichment() {
  // 保持好友数据纯净，由用户真实添加的好友驱动，不强插虚拟假人
  const friends = friendStore.readFriends() || [];
  const cleanFriends = friends.filter((friend = {}) => {
    const isLegacyMockFriend = ["小王", "小李", "阿强"].includes(friend.name);
    const isUserCreatedFriend = Boolean(String(friend.id || "").trim());
    return !isLegacyMockFriend || isUserCreatedFriend;
  });
  if (cleanFriends.length !== friends.length) {
    friendStore.saveFriends(cleanFriends);
  }
}

function loadInitialSelfAndFriends(selfName) {
  let selfSlots = [];
  try {
    const storedSlots = privacyService.readLocalData("life_helper_self_slots", null);
    if (Array.isArray(storedSlots)) {
      selfSlots = [...new Set(storedSlots.slice(0, 64)
        .map(friendStore.normalizeAvailabilitySlot)
        .filter(Boolean))]
        .slice(0, 64);
      if (selfSlots.length !== storedSlots.length
        || selfSlots.some((slot, index) => slot !== storedSlots[index])) {
        privacyService.writeLocalData("life_helper_self_slots", selfSlots);
      }
    }
  } catch (error) {}
  const friends = (friendStore.readFriends() || []).filter((f) => f.name !== selfName && f.name !== "我" && f.name !== "我 (我)");

  let myDisplayName = "我";
  if (selfName && selfName !== "我" && selfName !== "我 (我)") {
    myDisplayName = `${selfName} (我)`;
  } else {
    myDisplayName = "我";
  }

  return {
    selfSlots,
    combinedFriends: [{ id: SELF_PARTICIPANT_ID, name: myDisplayName, slots: selfSlots, isSelf: true }, ...friends]
  };
}

function normalizeStoredScene(scene, index = 0) {
  if (!scene || typeof scene !== "object" || Array.isArray(scene)) return null;
  const rawName = scene.name !== undefined ? scene.name : scene.title;
  if (typeof rawName !== "string") return null;
  const name = rawName.trim().slice(0, 24);
  if (!name) return null;

  const rangeMatch = String(scene.timeRange || scene.time || "").match(/(\d{1,2}:\d{2})\s*[-至到]\s*(\d{1,2}:\d{2})/);
  const start = normalizeClockText(scene.start || scene.startTime || (rangeMatch && rangeMatch[1]));
  const end = normalizeClockText(scene.end || scene.endTime || (rangeMatch && rangeMatch[2]));
  if (!start || !end || start === end) return null;

  const requestedIcon = typeof scene.icon === "string" ? scene.icon.trim() : "";
  const icon = ICON_EMOJI_MAP[requestedIcon] ? requestedIcon : "social";
  const rawId = normalizeExactId(scene.id);
  const rawEmoji = typeof scene.emoji === "string" ? scene.emoji.trim() : "";
  return {
    id: rawId || `s_migrated_${index + 1}`,
    name,
    icon,
    emoji: rawEmoji || ICON_EMOJI_MAP[icon] || "🍱",
    timeRange: `${start} - ${end}`,
    start,
    end,
  };
}

function normalizeStoredScenes(storedScenes) {
  if (!Array.isArray(storedScenes)) return [];
  const names = new Set();
  const ids = new Set();
  return storedScenes.slice(0, MAX_HEATMAP_SCENES).reduce((result, scene, index) => {
    const normalized = normalizeStoredScene(scene, index);
    if (!normalized || names.has(normalized.name)) return result;
    if (ids.has(normalized.id)) normalized.id = `s_migrated_${index + 1}`;
    if (ids.has(normalized.id)) return result;
    names.add(normalized.name);
    ids.add(normalized.id);
    result.push(normalized);
    return result;
  }, []);
}

function sceneListsEquivalent(rawScenes, normalizedScenes) {
  if (!Array.isArray(rawScenes) || rawScenes.length !== normalizedScenes.length) return false;
  const fields = ["id", "name", "icon", "emoji", "timeRange", "start", "end"];
  return rawScenes.every((scene, index) => {
    const normalized = normalizedScenes[index];
    if (!scene || typeof scene !== "object" || Array.isArray(scene) || !normalized) return false;
    if (Object.keys(scene).some((key) => !fields.includes(key))) return false;
    return fields.every((key) => String(scene[key] || "") === String(normalized[key] || ""));
  });
}

function loadStoredScenes() {
  let storedScenes = null;
  let storedPresetKey = "";
  try {
    storedScenes = privacyService.readLocalData("life_helper_heatmap_scenes", null);
    storedPresetKey = String(wx.getStorageSync("life_helper_heatmap_preset_key") || "").trim();
  } catch (error) {}
  const normalizedStoredScenes = normalizeStoredScenes(storedScenes);
  let presetKey = storedPresetKey;
  let scenes;

  if (presetKey === "custom") {
    if (normalizedStoredScenes.length) {
      scenes = normalizedStoredScenes;
    } else {
      presetKey = "default";
      scenes = normalizeStoredScenes(PRESET_SCENES.default);
    }
  } else if (PRESET_SCENES[presetKey]) {
    scenes = normalizeStoredScenes(PRESET_SCENES[presetKey]);
  } else if (normalizedStoredScenes.length) {
    presetKey = "custom";
    scenes = normalizedStoredScenes;
  } else {
    presetKey = "default";
    scenes = normalizeStoredScenes(PRESET_SCENES.default);
  }
  if (storedPresetKey !== presetKey || !sceneListsEquivalent(storedScenes, scenes)) {
    saveSceneState(scenes, presetKey);
  }
  return { scenes, presetKey };
}

function switchScenePreset(presetKey) {
  const targetScenes = PRESET_SCENES[presetKey];
  if (!targetScenes) return null;
  return saveSceneState(targetScenes, presetKey) ? targetScenes : null;
}

function createCustomScene({ name, icon, start, end }) {
  const trimmed = (name || "").trim();
  if (!trimmed) return { success: false, error: "请输入时段名称" };
  if (trimmed.length > 24) return { success: false, error: "时段名称最多 24 个字" };
  const normalizedStart = normalizeClockText(start);
  const normalizedEnd = normalizeClockText(end);
  if (!normalizedStart || !normalizedEnd || normalizedStart === normalizedEnd) {
    return { success: false, error: "开始时间和结束时间不能相同" };
  }
  return {
    success: true,
    scene: {
      id: `s_${Date.now()}`, name: trimmed, icon: ICON_EMOJI_MAP[icon] ? icon : "social",
      emoji: ICON_EMOJI_MAP[icon] || ICON_EMOJI_MAP.social,
      timeRange: `${normalizedStart} - ${normalizedEnd}`,
      start: normalizedStart,
      end: normalizedEnd,
    }
  };
}

function saveCustomScenes(scenes) {
  const normalized = normalizeStoredScenes(scenes);
  if (normalized.length !== (Array.isArray(scenes) ? scenes.length : 0)) return false;
  return saveSceneState(normalized, "custom");
}

function removeSceneById(scenes = [], id) {
  const normalizedId = normalizeExactId(id);
  if (!normalizedId || !scenes.some((scene) => scene && scene.id === normalizedId)) return null;
  const next = scenes.filter((s) => s && s.id !== normalizedId);
  return saveCustomScenes(next) ? next : null;
}

function saveSceneState(scenes, presetKey) {
  let previousScenes;
  let previousPreset;
  try {
    previousScenes = privacyService.readLocalData("life_helper_heatmap_scenes", null);
    previousPreset = wx.getStorageSync("life_helper_heatmap_preset_key");
    if (!privacyService.writeLocalData("life_helper_heatmap_scenes", scenes)) return false;
    wx.setStorageSync("life_helper_heatmap_preset_key", presetKey);
    return true;
  } catch (error) {
    try {
      privacyService.writeLocalData("life_helper_heatmap_scenes", previousScenes || []);
      wx.setStorageSync("life_helper_heatmap_preset_key", previousPreset || "default");
    } catch (rollbackError) {}
    return false;
  }
}

function addFriend(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return { success: false, error: "请输入姓名" };
  const friend = friendStore.addFriend(trimmed);
  return { success: !!friend, friend };
}

function removeFriend(id) {
  return friendStore.removeFriend(id);
}

function addFriendSlot(friendId, day, start, end) {
  const slot = friendStore.normalizeAvailabilitySlot(`${day} ${start}-${end}`);
  return slot ? friendStore.addFriendSlot(friendId, slot) : null;
}

function deleteFriendSlot(friendId, slotToDelete) {
  const friend = (friendStore.readFriends() || []).find((f) => f.id === friendId);
  if (friend) {
    return Boolean(friendStore.updateFriend(friendId, { slots: (friend.slots || []).filter((s) => s !== slotToDelete) }));
  }
  return false;
}

function updateSelfName(name) {
  const selfName = String(name || "").trim().slice(0, 24) || "我";
  return privacyService.writeLocalData("life_helper_self_name", selfName) ? selfName : null;
}

function addSelfSlot(currentSlots = [], day, start, end) {
  const slot = friendStore.normalizeAvailabilitySlot(`${day} ${start}-${end}`);
  if (!slot) return null;
  const normalizedSlots = [...new Set((Array.isArray(currentSlots) ? currentSlots : []).slice(0, 64)
    .map(friendStore.normalizeAvailabilitySlot)
    .filter(Boolean))]
    .slice(0, 64);
  if (normalizedSlots.includes(slot) || normalizedSlots.length >= 64) return null;
  const next = normalizedSlots.concat(slot);
  return privacyService.writeLocalData("life_helper_self_slots", next) ? next : null;
}

function deleteSelfSlot(currentSlots = [], slotToDelete) {
  const normalizedTarget = friendStore.normalizeAvailabilitySlot(slotToDelete);
  const next = (Array.isArray(currentSlots) ? currentSlots : []).slice(0, 64)
    .map(friendStore.normalizeAvailabilitySlot)
    .filter((slot) => slot && slot !== normalizedTarget)
    .slice(0, 64);
  return privacyService.writeLocalData("life_helper_self_slots", next) ? next : null;
}

module.exports = {
  ensureHeatmapEnrichment,
  loadInitialSelfAndFriends,
  normalizeClockText,
  normalizeStoredScene,
  normalizeStoredScenes,
  sceneListsEquivalent,
  loadStoredScenes,
  resolvePlanStatus,
  switchScenePreset,
  createCustomScene,
  saveCustomScenes,
  removeSceneById,
  saveSceneState,
  addFriend,
  removeFriend,
  addFriendSlot,
  deleteFriendSlot,
  updateSelfName,
  addSelfSlot,
  deleteSelfSlot,
};
