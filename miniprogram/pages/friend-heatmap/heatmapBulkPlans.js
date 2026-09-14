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
const { resolvePlanStatus } = require("./heatmapIdentity.js");

function normalizeBulkText(value, maxLength) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized && normalized.length <= maxLength ? normalized : "";
}

function getBulkSlotFailureKey(slot, index) {
  const explicitKey = slot && (typeof slot.key === "string" || typeof slot.key === "number")
    ? String(slot.key).trim()
    : "";
  if (explicitKey) return explicitKey.slice(0, 96);
  const day = slot && typeof slot.day === "string" ? slot.day.trim() : "";
  const scene = slot && typeof slot.scene === "string" ? slot.scene.trim() : "";
  return day && scene ? `${day}_${scene}`.slice(0, 96) : `slot_${index + 1}`;
}

function isValidBulkDate(dateText, day) {
  const matched = String(dateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched || WEEKDAY_MAP[day] === undefined) return false;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const date = Number(matched[3]);
  const parsed = new Date(year, month - 1, date);
  return parsed.getFullYear() === year
    && parsed.getMonth() === month - 1
    && parsed.getDate() === date
    && parsed.getDay() === WEEKDAY_MAP[day];
}

function normalizeBulkSlot(slot, scenes) {
  if (!slot || typeof slot !== "object" || Array.isArray(slot)) return null;
  const day = normalizeBulkText(slot.day, 4);
  const sceneName = normalizeBulkText(slot.scene, 32);
  const activity = normalizeBulkText(slot.activity, 80);
  if (WEEKDAYS.indexOf(day) < 0 || !sceneName || !activity) return null;

  const sourceScenes = Array.isArray(scenes) ? scenes : [];
  const matchedScene = sourceScenes.find((scene) => (
    scene && typeof scene === "object" && normalizeBulkText(scene.name, 32) === sceneName
  ));
  if (!matchedScene || typeof slot.time !== "string") return null;

  const rangeMatch = slot.time.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  if (!rangeMatch) return null;
  const startHour = normalizeClockText(rangeMatch[1]);
  const endHour = normalizeClockText(rangeMatch[2]);
  if (!startHour || !endHour || startHour === endHour) return null;

  // Legacy in-memory scene objects may only carry a name. Once timing data is
  // present it must be complete, valid and consistent with the selected slot.
  const rawSceneRange = typeof matchedScene.timeRange === "string"
    ? matchedScene.timeRange.trim()
    : "";
  const sceneRangeMatch = rawSceneRange.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  const rawSceneStart = matchedScene.start !== undefined
    ? matchedScene.start
    : matchedScene.startTime !== undefined
      ? matchedScene.startTime
      : sceneRangeMatch && sceneRangeMatch[1];
  const rawSceneEnd = matchedScene.end !== undefined
    ? matchedScene.end
    : matchedScene.endTime !== undefined
      ? matchedScene.endTime
      : sceneRangeMatch && sceneRangeMatch[2];
  const hasSceneTiming = Boolean(
    rawSceneRange
    || rawSceneStart !== undefined && rawSceneStart !== null && rawSceneStart !== ""
    || rawSceneEnd !== undefined && rawSceneEnd !== null && rawSceneEnd !== ""
  );
  if (hasSceneTiming) {
    const sceneStart = normalizeClockText(rawSceneStart);
    const sceneEnd = normalizeClockText(rawSceneEnd);
    if (!sceneStart || !sceneEnd || sceneStart === sceneEnd) return null;
    if (sceneStart !== startHour || sceneEnd !== endHour) return null;
  }

  const targetDate = getLocalDateForWeekday(day, endHour, startHour);
  if (!isValidBulkDate(targetDate, day)) return null;
  return {
    activity,
    day,
    endHour,
    scene: sceneName,
    startHour,
    targetDate,
    time: `${startHour} - ${endHour}`,
  };
}

function getHeatmapCell(heatmapRows, sceneIndex, dayIndex) {
  const rows = Array.isArray(heatmapRows) ? heatmapRows : [];
  const row = sceneIndex >= 0 ? rows[sceneIndex] : null;
  return row && Array.isArray(row.cells) && dayIndex >= 0
    ? row.cells[dayIndex] || null
    : null;
}

function formatBulkInviteText(selectedSlots = [], scenes = [], heatmapRows = [], includeFriends = false) {
  let text = `📅 【有时好饭】本周日程安排单\n--------------------------------\n`;
  const sourceSlots = Array.isArray(selectedSlots) ? selectedSlots : [];
  const sourceScenes = Array.isArray(scenes) ? scenes : [];
  sourceSlots.forEach((rawSlot) => {
    const slot = normalizeBulkSlot(rawSlot, sourceScenes);
    if (!slot) return;
    text += `📌 ${slot.targetDate} (${slot.day}) ${slot.scene} (${slot.time})\n- 活动安排：${slot.activity}\n`;
    if (includeFriends) {
      const sceneIdx = sourceScenes.findIndex((scene) => (
        scene && typeof scene === "object" && normalizeBulkText(scene.name, 32) === slot.scene
      ));
      const dayIdx = WEEKDAYS.indexOf(slot.day);
      const cell = getHeatmapCell(heatmapRows, sceneIdx, dayIdx);
      const names = cell && Array.isArray(cell.availableFriends)
        ? [...new Set(cell.availableFriends.map((friend) => (
          normalizeBulkText(friend && friend.name, 32)
        )).filter(Boolean))]
        : [];
      if (names.length) text += `- 该时段有空：${names.join("、")}\n`;
    }
    text += `\n`;
  });
  return text + `--------------------------------\n点击进入小程序“有时好饭”，共同开启精彩聚会！`;
}

function saveBulkSlotsToPlans(selectedSlots = [], scenes = [], heatmapRows = [], includeFriends = false) {
  const successIds = [];
  const failedKeys = [];
  const candidateEntries = [];
  const sourceSlots = Array.isArray(selectedSlots) ? selectedSlots : [];
  const sourceScenes = Array.isArray(scenes) ? scenes.slice(0, MAX_HEATMAP_SCENES) : [];
  if (sourceSlots.length > MAX_VOTE_SLOTS) {
    return {
      success: false,
      partial: false,
      successIds,
      failedKeys: sourceSlots.slice(0, MAX_VOTE_SLOTS).map(getBulkSlotFailureKey).concat("bulk_slot_limit"),
    };
  }
  let storedPlans;
  try {
    storedPlans = planStore.getStoredPlans({ persistMigration: false });
  } catch (error) {
    storedPlans = null;
  }
  if (!Array.isArray(storedPlans)) {
    return {
      success: false,
      partial: false,
      successIds,
      failedKeys: sourceSlots.map(getBulkSlotFailureKey),
    };
  }
  const activePlans = storedPlans.filter((plan) => (
    plan && typeof plan === "object" && isActivePlanStatus(plan.statusCode)
  ));
  const reservedPlanIds = new Set(storedPlans.map((plan) => plan && plan.id).filter(Boolean));
  const batchId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  sourceSlots.forEach((rawSlot, index) => {
    const failureKey = getBulkSlotFailureKey(rawSlot, index);
    const slot = normalizeBulkSlot(rawSlot, sourceScenes);
    if (!slot) {
      failedKeys.push(failureKey);
      return;
    }
    const { startHour, endHour, targetDate } = slot;
    const hasConflict = activePlans.some((existingPlan) => {
      const selectedTime = existingPlan.selectedTime || {};
      const existingDate = selectedTime.date || existingPlan.date || "";
      if (existingDate !== targetDate) return false;
      const existingStart = selectedTime.startTime || existingPlan.startTime || existingPlan.time || "";
      let existingEnd = selectedTime.endTime || existingPlan.endTime || "";
      if (!existingEnd) {
        const startMinutes = parseMin(existingStart);
        const durationMinutes = Number(existingPlan.durationMinutes);
        const safeDuration = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 1;
        if (startMinutes !== null) {
          const endMinutes = (startMinutes + safeDuration) % (24 * 60);
          existingEnd = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
        }
      }
      return timeRangesOverlap(
        existingStart,
        existingEnd,
        startHour,
        endHour
      );
    });
    if (hasConflict) {
      failedKeys.push(failureKey);
      return;
    }
    let participants = [{ id: "self", name: "我", status: "confirmed" }];
    if (includeFriends) {
      const sceneIdx = sourceScenes.findIndex((scene) => (
        scene && typeof scene === "object" && normalizeBulkText(scene.name, 32) === slot.scene
      ));
      const dayIdx = WEEKDAYS.indexOf(slot.day);
      const cell = getHeatmapCell(heatmapRows, sceneIdx, dayIdx);
      if (cell && Array.isArray(cell.availableFriends)) {
        participants = ensureSelfParticipant(cell.availableFriends.map((friend) => {
          const name = normalizeBulkText(friend && friend.name, 32);
          const rawId = friend && typeof friend.id === "string" ? friend.id : "";
          if (!name) return null;
          return {
            id: normalizeParticipantId(rawId) || normalizeParticipantId(name),
            name,
            isSelf: isSelfParticipant(friend),
            status: isSelfParticipant(friend) ? "confirmed" : "pending",
          };
        }).filter(Boolean));
      }
    }
    participants = ensureSelfParticipant(participants);
    let planId = `p_heatmap_bulk_${batchId}_${index}`;
    let collisionIndex = 1;
    while (reservedPlanIds.has(planId)) {
      planId = `p_heatmap_bulk_${batchId}_${index}_${collisionIndex}`;
      collisionIndex += 1;
    }
    reservedPlanIds.add(planId);
    const planData = {
      id: planId,
      couponId: "",
      title: slot.activity,
      category: "play",
      statusCode: resolvePlanStatus(participants, includeFriends),
      selectedTime: {
        date: targetDate,
        startTime: startHour, endTime: endHour,
        scene: slot.scene, label: `${slot.day} ${slot.scene}`
      },
      location: { name: "待定", address: "", distanceText: "待估算" },
      participants,
      recommendationSnapshot: {
        score: null,
        level: "pending",
        reasons: ["由好友空档热力图批量生成，尚未经过推荐评分"],
        warnings: [],
        scoreBreakdown: {},
      },
      reminders: ["多选导出计划，已写入日程！"],
      note: `由热力图本周批量决策导出。`
    };
    candidateEntries.push({ failureKey, planData });
    // Preserve the existing behavior that later selections are checked
    // against earlier valid selections in the same batch.
    activePlans.push(planData);
  });

  if (candidateEntries.length) {
    let bulkResult = null;
    try {
      bulkResult = planStore.bulkUpsertPlans(
        candidateEntries.map((entry) => entry.planData),
        { linkCoupon: false },
      );
    } catch (error) {}
    if (bulkResult && bulkResult.success === true
      && Array.isArray(bulkResult.successIds)
      && bulkResult.successIds.length === candidateEntries.length) {
      successIds.push(...bulkResult.successIds);
    } else {
      failedKeys.push(...candidateEntries.map((entry) => entry.failureKey));
    }
  }
  return {
    success: successIds.length > 0 && failedKeys.length === 0,
    partial: successIds.length > 0 && failedKeys.length > 0,
    successIds,
    failedKeys,
  };
}

module.exports = {
  normalizeBulkText,
  getBulkSlotFailureKey,
  isValidBulkDate,
  normalizeBulkSlot,
  getHeatmapCell,
  formatBulkInviteText,
  saveBulkSlotsToPlans,
};
