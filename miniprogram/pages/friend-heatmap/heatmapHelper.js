const part1 = require("./heatmapConstants.js");
const part2 = require("./heatmapMatrix.js");
const part3 = require("./heatmapVotes.js");
const part4 = require("./heatmapInviteCodec.js");
const part5 = require("./heatmapBulkPlans.js");
const part6 = require("./heatmapState.js");

const parts = Object.assign({}, part1, part2, part3, part4, part5, part6);

module.exports = {
  SELF_PARTICIPANT_ID: parts.SELF_PARTICIPANT_ID,
  LEGACY_SELF_PARTICIPANT_ID: parts.LEGACY_SELF_PARTICIPANT_ID,
  HEATMAP_SELECTION_KEY: parts.HEATMAP_SELECTION_KEY,
  WEEKDAYS: parts.WEEKDAYS,
  ICON_EMOJI_MAP: parts.ICON_EMOJI_MAP,
  PRESET_SCENES: parts.PRESET_SCENES,
  parseMin: parts.parseMin,
  timeRangesOverlap: parts.timeRangesOverlap,
  getLocalDateForWeekday: parts.getLocalDateForWeekday,
  calculateHeatmapMatrix: parts.calculateHeatmapMatrix,
  initDefaultVotes: parts.initDefaultVotes,
  addVoteOption: parts.addVoteOption,
  toggleVoteOption: parts.toggleVoteOption,
  deleteVoteOption: parts.deleteVoteOption,
  clearVotes: parts.clearVotes,
  parseInviteParams: parts.parseInviteParams,
  buildSharePayload: parts.buildSharePayload,
  importFriendInvite: parts.importFriendInvite,
  buildExportableSlots: parts.buildExportableSlots,
  formatBulkInviteText: parts.formatBulkInviteText,
  saveBulkSlotsToPlans: parts.saveBulkSlotsToPlans,
  ensureHeatmapEnrichment: parts.ensureHeatmapEnrichment,
  loadInitialSelfAndFriends: parts.loadInitialSelfAndFriends,
  loadStoredScenes: parts.loadStoredScenes,
  ensureSelfParticipant: parts.ensureSelfParticipant,
  isSelfParticipant: parts.isSelfParticipant,
  normalizeSelfId: parts.normalizeSelfId,
  normalizeStoredScene: parts.normalizeStoredScene,
  normalizeStoredScenes: parts.normalizeStoredScenes,
  resolvePlanStatus: parts.resolvePlanStatus,
  switchScenePreset: parts.switchScenePreset,
  createCustomScene: parts.createCustomScene,
  saveCustomScenes: parts.saveCustomScenes,
  removeSceneById: parts.removeSceneById,
  addFriend: parts.addFriend,
  removeFriend: parts.removeFriend,
  addFriendSlot: parts.addFriendSlot,
  deleteFriendSlot: parts.deleteFriendSlot,
  updateSelfName: parts.updateSelfName,
  addSelfSlot: parts.addSelfSlot,
  deleteSelfSlot: parts.deleteSelfSlot,
  getStoredVotes: parts.getStoredVotes,
  loadSelectedFriendIds: parts.loadSelectedFriendIds,
  saveSelectedFriendIds: parts.saveSelectedFriendIds,
};
