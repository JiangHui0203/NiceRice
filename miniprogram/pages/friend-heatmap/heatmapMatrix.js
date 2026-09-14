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
  normalizeParticipantId,
  isSelfParticipant,
} = require("./heatmapIdentity.js");

function parseMin(t) {
  if (!t || typeof t !== "string" || t.indexOf(":") === -1) return null;
  const [h, m] = t.split(":");
  const hour = parseInt(h, 10);
  const minute = parseInt(m, 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function timeRangesOverlap(s1, e1, s2, e2) {
  const start1 = parseMin(s1);
  const end1Raw = parseMin(e1);
  const start2 = parseMin(s2);
  const end2Raw = parseMin(e2);
  if ([start1, end1Raw, start2, end2Raw].some((value) => value === null)) return false;

  const end1 = end1Raw <= start1 ? end1Raw + 24 * 60 : end1Raw;
  const end2 = end2Raw <= start2 ? end2Raw + 24 * 60 : end2Raw;
  return [-24 * 60, 0, 24 * 60].some((offset) => (
    Math.max(start1, start2 + offset) < Math.min(end1, end2 + offset)
  ));
}

function getLocalDateForWeekday(weekdayName, endHour, startHour, nowValue) {
  const targetDay = WEEKDAY_MAP[weekdayName];
  if (targetDay === undefined) return "";
  const now = nowValue instanceof Date ? new Date(nowValue.getTime()) : new Date();
  const startMinute = parseMin(startHour);
  const endMinute = parseMin(endHour);
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const isCrossMidnight = startMinute !== null && endMinute !== null && endMinute <= startMinute;
  let diff = targetDay - now.getDay();
  const dayAfterTarget = (targetDay + 1) % 7;
  if (isCrossMidnight && now.getDay() === dayAfterTarget && nowMinute <= endMinute) {
    diff = -1;
  } else if (diff < 0) {
    diff += 7;
  } else if (diff === 0 && endMinute !== null && !isCrossMidnight && nowMinute > endMinute) {
    diff += 7;
  }
  const target = new Date(now.getTime() + diff * 86400000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

function checkFriendSlotOverlap(friend, day, scene, scenes) {
  const slots = Array.isArray(friend && friend.slots) ? friend.slots.filter((item) => typeof item === "string") : [];
  if (!slots.length) return null;
  for (const item of slots) {
    if (!item.includes(day)) continue;
    const otherScenes = scenes.filter((s) => s.name !== scene.name);
    if (otherScenes.some((s) => item.includes(s.name)) && !item.includes(scene.name)) continue;

    const range = item.match(/(\d{1,2}:\d{2})\s*[-至到]\s*(\d{1,2}:\d{2})/);
    if (range && timeRangesOverlap(range[1], range[2], scene.start, scene.end)) return item;

    const after = item.match(/(\d{1,2}:\d{2})\s*(?:后|以后)/);
    if (after && timeRangesOverlap(after[1], "23:59", scene.start, scene.end)) return item;

    if (!range && !after) return item;
  }
  return null;
}

function calculateHeatmapMatrix(selectedFriends = [], scenes = [], allVotes = {}, planSlotMap = {}) {
  const total = selectedFriends.length;
  return scenes.map((scene) => ({
    scene,
    emoji: scene.emoji,
    name: scene.name,
    timeRange: scene.timeRange,
    cells: WEEKDAYS.map((day) => {
      const availableFriends = [];
      const friendStatus = selectedFriends.map((f) => {
        const slotDetail = checkFriendSlotOverlap(f, day, scene, scenes);
        if (slotDetail) {
          availableFriends.push({
            id: normalizeParticipantId(f.id || f.name),
            name: f.name,
            isSelf: isSelfParticipant(f),
            slotDetail,
          });
          return {
            id: f.id || f.name,
            name: f.name,
            isAvailable: true,
            slotDetail,
          };
        }
        return {
          id: f.id || f.name,
          name: f.name,
          isAvailable: false,
          slotDetail: "此时间不可约",
        };
      });

      const overlapCount = availableFriends.length;
      const ratioPercent = total ? Math.round((overlapCount / total) * 100) : 0;
      const activeClass = !total ? "level-none" : (overlapCount === total ? "level-full" : (overlapCount > 0 ? "level-partial" : "level-none"));
      const isGoldenSlot = Boolean(total >= 2 && overlapCount === total);

      const slotKey = `${day}_${scene.name}`;
      const slotVotes = allVotes[slotKey];
      let winningOptions = [];

      const matchedPlan = planSlotMap[slotKey];
      if (matchedPlan && matchedPlan.title) {
        const cleanTitle = matchedPlan.title.replace(/双人.*|套餐|放题.*/, "");
        const shortTitle = cleanTitle.length > 5 ? cleanTitle.slice(0, 4) + ".." : cleanTitle;
        winningOptions.push(`📌${shortTitle}`);
      }

      if (slotVotes && Array.isArray(slotVotes.options)) {
        const voteOpts = slotVotes.options
          .filter((o) => o.votes && o.votes.length)
          .sort((a, b) => b.votes.length - a.votes.length)
          .slice(0, 2)
          .map((o) => o.name);
        winningOptions.push(...voteOpts);
      }

      return {
        day, sceneName: scene.name, timeRange: scene.timeRange,
        start: scene.start, end: scene.end, overlapCount,
        totalSelected: total, ratioPercent, activeClass,
        availableFriends, friendStatus, winningOptions, isGoldenSlot
      };
    })
  }));
}

function getVoteNames(scene) {
  for (const [key, names] of Object.entries(DEFAULT_VOTES_MAP)) {
    if (scene.includes(key)) return names;
  }
  return ["大家聚餐", "密室逃脱", "剧本杀游戏", "唱K/唱歌"];
}

function normalizeClockText(value) {
  const matched = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return "";
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

module.exports = {
  parseMin,
  timeRangesOverlap,
  getLocalDateForWeekday,
  checkFriendSlotOverlap,
  calculateHeatmapMatrix,
  getVoteNames,
  normalizeClockText,
};
