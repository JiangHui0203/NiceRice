const privacyService = require("./privacyService.js");

const ACTIVITY_LOGS_KEY = "life_helper_activity_logs";
const MAX_HOT_LOGS = 500;
const MAX_TEXT_LENGTH = 160;
const MAX_ID_LENGTH = 96;
const ALLOWED_ACTIONS = new Set(["created", "scheduled", "rescheduled", "reserved", "completed", "cancelled", "expired"]);
const RESERVED_IDS = new Set(["__proto__", "constructor", "prototype"]);

function clipText(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength);
}

function normalizeExactId(value, optional = false) {
  if (optional && (value === undefined || value === null || value === "")) return "";
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id !== value || Array.from(id).length > MAX_ID_LENGTH || RESERVED_IDS.has(id)) return null;
  return id;
}

function normalizeTextList(value, maxCount, maxLength = 48) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).reduce((result, item) => {
    const text = clipText(item, maxLength);
    if (!text || seen.has(text) || result.length >= maxCount) return result;
    seen.add(text);
    result.push(text);
    return result;
  }, []);
}

function normalizeCoordinate(value, min, max) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function nowText() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function readLogs() {
  const stored = privacyService.readLocalData(ACTIVITY_LOGS_KEY, []);
  return (Array.isArray(stored) ? stored.slice(0, MAX_HOT_LOGS) : [])
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map(normalizeLogEntry)
    .filter(Boolean);
}

function writeLogs(logs) {
  const limited = (logs || []).slice(0, MAX_HOT_LOGS);
  const saved = privacyService.writeLocalData(ACTIVITY_LOGS_KEY, limited);
  if (!saved) {
    console.warn("Activity logs storage write failed");
  }
  return Boolean(saved);
}

function normalizeLogEntry(entry = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const source = entry;
  const rawCouponId = normalizeExactId(source.couponId, true);
  if (rawCouponId === null) return null;
  const suppliedEntityType = source.entityType !== undefined && source.entityType !== null && source.entityType !== "";
  const entityType = suppliedEntityType
    ? source.entityType
    : (rawCouponId ? "coupon" : "plan");
  if (!["plan", "coupon"].includes(entityType)) return null;
  const entityId = normalizeExactId(
    source.entityId !== undefined && source.entityId !== null && source.entityId !== ""
      ? source.entityId
      : (entityType === "coupon" ? rawCouponId : ""),
  );
  if (!entityId) return null;
  const action = typeof source.action === "string" && ALLOWED_ACTIONS.has(source.action)
    ? source.action
    : "";
  if (!action) return null;
  const title = (typeof source.title === "string" || typeof source.title === "number")
    ? clipText(source.title, 96)
    : "";
  if (!title) return null;
  const suppliedLogId = source.logId !== undefined && source.logId !== null && source.logId !== "";
  const normalizedLogId = suppliedLogId ? normalizeExactId(source.logId) : "";
  if (suppliedLogId && !normalizedLogId) return null;
  const asNonNegative = (value, fallback = 0, max = 1000000000) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.min(number, max) : fallback;
  };
  const financeSource = source.finance && typeof source.finance === "object" && !Array.isArray(source.finance)
    ? source.finance
    : {};
  const originalPrice = asNonNegative(financeSource.originalPrice || source.originalPrice || 0);
  const actualPaid = asNonNegative(financeSource.actualPaid || source.actualPaid || source.price || 0);
  const savedAmount = asNonNegative(
    financeSource.savedAmount !== undefined
      ? financeSource.savedAmount
      : Math.max(0, originalPrice - actualPaid)
  );
  const participantCount = asNonNegative(financeSource.participantCount || 1, 1, 1000) || 1;
  const perPersonCost = participantCount > 0 ? Number((actualPaid / participantCount).toFixed(1)) : actualPaid;

  const snapshotSource = source.executionSnapshot && typeof source.executionSnapshot === "object"
    && !Array.isArray(source.executionSnapshot) ? source.executionSnapshot : {};
  const participants = normalizeTextList(snapshotSource.participants, 50, 48);
  const executionSnapshot = {
    venue: clipText(snapshotSource.venue, 96),
    address: clipText(snapshotSource.address, 200),
    scheduledDate: clipText(snapshotSource.scheduledDate, 24),
    scheduledTime: clipText(snapshotSource.scheduledTime, 24),
    weatherCondition: clipText(snapshotSource.weatherCondition, 48),
    participants: participants.length ? participants : ["我"],
    reservationUsed: snapshotSource.reservationUsed === true,
    note: clipText(snapshotSource.note, 300),
    couponId: normalizeExactId(snapshotSource.couponId, true) || "",
    latitude: normalizeCoordinate(snapshotSource.latitude, -90, 90),
    longitude: normalizeCoordinate(snapshotSource.longitude, -180, 180),
    dishes: clipText(snapshotSource.dishes, 500),
    people: clipText(snapshotSource.people, 32),
    type: clipText(snapshotSource.type, 48),
    platform: clipText(snapshotSource.platform, 48),
    couponSnapshot: snapshotSource.couponSnapshot && typeof snapshotSource.couponSnapshot === "object"
      && !Array.isArray(snapshotSource.couponSnapshot)
      ? { id: normalizeExactId(snapshotSource.couponSnapshot.id, true) || "" }
      : null,
    planSnapshot: snapshotSource.planSnapshot && typeof snapshotSource.planSnapshot === "object"
      && !Array.isArray(snapshotSource.planSnapshot)
      ? { couponId: normalizeExactId(snapshotSource.planSnapshot.couponId, true) || "" }
      : null,
  };

  const feedbackSource = source.feedback && typeof source.feedback === "object" && !Array.isArray(source.feedback)
    ? source.feedback
    : {};
  const ratingNumber = Number(feedbackSource.rating);
  const feedback = {
    rating: Number.isFinite(ratingNumber) ? Math.max(0, Math.min(5, ratingNumber)) : 0,
    tags: normalizeTextList(feedbackSource.tags, 30, 32),
    comment: clipText(feedbackSource.comment, 500),
    repurchaseIntent: feedbackSource.repurchaseIntent !== false,
  };

  const timestampText = clipText(source.timestamp, 40);
  const parsedTimestamp = timestampText ? new Date(timestampText.replace(/-/g, "/")).getTime() : NaN;
  return {
    logId: normalizedLogId || `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    entityType,
    entityId,
    couponId: rawCouponId || "",
    action,
    timestamp: Number.isFinite(parsedTimestamp) ? timestampText : nowText(),
    operator: clipText(source.operator, 48) || "self",
    title,
    category: clipText(source.category, 48) || "其他",
    platform: clipText(source.platform, 48) || "日程",
    finance: {
      originalPrice,
      actualPaid,
      savedAmount,
      participantCount,
      perPersonCost,
    },
    executionSnapshot,
    feedback,
  };
}

function safeParseTimestamp(val) {
  if (!val) return NaN;
  if (val instanceof Date) return val.getTime();
  return new Date(String(val).replace(/-/g, "/")).getTime();
}

function recordActivityLog(rawEntry) {
  const entry = normalizeLogEntry(rawEntry);
  if (!entry) return null;
  const logs = readLogs();
  // Prevent duplicate consecutive entries for the exact same entity and action within 2 seconds
  const duplicateDelta = logs.length > 0
    ? safeParseTimestamp(entry.timestamp) - safeParseTimestamp(logs[0].timestamp)
    : NaN;
  const isRecentDuplicate = logs.length > 0 &&
    logs[0].entityId === entry.entityId && 
    logs[0].action === entry.action && 
    Number.isFinite(duplicateDelta)
    && duplicateDelta >= 0
    && duplicateDelta < 2000;

  if (isRecentDuplicate) {
    logs[0] = entry;
  } else {
    logs.unshift(entry);
  }

  return writeLogs(logs) ? entry : null;
}

function recordActivityLogs(rawEntries = []) {
  if (!Array.isArray(rawEntries) || rawEntries.length > MAX_HOT_LOGS) return null;
  if (!rawEntries.length) return [];
  const entries = rawEntries.map(normalizeLogEntry);
  if (entries.some((entry) => !entry)) return null;
  const logs = readLogs();
  const pendingHeads = [];
  entries.forEach((entry) => {
    const currentHead = pendingHeads.length
      ? pendingHeads[pendingHeads.length - 1]
      : logs[0];
    const duplicateDelta = currentHead
      ? safeParseTimestamp(entry.timestamp) - safeParseTimestamp(currentHead.timestamp)
      : NaN;
    const isRecentDuplicate = Boolean(currentHead)
      && currentHead.entityId === entry.entityId
      && currentHead.action === entry.action
      && Number.isFinite(duplicateDelta)
      && duplicateDelta >= 0
      && duplicateDelta < 2000;
    if (isRecentDuplicate) {
      if (pendingHeads.length) pendingHeads[pendingHeads.length - 1] = entry;
      else logs[0] = entry;
    } else {
      pendingHeads.push(entry);
    }
  });
  const nextLogs = pendingHeads.length
    ? pendingHeads.reverse().concat(logs)
    : logs;
  return writeLogs(nextLogs) ? entries : null;
}

function getActivityLogs(filters = {}) {
  let logs = readLogs();
  if (filters.entityType) {
    logs = logs.filter((log) => log.entityType === filters.entityType);
  }
  if (filters.action) {
    logs = logs.filter((log) => log.action === filters.action);
  }
  if (filters.category && filters.category !== "all") {
    logs = logs.filter((log) => log.category === filters.category);
  }
  if (filters.month) {
    logs = logs.filter((log) => {
      const ts = log.executionSnapshot.scheduledDate || log.timestamp;
      return String(ts).startsWith(filters.month);
    });
  }
  return logs;
}

function getStatisticsSummary() {
  const logs = readLogs();
  const completedLogs = logs.filter((log) => log.action === "completed");

  let totalCost = 0;
  let totalOriginalPrice = 0;
  let totalSaved = 0;
  const categoryCounts = Object.create(null);
  const friendCounts = Object.create(null);

  completedLogs.forEach((log) => {
    const fin = log.finance;
    totalCost += fin.actualPaid;
    if (fin.originalPrice > 0) {
      totalOriginalPrice += fin.originalPrice;
    } else if (fin.actualPaid > 0) {
      totalOriginalPrice += fin.actualPaid;
    }
    totalSaved += fin.savedAmount;
    
    const cat = log.category || "美食";
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

    (log.executionSnapshot.participants || []).forEach((name) => {
      if (name && name !== "我" && name !== "自己") {
        friendCounts[name] = (friendCounts[name] || 0) + 1;
      }
    });
  });

  let favoriteCategory = "无";
  let maxCatCount = 0;
  Object.keys(categoryCounts).forEach((cat) => {
    if (categoryCounts[cat] > maxCatCount) {
      maxCatCount = categoryCounts[cat];
      favoriteCategory = cat;
    }
  });

  let topFriend = "无";
  let maxFriendCount = 0;
  Object.keys(friendCounts).forEach((name) => {
    if (friendCounts[name] > maxFriendCount) {
      maxFriendCount = friendCounts[name];
      topFriend = name;
    }
  });

  let avgDiscount = "";
  if (totalOriginalPrice > 0 && totalSaved > 0) {
    avgDiscount = ((totalCost / totalOriginalPrice) * 10).toFixed(1) + "折";
  }

  return {
    completedCount: completedLogs.length,
    totalLogsCount: logs.length,
    totalCost: totalCost.toFixed(1),
    totalSaved: totalSaved.toFixed(1),
    avgDiscount,
    favoriteCategory,
    topFriend,
    friendCounts,
  };
}

function clearAllLogs() {
  return writeLogs([]);
}

module.exports = {
  recordActivityLog,
  recordActivityLogs,
  getActivityLogs,
  getStatisticsSummary,
  clearAllLogs,
  normalizeLogEntry,
};
