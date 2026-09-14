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
  isSelfParticipant,
  ensureSelfParticipant,
} = require("./heatmapIdentity.js");


function normalizeVoteSlotKey(value) {
  if (typeof value !== "string" || value !== value.trim()) return "";
  const matched = value.match(/^(周[一二三四五六日])_(.+)$/);
  if (!matched) return "";
  const scene = normalizeExactId(matched[2], 32);
  return scene ? `${matched[1]}_${scene}` : "";
}

function buildVoteSlotKey(day, scene) {
  if (!WEEKDAYS.includes(day)) return "";
  const normalizedScene = normalizeExactId(scene, 32);
  return normalizedScene ? `${day}_${normalizedScene}` : "";
}

function loadSelectedFriendIds(friends = []) {
  const availableIds = (Array.isArray(friends) ? friends : []).slice(0, 101)
    .map((friend) => friend && (friend.id || friend.name))
    .map(normalizeParticipantId)
    .filter(Boolean);
  const availableSet = new Set(availableIds);
  let stored = null;
  try {
    stored = privacyService.readLocalData(HEATMAP_SELECTION_KEY, null);
  } catch (error) {
    return availableIds;
  }
  if (!Array.isArray(stored)) return availableIds;
  const normalized = [...new Set(stored.slice(0, 101)
    .map(normalizeParticipantId)
    .filter((id) => id && availableSet.has(id)))];
  if (normalized.length !== stored.length || normalized.some((id, index) => id !== stored[index])) {
    privacyService.writeLocalData(HEATMAP_SELECTION_KEY, normalized);
  }
  return normalized;
}

function saveSelectedFriendIds(ids = []) {
  const normalized = [...new Set((Array.isArray(ids) ? ids : []).slice(0, 101)
    .map(normalizeParticipantId)
    .filter(Boolean))]
    .slice(0, 101);
  return privacyService.writeLocalData(HEATMAP_SELECTION_KEY, normalized) ? normalized : null;
}

function getStoredVotes() {
  let stored = null;
  try { stored = privacyService.readLocalData("life_helper_slot_votes", null); } catch (error) {}
  const rawVotes = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  const allVotes = {};
  let migrated = false;
  const seenSlotKeys = new Set();
  const rawKeys = Object.keys(rawVotes);
  if (rawKeys.length > MAX_VOTE_SLOTS) migrated = true;
  const inspectedRawKeys = rawKeys.slice(0, MAX_VOTE_SLOTS * 4);
  if (inspectedRawKeys.length !== rawKeys.length) migrated = true;
  inspectedRawKeys.forEach((rawSlotKey, slotIndex) => {
    const slotKey = normalizeVoteSlotKey(rawSlotKey);
    if (!slotKey) {
      migrated = true;
      return;
    }
    if (slotKey !== rawSlotKey || seenSlotKeys.has(slotKey)) {
      migrated = true;
      if (seenSlotKeys.has(slotKey)) return;
    }
    const rawOptions = rawVotes[rawSlotKey] && rawVotes[rawSlotKey].options;
    if (!Array.isArray(rawOptions)) {
      migrated = true;
      return;
    }
    if (seenSlotKeys.size >= MAX_VOTE_SLOTS) {
      migrated = true;
      return;
    }
    seenSlotKeys.add(slotKey);
    if (rawOptions.length > MAX_VOTE_OPTIONS) migrated = true;
    const seenIds = new Set();
    const seenNames = new Set();
    const options = rawOptions.slice(0, MAX_VOTE_OPTIONS).reduce((result, option, optionIndex) => {
      if (!option || typeof option !== "object" || Array.isArray(option)) {
        migrated = true;
        return result;
      }
      const name = String(option.name || "").trim().slice(0, 40);
      let id = normalizeExactId(option.id);
      if (!name) {
        migrated = true;
        return result;
      }
      if (!id) {
        id = `opt_migrated_${slotIndex}_${optionIndex}`;
        migrated = true;
      }
      const normalizedName = name.toLowerCase();
      if (seenIds.has(id) || seenNames.has(normalizedName)) {
        migrated = true;
        return result;
      }
      seenIds.add(id);
      seenNames.add(normalizedName);
      const rawOptionVotes = Array.isArray(option.votes) ? option.votes : [];
      const votes = [...new Set(rawOptionVotes.slice(0, MAX_VOTERS_PER_OPTION)
        .map(normalizeParticipantId)
        .filter(Boolean))]
        .slice(0, MAX_VOTERS_PER_OPTION);
      if (!Array.isArray(option.votes)
        || votes.length !== rawOptionVotes.length
        || votes.some((value, index) => value !== rawOptionVotes[index])
        || name !== option.name || id !== option.id) migrated = true;
      result.push({ id, name, votes });
      return result;
    }, []);
    allVotes[slotKey] = { options };
  });
  if (migrated) setStoredVotes(allVotes);
  return allVotes;
}

function setStoredVotes(votes) {
  return privacyService.writeLocalData("life_helper_slot_votes", votes) ? votes : null;
}

function initDefaultVotes(day, scene) {
  const key = buildVoteSlotKey(day, scene);
  if (!key) return null;
  const allVotes = getStoredVotes();
  if (!Object.prototype.hasOwnProperty.call(allVotes, key)
    && Object.keys(allVotes).length >= MAX_VOTE_SLOTS) return null;
  const batchId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  allVotes[key] = {
    options: getVoteNames(scene).map((name, i) => ({ id: `opt_${batchId}_${i}`, name, votes: [] }))
  };
  return setStoredVotes(allVotes);
}

function addVoteOption(day, scene, name) {
  const key = buildVoteSlotKey(day, scene);
  if (!key) return { success: false, reason: "invalid_slot" };
  const allVotes = getStoredVotes();
  if (!Object.prototype.hasOwnProperty.call(allVotes, key)
    && Object.keys(allVotes).length >= MAX_VOTE_SLOTS) return { success: false, reason: "slot_limit" };
  const slotVotes = allVotes[key] || { options: [] };
  const options = Array.isArray(slotVotes.options) ? slotVotes.options : [];
  const normalizedName = String(name || "").trim().slice(0, 40);
  if (!normalizedName) return { success: false, reason: "empty" };
  if (options.length >= MAX_VOTE_OPTIONS) return { success: false, reason: "limit" };
  if (options.some((option) => String((option && option.name) || "").toLowerCase() === normalizedName.toLowerCase())) {
    return { success: false, reason: "duplicate" };
  }
  const optionIdBase = `opt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let optionId = optionIdBase;
  let collisionIndex = 1;
  while (options.some((option) => option && option.id === optionId)) {
    optionId = `${optionIdBase}_${collisionIndex}`;
    collisionIndex += 1;
  }
  options.push({ id: optionId, name: normalizedName, votes: [] });
  slotVotes.options = options;
  allVotes[key] = slotVotes;
  const savedVotes = setStoredVotes(allVotes);
  return savedVotes
    ? { success: true, allVotes: savedVotes }
    : { success: false, reason: "storage" };
}

function toggleVoteOption(day, scene, optId, voterId = SELF_PARTICIPANT_ID) {
  const key = buildVoteSlotKey(day, scene);
  if (!key) return null;
  const allVotes = getStoredVotes();
  const slotVotes = allVotes[key];
  if (!slotVotes || !Array.isArray(slotVotes.options)) return null;
  const normalizedOptId = normalizeExactId(optId);
  if (!normalizedOptId) return null;
  const opt = slotVotes.options.find((o) => o && o.id === normalizedOptId);
  if (!opt) return null;
  if (!Array.isArray(opt.votes)) opt.votes = [];
  const normalizedVoterId = normalizeParticipantId(voterId);
  if (!normalizedVoterId) return null;
  const idx = opt.votes.indexOf(normalizedVoterId);
  if (idx > -1) opt.votes.splice(idx, 1);
  else if (opt.votes.length < MAX_VOTERS_PER_OPTION) opt.votes.push(normalizedVoterId);
  return setStoredVotes(allVotes);
}

function deleteVoteOption(day, scene, optId) {
  const key = buildVoteSlotKey(day, scene);
  if (!key) return null;
  const allVotes = getStoredVotes();
  if (!allVotes[key] || !Array.isArray(allVotes[key].options)) return null;
  const normalizedOptId = normalizeExactId(optId);
  if (!normalizedOptId || !allVotes[key].options.some((o) => o && o.id === normalizedOptId)) return null;
  allVotes[key].options = allVotes[key].options.filter((o) => o && o.id !== normalizedOptId);
  return setStoredVotes(allVotes);
}

function clearVotes(day, scene) {
  const key = buildVoteSlotKey(day, scene);
  if (!key) return null;
  const allVotes = getStoredVotes();
  if (!Object.prototype.hasOwnProperty.call(allVotes, key)) return null;
  delete allVotes[key];
  return setStoredVotes(allVotes);
}

module.exports = {
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
};
