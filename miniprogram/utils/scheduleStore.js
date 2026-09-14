const SCHEDULE_KEY = "life_helper_user_schedules";
const privacyService = require("./privacyService.js");
const MAX_SCHEDULES = 200;
const MAX_SCHEDULE_ID_CHARS = 96;
const MAX_SCHEDULE_TITLE_CHARS = 64;
const MAX_SCHEDULE_INPUT_CHARS = 180;
let scheduleIdSequence = 0;

const WEEKDAY_ALIASES = {
  周一: "周一", 周二: "周二", 周三: "周三", 周四: "周四", 周五: "周五", 周六: "周六", 周日: "周日", 周天: "周日",
  星期一: "周一", 星期二: "周二", 星期三: "周三", 星期四: "周四", 星期五: "周五", 星期六: "周六", 星期日: "周日", 星期天: "周日",
};

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeClock(clock) {
  if (typeof clock !== "string") return null;
  const matched = clock.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return null;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeScheduleForImport(item) {
  if (!isRecord(item)) return null;
  const id = (typeof item.id === "string" || typeof item.id === "number") ? String(item.id).trim() : "";
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const weekday = typeof item.weekday === "string" ? (WEEKDAY_ALIASES[item.weekday.trim()] || "") : "";
  const startTime = normalizeClock(item.startTime);
  const endTime = normalizeClock(item.endTime);
  if (!id || id.length > MAX_SCHEDULE_ID_CHARS
    || !title || title.length > MAX_SCHEDULE_TITLE_CHARS
    || !weekday || !startTime || !endTime || startTime === endTime) return null;
  return { id, title, weekday, startTime, endTime };
}

function normalizeSchedule(item = {}) {
  if (!isRecord(item)) return null;
  scheduleIdSequence = (scheduleIdSequence + 1) % 1000000;
  return normalizeScheduleForImport(Object.assign({}, item, {
    id: item.id || `schedule_${Date.now()}_${scheduleIdSequence}`,
  }));
}

function readSchedules() {
  try {
    const stored = privacyService.readLocalData(SCHEDULE_KEY, null);
    if (Array.isArray(stored)) {
      const ids = new Set();
      return stored.slice(0, MAX_SCHEDULES).map(normalizeScheduleForImport).filter((item) => {
        if (!item || ids.has(item.id)) return false;
        ids.add(item.id);
        return true;
      });
    }
  } catch (e) {
    return [];
  }
  return [];
}

function saveSchedules(schedules) {
  if (!Array.isArray(schedules)) return false;
  if (schedules.length > MAX_SCHEDULES) return false;
  const normalized = schedules.map(normalizeScheduleForImport);
  if (normalized.some((item) => !item)) {
    console.warn("schedule storage rejected invalid data");
    return false;
  }
  if (new Set(normalized.map((item) => item.id)).size !== normalized.length) {
    console.warn("schedule storage rejected duplicate IDs");
    return false;
  }
  const success = privacyService.writeLocalData(SCHEDULE_KEY, normalized);
  if (!success) console.warn("schedule storage failed");
  return success;
}

function parseScheduleText(text) {
  if (typeof text !== "string") return null;
  const value = text.trim();
  if (!value || value.length > MAX_SCHEDULE_INPUT_CHARS) return null;
  const weekdayMatched = value.match(/周[一二三四五六日天]/);
  const timeMatched = value.match(/(\d{1,2}:\d{2})\s*[-至到]\s*(\d{1,2}:\d{2})/);
  if (!weekdayMatched || !timeMatched) return null;
  const normalizedStart = normalizeClock(timeMatched[1]);
  const normalizedEnd = normalizeClock(timeMatched[2]);
  // A recurring block may cross midnight (for example 22:30-07:00). The
  // recommendation conflict resolver already understands overnight ranges;
  // rejecting them here made the two layers disagree.
  if (!normalizedStart || !normalizedEnd || normalizedStart === normalizedEnd) return null;
  const title = value
    .replace(/周[一二三四五六日天]/, "")
    .replace(/(\d{1,2}:\d{2})\s*[-至到]\s*(\d{1,2}:\d{2})/, "")
    .trim()
    .replace(/^[-，。·\s]+|[-，。·\s]+$/g, "");
  if (!title || title.length > MAX_SCHEDULE_TITLE_CHARS) return null;
  return {
    weekday: weekdayMatched[0].replace("周天", "周日"),
    startTime: normalizedStart,
    endTime: normalizedEnd,
    title,
  };
}

function addSchedule(text) {
  const parsed = parseScheduleText(text);
  if (!parsed) return null;
  const schedules = readSchedules();
  if (schedules.length >= MAX_SCHEDULES) return null;
  const schedule = normalizeSchedule(Object.assign({}, parsed, {
    id: "",
  }));
  if (!schedule) return null;
  if (!saveSchedules(schedules.concat(schedule))) return null;
  return schedule;
}

function removeSchedule(id) {
  const targetId = (typeof id === "string" || typeof id === "number") ? String(id).trim() : "";
  if (!targetId || targetId.length > MAX_SCHEDULE_ID_CHARS) return false;
  const schedules = readSchedules();
  if (!schedules.some((item) => item.id === targetId)) return false;
  return saveSchedules(schedules.filter((item) => item.id !== targetId));
}

function formatSchedule(item = {}) {
  return `${item.startTime || ""}-${item.endTime || ""} 不安排出门`;
}

function updateSchedule(id, patch) {
  const targetId = (typeof id === "string" || typeof id === "number") ? String(id).trim() : "";
  if (!targetId || targetId.length > MAX_SCHEDULE_ID_CHARS || !isRecord(patch)) return null;
  if (patch.id !== undefined && String(patch.id).trim() !== targetId) return null;
  const schedules = readSchedules();
  const index = schedules.findIndex((item) => item.id === targetId);
  if (index === -1) return null;
  const updated = normalizeScheduleForImport(Object.assign({}, schedules[index], patch, { id: targetId }));
  if (!updated) return null;
  schedules[index] = updated;
  if (!saveSchedules(schedules)) return null;
  return schedules[index];
}

module.exports = {
  MAX_SCHEDULES,
  MAX_SCHEDULE_ID_CHARS,
  MAX_SCHEDULE_INPUT_CHARS,
  MAX_SCHEDULE_TITLE_CHARS,
  addSchedule,
  formatSchedule,
  parseScheduleText,
  readSchedules,
  removeSchedule,
  saveSchedules,
  normalizeScheduleForImport,
  updateSchedule,
};
