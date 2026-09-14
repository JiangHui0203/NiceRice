const { decodeBase64, encodeBase64 } = require("./base64Codec.js");
const couponStore = require("./couponStore.js");
const friendStore = require("./friendStore.js");
const locationPreferenceStore = require("./locationPreferenceStore.js");
const planStore = require("./planStore.js");
const preferenceStore = require("./preferenceStore.js");
const scheduleStore = require("./scheduleStore.js");

const BACKUP_FORMAT = "life-helper-domain-backup";
const BACKUP_VERSION = 2;
const MAX_BACKUP_TEXT_CHARS = 2 * 1024 * 1024;
const MAX_BACKUP_BASE64_CHARS = Math.ceil(MAX_BACKUP_TEXT_CHARS * 4 / 3) + 8;
const MAX_COLLECTION_ITEMS = 1000;
const MAX_ITEM_CHARS = 64 * 1024;
const MAX_COUPONS = 500;
const MAX_PLANS = 500;
const ATTACHMENT_POLICY = "local_files_excluded";
const DOMAIN_COLLECTION_KEYS = ["coupons", "plans", "friends", "schedules", "locations"];
const RESERVED_ID_VALUES = new Set(["__proto__", "constructor", "prototype"]);

function assertTextSize(text, limit = MAX_BACKUP_TEXT_CHARS) {
  if (String(text || "").length > limit) {
    throw new Error("备份内容过大，无法安全恢复");
  }
}

function assertCollectionLimits(key, list) {
  if (list === undefined) return;
  if (!Array.isArray(list)) throw new Error(`备份字段 ${key} 格式不正确`);
  if (list.length > MAX_COLLECTION_ITEMS) throw new Error(`备份字段 ${key} 条目过多`);
  list.forEach((item) => {
    let serialized = "";
    try {
      serialized = JSON.stringify(item);
    } catch (error) {
      throw new Error(`备份字段 ${key} 包含无法解析的条目`);
    }
    if (serialized.length > MAX_ITEM_CHARS) throw new Error(`备份字段 ${key} 单条内容过大`);
  });
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requiredText(value) {
  return (typeof value === "string" || typeof value === "number") ? String(value).trim() : "";
}

function exactIdentity(value) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  if (!id || id !== value || Array.from(id).length > 96 || RESERVED_ID_VALUES.has(id)) return "";
  return id;
}

function identityWasProvided(value) {
  return value !== undefined && value !== null && value !== "";
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function isValidCalendarDate(value) {
  const text = String(value || "").trim();
  const matched = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!matched) return false;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function isValidClockOrPending(value) {
  if (!hasValue(value)) return true;
  const text = String(value).trim();
  if (text === "待定") return true;
  const matched = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return false;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function assertUniqueIds(key, list) {
  const seen = new Set();
  list.forEach((item, index) => {
    const id = exactIdentity(item && item.id);
    if (!id) throw new Error(`备份字段 ${key} 第 ${index + 1} 条缺少有效 ID`);
    if (seen.has(id)) throw new Error(`备份字段 ${key} 第 ${index + 1} 条与其他条目 ID 重复`);
    seen.add(id);
  });
}

function assertCoordinatePair(value, label) {
  if (!isRecord(value)) return;
  const latitude = hasValue(value.latitude) ? value.latitude : value.lat;
  const longitude = hasValue(value.longitude) ? value.longitude : value.lng;
  const hasLatitude = hasValue(latitude);
  const hasLongitude = hasValue(longitude);
  if (hasLatitude !== hasLongitude) throw new Error(`${label} 的经纬度不完整`);
  if (hasLatitude && !locationPreferenceStore.hasCoordinates({ latitude, longitude })) {
    throw new Error(`${label} 的经纬度超出有效范围`);
  }
}

function normalizeCouponEntries(list, key = "coupons") {
  if (list === undefined) return null;
  assertCollectionLimits(key, list);
  if (list.length > MAX_COUPONS) throw new Error(`备份字段 ${key} 最多支持 ${MAX_COUPONS} 张优惠券`);
  const normalized = list.map((coupon, index) => {
    const label = `备份字段 ${key} 第 ${index + 1} 条`;
    if (!isRecord(coupon)) throw new Error(`${label}不是有效优惠券对象`);
    const id = exactIdentity(coupon.id);
    const title = typeof coupon.title === "string" ? coupon.title.trim() : "";
    if (!id || !title) throw new Error(`${label}缺少有效 ID 或标题`);

    const rawStatus = coupon.statusCode !== undefined ? coupon.statusCode : coupon.status;
    if (hasValue(rawStatus)) {
      if (typeof rawStatus !== "string"
        || !Object.prototype.hasOwnProperty.call(couponStore.STATUS_ALIAS_MAP, rawStatus)) {
        throw new Error(`${label}的状态无效`);
      }
    }
    if (hasValue(coupon.expireDate) && !isValidCalendarDate(coupon.expireDate)) {
      throw new Error(`${label}的有效期日期无效`);
    }
    ["price", "originalPrice", "lossAmount"].forEach((field) => {
      if (hasValue(coupon[field]) && (!Number.isFinite(Number(coupon[field])) || Number(coupon[field]) < 0)) {
        throw new Error(`${label}的 ${field} 不是有效非负数值`);
      }
    });
    if (hasValue(coupon.durationMinutes)
      && (!Number.isFinite(Number(coupon.durationMinutes)) || Number(coupon.durationMinutes) <= 0)) {
      throw new Error(`${label}的 durationMinutes 不是有效正数`);
    }
    ["tags", "reasons", "reasonItems", "screenshots"].forEach((field) => {
      if (coupon[field] !== undefined && coupon[field] !== null && !Array.isArray(coupon[field])) {
        throw new Error(`${label}的 ${field} 格式无效`);
      }
    });
    if (coupon.location !== undefined && coupon.location !== null && !isRecord(coupon.location)) {
      throw new Error(`${label}的地点格式无效`);
    }
    assertCoordinatePair(coupon, label);
    if (coupon.location) assertCoordinatePair(coupon.location, `${label}地点`);

    if (identityWasProvided(coupon.planId) && !exactIdentity(coupon.planId)) {
      throw new Error(`${label}包含无效计划 ID`);
    }
    const result = couponStore.normalizeCoupon(Object.assign({}, coupon, { id, title }));
    if (!result || result.id !== id) throw new Error(`${label}无法转换为当前优惠券格式`);
    return result;
  });
  assertUniqueIds(key, normalized);
  return normalized;
}

function normalizePlanEntries(list, key = "plans") {
  if (list === undefined) return null;
  assertCollectionLimits(key, list);
  if (list.length > MAX_PLANS) throw new Error(`备份字段 ${key} 最多支持 ${MAX_PLANS} 条计划`);
  const normalized = list.map((plan, index) => {
    const label = `备份字段 ${key} 第 ${index + 1} 条`;
    if (!isRecord(plan)) throw new Error(`${label}不是有效计划对象`);
    const id = exactIdentity(plan.id);
    const title = typeof plan.title === "string" ? plan.title.trim() : "";
    if (!id || !title) throw new Error(`${label}缺少有效 ID 或标题`);

    const rawStatus = plan.statusCode !== undefined ? plan.statusCode : plan.status;
    if (hasValue(rawStatus)) {
      const knownStatus = typeof rawStatus === "string"
        && (Object.prototype.hasOwnProperty.call(planStore.STATUS_ALIAS_MAP, rawStatus)
          || Object.prototype.hasOwnProperty.call(planStore.STATUS_META, rawStatus));
      if (!knownStatus) {
        throw new Error(`${label}的状态无效`);
      }
    }
    if (plan.selectedTime !== undefined && plan.selectedTime !== null && !isRecord(plan.selectedTime)) {
      throw new Error(`${label}的时间格式无效`);
    }
    const selectedTime = plan.selectedTime || {};
    if (hasValue(selectedTime.date) && !isValidCalendarDate(selectedTime.date)) {
      throw new Error(`${label}的日期无效`);
    }
    [selectedTime.startTime, selectedTime.endTime, plan.time].forEach((clock) => {
      if (!isValidClockOrPending(clock)) throw new Error(`${label}包含无效时间`);
    });
    if (hasValue(selectedTime.startTime) && hasValue(selectedTime.endTime)
      && String(selectedTime.startTime).trim() === String(selectedTime.endTime).trim()) {
      throw new Error(`${label}的开始和结束时间不能相同`);
    }
    if (plan.participants !== undefined && plan.participants !== null) {
      if (!Array.isArray(plan.participants)) throw new Error(`${label}的参与人格式无效`);
      plan.participants.forEach((participant) => {
        if (!isRecord(participant)) {
          throw new Error(`${label}包含无效参与人`);
        }
        const hasParticipantId = identityWasProvided(participant.id);
        const participantId = hasParticipantId ? exactIdentity(participant.id) : "";
        const participantName = typeof participant.name === "string" ? participant.name.trim() : "";
        const participantNameExact = participantName === participant.name
          && Array.from(participantName).length <= 48;
        if ((hasParticipantId && !participantId) || !participantName || !participantNameExact) {
          throw new Error(`${label}包含无效参与人身份`);
        }
      });
    }
    ["tags", "changeLogs", "reminders"].forEach((field) => {
      if (plan[field] !== undefined && plan[field] !== null && !Array.isArray(plan[field])) {
        throw new Error(`${label}的 ${field} 格式无效`);
      }
    });
    if (plan.location !== undefined && plan.location !== null && !isRecord(plan.location)) {
      throw new Error(`${label}的地点格式无效`);
    }
    if (plan.location) assertCoordinatePair(plan.location, `${label}地点`);
    assertCoordinatePair(plan, label);
    if (hasValue(plan.durationMinutes)
      && (!Number.isFinite(Number(plan.durationMinutes)) || Number(plan.durationMinutes) <= 0)) {
      throw new Error(`${label}的预计时长无效`);
    }
    if (plan.recommendationSnapshot !== undefined && plan.recommendationSnapshot !== null) {
      if (!isRecord(plan.recommendationSnapshot)) throw new Error(`${label}的推荐快照格式无效`);
      const score = plan.recommendationSnapshot.score;
      if (hasValue(score) && (!Number.isFinite(Number(score)) || Number(score) < 0 || Number(score) > 100)) {
        throw new Error(`${label}的推荐分数无效`);
      }
    }

    ["couponId", "sourceId"].forEach((field) => {
      if (identityWasProvided(plan[field]) && !exactIdentity(plan[field])) {
        throw new Error(`${label}包含无效 ${field}`);
      }
    });
    const result = planStore.normalizePlan(Object.assign({}, plan, { id, title }));
    if (!result || result.id !== id) throw new Error(`${label}无法转换为当前计划格式`);
    if (Array.isArray(plan.participants) && plan.participants.length
      && result.participants.length !== plan.participants.length) {
      throw new Error(`${label}包含重复或无法保留的参与人身份`);
    }
    if (identityWasProvided(plan.inviteId) && result.inviteId !== plan.inviteId) {
      throw new Error(`${label}包含无效邀请 ID`);
    }
    return result;
  });
  assertUniqueIds(key, normalized);
  return normalized;
}

function normalizeFriendEntries(list, key = "friends") {
  if (list === undefined) return null;
  assertCollectionLimits(key, list);
  if (list.length > 100) throw new Error(`备份字段 ${key} 最多支持 100 位好友`);
  const normalized = list.map((friend, index) => {
    const label = `备份字段 ${key} 第 ${index + 1} 条`;
    if (!isRecord(friend)) throw new Error(`${label}不是有效好友对象`);
    if (typeof friend.name !== "string" || !friend.name.trim()
      || friend.name !== friend.name.trim() || Array.from(friend.name).length > 24) {
      throw new Error(`${label}的好友姓名无效`);
    }
    if (identityWasProvided(friend.id) && !exactIdentity(friend.id)) {
      throw new Error(`${label}的 ID 无效`);
    }
    if (identityWasProvided(friend.inviterId) && !exactIdentity(friend.inviterId)) {
      throw new Error(`${label}的分享身份无效`);
    }
    if (hasValue(friend.travel)
      && (typeof friend.travel !== "string" || friend.travel.trim().length > 64)) {
      throw new Error(`${label}的出行偏好无效`);
    }
    ["slots", "restrictions"].forEach((field) => {
      if (friend[field] !== undefined && friend[field] !== null && (!Array.isArray(friend[field])
        || friend[field].some((item) => typeof item !== "string" || !item.trim()))) {
        throw new Error(`${label}的 ${field} 格式无效`);
      }
    });
    if (Array.isArray(friend.slots)) {
      if (friend.slots.length > friendStore.MAX_FRIEND_SLOTS
        || friend.slots.some((slot) => !friendStore.normalizeAvailabilitySlot(slot))) {
        throw new Error(`${label}的可约时段无效或过多`);
      }
    }
    if (Array.isArray(friend.restrictions)
      && (friend.restrictions.length > friendStore.MAX_FRIEND_RESTRICTIONS
        || friend.restrictions.some((item) => item.trim().length > friendStore.MAX_RESTRICTION_LENGTH))) {
      throw new Error(`${label}的饮食忌口过长或过多`);
    }
    const normalized = friendStore.normalizeFriend(friend);
    if (!normalized) throw new Error(`${label}缺少有效姓名`);
    return normalized;
  });
  const identities = new Set();
  const names = new Set();
  normalized.forEach((friend, index) => {
    const identity = friend.id ? `id:${friend.id}` : `name:${friend.name.toLowerCase()}`;
    const normalizedName = friend.name.toLowerCase();
    if (identities.has(identity) || names.has(normalizedName)) {
      throw new Error(`备份字段 ${key} 第 ${index + 1} 条与其他好友重复`);
    }
    identities.add(identity);
    names.add(normalizedName);
  });
  return normalized;
}

function normalizePreferenceEntry(value, key = "preferences") {
  if (value === undefined) return null;
  if (!isRecord(value)) throw new Error(`备份字段 ${key} 格式不正确`);
  const arrayFields = ["likedFoods", "dislikedFoods", "customFoods", "time", "cleanup", "travel", "food"];
  arrayFields.forEach((field) => {
    if (value[field] !== undefined && value[field] !== null && (!Array.isArray(value[field])
      || value[field].some((item) => typeof item !== "string" || !item.trim()))) {
      throw new Error(`备份字段 ${key} 的 ${field} 格式无效`);
    }
    if (Array.isArray(value[field])) {
      const limit = field === "customFoods"
        ? preferenceStore.MAX_CUSTOM_FOODS
        : (["time", "cleanup", "travel"].includes(field)
          ? preferenceStore.MAX_GROUP_SELECTIONS
          : preferenceStore.MAX_FOOD_SELECTIONS);
      if (value[field].length > limit) throw new Error(`备份字段 ${key} 的 ${field} 条目过多`);
      if (value[field].some((item) => item.trim().length > preferenceStore.MAX_PREFERENCE_LABEL_CHARS)) {
        throw new Error(`备份字段 ${key} 的 ${field} 包含过长内容`);
      }
    }
  });
  const textLimits = { commuteLimit: 32, rainMode: 64, homeCity: 64 };
  Object.keys(textLimits).forEach((field) => {
    if (value[field] !== undefined && value[field] !== null && typeof value[field] !== "string") {
      throw new Error(`备份字段 ${key} 的 ${field} 格式无效`);
    }
    if (typeof value[field] === "string" && value[field].trim().length > textLimits[field]) {
      throw new Error(`备份字段 ${key} 的 ${field} 内容过长`);
    }
  });
  if (hasValue(value.transportMode)
    && !["transit", "walking", "driving", "cycling"].includes(value.transportMode)) {
    throw new Error(`备份字段 ${key} 的交通方式无效`);
  }
  if (hasValue(value.priceSensitivity)
    && !["low", "medium", "high"].includes(value.priceSensitivity)) {
    throw new Error(`备份字段 ${key} 的价格敏感度无效`);
  }
  if (hasValue(value.maxTravelDuration)) {
    const minutes = Number(value.maxTravelDuration);
    if (!Number.isFinite(minutes) || !Number.isInteger(minutes) || minutes < 5 || minutes > 240) {
      throw new Error(`备份字段 ${key} 的最长通勤时间无效`);
    }
  }
  const normalized = preferenceStore.normalizePreferencesForImport(value);
  if (!normalized) throw new Error(`备份字段 ${key} 包含冲突、超限或不受支持的偏好`);
  return normalized;
}

function normalizeScheduleEntries(list, key = "schedules") {
  if (list === undefined) return null;
  assertCollectionLimits(key, list);
  if (list.length > scheduleStore.MAX_SCHEDULES) {
    throw new Error(`备份字段 ${key} 最多支持 ${scheduleStore.MAX_SCHEDULES} 条日程`);
  }
  const normalized = list.map((schedule, index) => {
    const result = scheduleStore.normalizeScheduleForImport(schedule);
    if (!result) throw new Error(`备份字段 ${key} 第 ${index + 1} 条日程无效`);
    return result;
  });
  assertUniqueIds(key, normalized);
  return normalized;
}

function normalizeLocationEntries(list, key = "locations") {
  if (list === undefined) return null;
  assertCollectionLimits(key, list);
  if (list.length > locationPreferenceStore.MAX_LOCATIONS) {
    throw new Error(`备份字段 ${key} 最多支持 ${locationPreferenceStore.MAX_LOCATIONS} 个常用地点`);
  }
  const normalized = list.map((location, index) => {
    const result = locationPreferenceStore.normalizeLocationForImport(location, index);
    if (!result) throw new Error(`备份字段 ${key} 第 ${index + 1} 条地点无效`);
    return result;
  });
  assertUniqueIds(key, normalized);
  const reservedRoles = new Set();
  normalized.forEach((location, index) => {
    if (location.role === "custom") return;
    if (reservedRoles.has(location.role)) {
      throw new Error(`备份字段 ${key} 第 ${index + 1} 条与其他地点角色重复`);
    }
    reservedRoles.add(location.role);
  });
  return normalized;
}

function parseBackupText(text) {
  const source = String(text || "").trim();
  if (!source) throw new Error("备份内容为空");
  const isRawJson = source.startsWith("{") || source.startsWith("[");
  assertTextSize(source, isRawJson ? MAX_BACKUP_TEXT_CHARS : MAX_BACKUP_BASE64_CHARS);
  const json = isRawJson ? source : decodeBase64(source);
  assertTextSize(json);
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("备份数据格式不合法");
  }
  return parsed;
}

function validateDomainEnvelope(data = {}) {
  if (data.format !== undefined && data.format !== BACKUP_FORMAT) {
    throw new Error("备份格式不受支持");
  }
  if (data.format === BACKUP_FORMAT && data.version === undefined) {
    throw new Error("备份缺少版本号");
  }
  const version = data.version === undefined ? 1 : Number(data.version);
  if (!Number.isInteger(version) || version < 1 || version > BACKUP_VERSION) {
    throw new Error(`备份版本不受支持：${data.version}`);
  }
  return version;
}

function isLegacyStorageBackup(data = {}) {
  const storageData = data && data.data;
  return Boolean(storageData && typeof storageData === "object" && !Array.isArray(storageData)
    && Object.keys(storageData).some((key) => key.indexOf("life_helper_") === 0));
}

function importLegacyStorageBackup(data) {
  // Keep the old storage-key envelope readable while the active backup format
  // remains independent from storage implementation details.
  const storageManager = require("./storageManager.js");
  const sourceData = Object.assign({}, data.data || {});
  const verifiedLegacyKeys = [
    "life_helper_coupons",
    "life_helper_plans_v2",
    "life_helper_plans",
    "life_helper_profile_preferences",
    "life_helper_user_schedules",
    "life_helper_friends",
    "life_helper_location_preferences",
  ];
  if (!verifiedLegacyKeys.some((key) => Object.prototype.hasOwnProperty.call(sourceData, key))) {
    throw new Error("旧版备份中没有可安全恢复的核心数据");
  }

  // Only pass domains that have completed semantic validation to the legacy
  // storage importer. Operational state such as wheel history, invitations,
  // activity logs and weather overrides is deliberately ignored: forwarding
  // those opaque values would let malformed entries reach the first write.
  let legacyData = {};
  const coupons = normalizeCouponEntries(sourceData.life_helper_coupons, "life_helper_coupons");
  const v2Plans = normalizePlanEntries(sourceData.life_helper_plans_v2, "life_helper_plans_v2");
  const oldPlans = normalizePlanEntries(sourceData.life_helper_plans, "life_helper_plans");
  const friends = normalizeFriendEntries(sourceData.life_helper_friends, "life_helper_friends");
  const schedules = normalizeScheduleEntries(sourceData.life_helper_user_schedules, "life_helper_user_schedules");
  const locations = normalizeLocationEntries(sourceData.life_helper_location_preferences, "life_helper_location_preferences");
  const preferences = normalizePreferenceEntry(
    sourceData.life_helper_profile_preferences,
    "life_helper_profile_preferences"
  );
  if (coupons) legacyData.life_helper_coupons = coupons;
  if (v2Plans) legacyData.life_helper_plans_v2 = v2Plans;
  if (oldPlans) legacyData.life_helper_plans = oldPlans;
  if (friends) legacyData.life_helper_friends = friends;
  if (schedules) legacyData.life_helper_user_schedules = schedules;
  if (locations) legacyData.life_helper_location_preferences = locations;
  if (preferences) legacyData.life_helper_profile_preferences = preferences;

  const shouldMigrateOldPlans = Array.isArray(oldPlans)
    && (!Array.isArray(v2Plans) || v2Plans.length === 0);
  if (shouldMigrateOldPlans) {
    // Add the migrated key to the same atomic storage import instead of
    // writing plans afterwards and leaving a half-restored backup on failure.
    legacyData = Object.assign({}, legacyData, {
      life_helper_plans_v2: oldPlans,
    });
  }
  const importEnvelope = Object.assign({}, data, { data: legacyData });
  const result = storageManager.importBackup(encodeBase64(JSON.stringify(importEnvelope)));
  if (!result.success) return result;
  const plans = shouldMigrateOldPlans
    ? oldPlans
    : (Array.isArray(v2Plans) ? v2Plans : []);
  return {
    success: true,
    importedCoupons: Array.isArray(coupons) ? coupons.length : 0,
    importedPlans: Array.isArray(plans) ? plans.length : 0,
    importedFriends: Array.isArray(friends) ? friends.length : 0,
    importedPreferences: preferences ? 1 : 0,
    importedSchedules: Array.isArray(legacyData.life_helper_user_schedules) ? legacyData.life_helper_user_schedules.length : 0,
    importedLocations: Array.isArray(legacyData.life_helper_location_preferences) ? legacyData.life_helper_location_preferences.length : 0,
    legacyFormat: true,
  };
}

function readDomainPayload(data = {}) {
  const nested = data.data && typeof data.data === "object" && !Array.isArray(data.data)
    && ["coupons", "plans", "preferences", "friends", "schedules", "locations"].some((key) => Object.prototype.hasOwnProperty.call(data.data, key));
  const domain = nested ? data.data : data;
  const knownKeys = ["coupons", "plans", "preferences", "friends", "schedules", "locations"];
  if (!knownKeys.some((key) => Object.prototype.hasOwnProperty.call(domain, key))) {
    throw new Error("备份数据中没有可恢复的内容");
  }
  DOMAIN_COLLECTION_KEYS.forEach((key) => assertCollectionLimits(key, domain[key]));
  if (domain.preferences !== undefined
    && (!domain.preferences || typeof domain.preferences !== "object" || Array.isArray(domain.preferences))) {
    throw new Error("备份字段 preferences 格式不正确");
  }
  if (domain.preferences !== undefined && JSON.stringify(domain.preferences).length > MAX_ITEM_CHARS) {
    throw new Error("备份字段 preferences 内容过大");
  }
  return {
    coupons: domain.coupons,
    plans: domain.plans,
    preferences: domain.preferences,
    friends: domain.friends,
    schedules: domain.schedules,
    locations: domain.locations,
  };
}

function getPlansForBackup() {
  // Export must be read-only. Calling getPlans() here seeds demo plans into an
  // empty store and makes a backup claim that sample data belonged to the user.
  return planStore.getStoredPlans() || [];
}

function buildPortableCoupons(coupons = []) {
  let omittedCount = 0;
  const portable = coupons.map((coupon) => {
    const screenshots = Array.isArray(coupon && coupon.screenshots) ? coupon.screenshots : [];
    omittedCount += screenshots.length;
    return Object.assign({}, coupon, { screenshots: [] });
  });
  return { coupons: portable, omittedCount };
}

function exportBackupPayload() {
  try {
    const couponRepository = require("./coupon/couponRepository.js");
    const storedCouponSnapshot = couponRepository.snapshotCouponStorage();
    // Public reads may present bundled demo coupons on a fresh install. A
    // portable backup contains only durable user data, never package samples
    // that merely happened to be visible.
    const couponSnapshot = buildPortableCoupons(
      Array.isArray(storedCouponSnapshot.userCoupons) ? storedCouponSnapshot.userCoupons : []
    );
    const coupons = couponSnapshot.coupons;
    const plans = getPlansForBackup();
    const preferences = preferenceStore.getPreferences() || {};
    const friends = friendStore.getFriends() || [];
    const schedules = scheduleStore.readSchedules() || [];
    const locations = locationPreferenceStore.readLocations() || [];
    const data = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      coupons,
      plans,
      preferences,
      friends,
      schedules,
      locations,
      attachments: {
        policy: ATTACHMENT_POLICY,
        omittedCount: couponSnapshot.omittedCount,
        message: "本地截图文件不包含在可移植备份中",
      },
    };
    DOMAIN_COLLECTION_KEYS.forEach((key) => assertCollectionLimits(key, data[key]));
    const serialized = JSON.stringify(data);
    assertTextSize(serialized);
    return {
      success: true,
      payload: encodeBase64(serialized),
      meta: {
        couponCount: coupons.length,
        planCount: plans.length,
        friendCount: friends.length,
        scheduleCount: schedules.length,
        locationCount: locations.length,
        attachmentPolicy: ATTACHMENT_POLICY,
        omittedAttachmentCount: couponSnapshot.omittedCount,
        hasPreferences: true,
      },
    };
  } catch (error) {
    return { success: false, error: error.message || "备份导出失败" };
  }
}

function importBackupPayload(text) {
  let rollback = null;
  try {
    const parsed = parseBackupText(text);
    validateDomainEnvelope(parsed);
    if (isLegacyStorageBackup(parsed)) return importLegacyStorageBackup(parsed);
    const data = readDomainPayload(parsed);
    // Complete semantic validation and normalization must finish before the
    // first domain write. This prevents permissive store normalizers from
    // turning malformed backup entries into plausible default records.
    const normalizedCoupons = normalizeCouponEntries(data.coupons);
    const normalizedPlans = normalizePlanEntries(data.plans);
    const normalizedFriends = normalizeFriendEntries(data.friends);
    const normalizedSchedules = normalizeScheduleEntries(data.schedules);
    const normalizedLocations = normalizeLocationEntries(data.locations);
    const normalizedPreferences = normalizePreferenceEntry(data.preferences);

    const couponRepository = require("./coupon/couponRepository.js");
    const snapshots = {
      coupons: normalizedCoupons ? couponRepository.snapshotCouponStorage() : null,
      plans: normalizedPlans ? planStore.getStoredPlans() : null,
      preferences: normalizedPreferences ? preferenceStore.getPreferences() : null,
      friends: normalizedFriends ? friendStore.readFriends() : null,
      schedules: normalizedSchedules ? scheduleStore.readSchedules() : null,
      locations: normalizedLocations ? locationPreferenceStore.readLocations() : null,
    };
    rollback = () => {
      const results = [];
      // Restore every touched domain even when one rollback write fails.
      if (snapshots.locations) results.push(locationPreferenceStore.saveLocations(snapshots.locations));
      if (snapshots.schedules) results.push(scheduleStore.saveSchedules(snapshots.schedules));
      if (snapshots.friends) results.push(friendStore.saveFriends(snapshots.friends));
      if (snapshots.preferences) results.push(preferenceStore.savePreferences(snapshots.preferences));
      if (snapshots.plans) results.push(planStore.saveStoredPlans(snapshots.plans));
      if (snapshots.coupons) results.push(couponRepository.restoreCouponStorage(snapshots.coupons));
      return results.every(Boolean);
    };

    let importedCoupons = 0;
    let importedPlans = 0;
    let importedFriends = 0;
    let importedPreferences = 0;
    let importedSchedules = 0;
    let importedLocations = 0;

    if (normalizedCoupons && normalizedCoupons.length) {
      const bulkCouponResult = couponStore.importCouponSnapshots(normalizedCoupons);
      if (!bulkCouponResult || bulkCouponResult.success !== true
        || !Array.isArray(bulkCouponResult.successIds)
        || bulkCouponResult.successIds.length !== normalizedCoupons.length) {
        throw new Error("优惠券写入失败，恢复未完成");
      }
      importedCoupons = normalizedCoupons.length;
    }
    if (normalizedPlans && normalizedPlans.length) {
      const bulkPlanResult = planStore.bulkUpsertPlans(normalizedPlans, { linkCoupon: false });
      if (!bulkPlanResult || bulkPlanResult.success !== true
        || !Array.isArray(bulkPlanResult.successIds)
        || bulkPlanResult.successIds.length !== normalizedPlans.length) {
        throw new Error("计划写入失败，恢复未完成");
      }
      importedPlans = normalizedPlans.length;
    }
    if (normalizedPreferences) {
      if (!preferenceStore.savePreferences(normalizedPreferences)) {
        throw new Error("偏好设置写入失败，恢复未完成");
      }
      importedPreferences = 1;
    }
    if (normalizedFriends) {
      const mergedFriends = friendStore.readFriends().slice();
      normalizedFriends.forEach((friend) => {
        const index = mergedFriends.findIndex((item) => (
          (friend.id && item.id === friend.id)
          || String(item.name || "").toLowerCase() === friend.name.toLowerCase()
        ));
        if (index > -1) mergedFriends[index] = Object.assign({}, mergedFriends[index], friend);
        else mergedFriends.push(friend);
      });
      if (!friendStore.saveFriends(mergedFriends)) {
        throw new Error("好友数据写入失败，恢复未完成");
      }
      importedFriends = normalizedFriends.length;
    }
    if (normalizedSchedules) {
      if (!scheduleStore.saveSchedules(normalizedSchedules)) {
        throw new Error("固定日程写入失败，恢复未完成");
      }
      importedSchedules = normalizedSchedules.length;
    }
    if (normalizedLocations) {
      if (!locationPreferenceStore.saveLocations(normalizedLocations)) {
        throw new Error("常用地点写入失败，恢复未完成");
      }
      importedLocations = normalizedLocations.length;
    }

    return {
      success: true,
      importedCoupons,
      importedPlans,
      importedFriends,
      importedPreferences,
      importedSchedules,
      importedLocations,
    };
  } catch (error) {
    let rolledBack = true;
    if (rollback) {
      try { rolledBack = rollback(); } catch (rollbackError) { rolledBack = false; }
    }
    return {
      success: false,
      error: rolledBack
        ? (error.message || "解析备份失败")
        : `${error.message || "恢复失败"}；部分数据回滚也未完成，请勿继续覆盖数据`,
      rollbackFailed: !rolledBack,
    };
  }
}

module.exports = {
  ATTACHMENT_POLICY,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  MAX_BACKUP_TEXT_CHARS,
  MAX_BACKUP_BASE64_CHARS,
  MAX_COLLECTION_ITEMS,
  MAX_ITEM_CHARS,
  exportBackupPayload,
  importBackupPayload,
};
