const PROFILE_KEY = "life_helper_profile_preferences";
const privacyService = require("./privacyService.js");
const MAX_PREFERENCE_LABEL_CHARS = 32;
const MAX_FOOD_SELECTIONS = 50;
const MAX_CUSTOM_FOODS = 40;
const MAX_GROUP_SELECTIONS = 16;

const optionGroups = [
  {
    key: "time",
    title: "时间",
    theme: "profile-theme-1",
    options: ["工作日前夜不想太晚", "晚上 22:00 后不出门", "周末上午不安排", "午饭最多 1 小时", "晚饭最多 2.5 小时"],
  },
  {
    key: "cleanup",
    title: "清洁",
    theme: "profile-theme-2",
    options: ["火锅后需要洗澡洗头", "烧烤后需要洗澡洗头", "烤肉后需要换衣服", "户外活动后需要洗澡", "运动后需要洗澡"],
  },
  {
    key: "travel",
    title: "偏好",
    theme: "profile-theme-0",
    options: ["雨天不想走太远", "优先地铁直达", "不喜欢换乘太多"],
  },
];

const foodCommonOptions = [
  "香菜",
  "葱姜蒜",
  "辣",
  "太辣",
  "清淡",
  "热汤",
  "牛肉",
  "羊肉",
  "猪肉",
  "鸡肉",
  "鱼",
  "虾蟹",
  "贝类",
  "海鲜",
  "内脏",
  "肥肠",
  "毛肚",
  "鸭血",
  "脑花",
  "蘑菇",
  "豆制品",
  "鸡蛋",
  "乳制品",
  "花生",
  "芝麻",
  "酒精",
  "咖啡",
  "奶茶",
  "甜食",
  "油炸",
  "重油",
  "烧烤",
  "火锅",
  "粉面",
  "米饭",
  "生食",
  "芥末",
  "酸菜",
  "榴莲",
  "排长队",
];

const defaultPreferences = {
  likedFoods: [],
  dislikedFoods: [],
  customFoods: [],
  time: [],
  cleanup: [],
  travel: [],
  commuteLimit: "",
  rainMode: "",
  transportMode: "transit",
  maxTravelDuration: 45,
  priceSensitivity: "medium",
  homeCity: "",
};

function unique(list) {
  const normalized = (Array.isArray(list) ? list : [])
    .slice(0, 100)
    .filter((item) => typeof item === "string" || typeof item === "number")
    .map((item) => String(item).trim().slice(0, 64))
    .filter(Boolean);
  return normalized.filter((item, index, array) => array.indexOf(item) === index).slice(0, 100);
}

function uniqueBounded(list, maxItems, maxChars = MAX_PREFERENCE_LABEL_CHARS) {
  const normalized = (Array.isArray(list) ? list : [])
    .slice(0, maxItems)
    .filter((item) => typeof item === "string" || typeof item === "number")
    .map((item) => String(item).trim().slice(0, maxChars))
    .filter(Boolean);
  return normalized
    .filter((item, index, array) => array.indexOf(item) === index)
    .slice(0, maxItems);
}

function normalizeLegacyFood(label) {
  const map = {
    不吃内脏: "内脏",
    少辣: "太辣",
    不想排长队: "排长队",
    不喜欢太油: "重油",
    不吃海鲜: "海鲜",
    不吃生食: "生食",
  };
  if (map[label]) return map[label];
  return label.replace(/^不吃/, "").replace(/^不喜欢/, "").replace(/^不想/, "");
}

function normalizeGroupValue(key, label) {
  const map = {
    time: {
      工作日前夜不太晚: "工作日前夜不想太晚",
      "22:00 后不出门": "晚上 22:00 后不出门",
      周末上午尽量空出来: "周末上午不安排",
    },
    cleanup: {
      火锅后洗澡洗头: "火锅后需要洗澡洗头",
      烧烤后换衣服: "烧烤后需要洗澡洗头",
      户外后预留整理时间: "户外活动后需要洗澡",
    },
    travel: {
      雨天少步行: "雨天不想走太远",
    },
  };
  return map[key] && map[key][label] ? map[key][label] : label;
}

function getAllowedGroupValues(key) {
  const group = optionGroups.find((item) => item.key === key);
  return group ? group.options : [];
}

function normalizeTextField(value, maxLength, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength);
}

function normalizePreferences(value = {}) {
  const stored = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const preferences = Object.assign({}, defaultPreferences);
  let dislikedFoods = stored.dislikedFoods;
  if ((!Array.isArray(stored.dislikedFoods) || !stored.dislikedFoods.length)
    && Array.isArray(stored.food) && stored.food.length) {
    dislikedFoods = uniqueBounded(stored.food, MAX_FOOD_SELECTIONS).map(normalizeLegacyFood);
  }
  preferences.likedFoods = uniqueBounded(stored.likedFoods, MAX_FOOD_SELECTIONS);
  preferences.dislikedFoods = uniqueBounded(dislikedFoods, MAX_FOOD_SELECTIONS)
    .filter((label) => preferences.likedFoods.indexOf(label) === -1);
  preferences.customFoods = uniqueBounded(uniqueBounded(stored.customFoods, MAX_CUSTOM_FOODS).concat(
    preferences.likedFoods.concat(preferences.dislikedFoods)
      .filter((label) => foodCommonOptions.indexOf(label) === -1)
  ), MAX_CUSTOM_FOODS);
  ["time", "cleanup", "travel"].forEach((key) => {
    const allowed = getAllowedGroupValues(key);
    preferences[key] = uniqueBounded(stored[key], MAX_GROUP_SELECTIONS)
      .map((label) => normalizeGroupValue(key, label))
      .filter((label) => allowed.includes(label));
  });
  preferences.commuteLimit = normalizeTextField(stored.commuteLimit, 32, defaultPreferences.commuteLimit);
  preferences.rainMode = normalizeTextField(stored.rainMode, 64, defaultPreferences.rainMode);
  preferences.homeCity = normalizeTextField(stored.homeCity, 64, defaultPreferences.homeCity);
  preferences.transportMode = ["transit", "walking", "driving", "cycling"].includes(stored.transportMode)
    ? stored.transportMode
    : defaultPreferences.transportMode;
  preferences.priceSensitivity = ["low", "medium", "high"].includes(stored.priceSensitivity)
    ? stored.priceSensitivity
    : defaultPreferences.priceSensitivity;
  const maxTravelDuration = stored.maxTravelDuration === "" || stored.maxTravelDuration === null
    || stored.maxTravelDuration === undefined
    ? NaN
    : Number(stored.maxTravelDuration);
  preferences.maxTravelDuration = Number.isFinite(maxTravelDuration)
    ? Math.max(5, Math.min(240, Math.round(maxTravelDuration)))
    : defaultPreferences.maxTravelDuration;
  return preferences;
}

function isValidPreferenceArray(value, maxItems, allowedValues) {
  if (value === undefined || value === null) return true;
  if (!Array.isArray(value) || value.length > maxItems) return false;
  return value.every((item) => {
    if (typeof item !== "string") return false;
    const label = item.trim();
    if (!label || label.length > MAX_PREFERENCE_LABEL_CHARS) return false;
    return !allowedValues || allowedValues.includes(label);
  });
}

function normalizePreferencesForImport(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const foodFields = ["likedFoods", "dislikedFoods", "food"];
  if (foodFields.some((field) => !isValidPreferenceArray(value[field], MAX_FOOD_SELECTIONS))) return null;
  if (!isValidPreferenceArray(value.customFoods, MAX_CUSTOM_FOODS)) return null;
  for (let index = 0; index < optionGroups.length; index += 1) {
    const group = optionGroups[index];
    const values = value[group.key];
    if (values === undefined || values === null) continue;
    if (!Array.isArray(values) || values.length > MAX_GROUP_SELECTIONS) return null;
    const allowed = group.options;
    const valid = values.every((item) => {
      if (typeof item !== "string") return false;
      const label = item.trim();
      return Boolean(label && label.length <= MAX_PREFERENCE_LABEL_CHARS
        && allowed.includes(normalizeGroupValue(group.key, label)));
    });
    if (!valid) return null;
  }
  const textLimits = { commuteLimit: 32, rainMode: 64, homeCity: 64 };
  const textFields = Object.keys(textLimits);
  if (textFields.some((field) => value[field] !== undefined && value[field] !== null
    && (typeof value[field] !== "string" || value[field].trim().length > textLimits[field]))) return null;
  if (value.transportMode !== undefined
    && !["transit", "walking", "driving", "cycling"].includes(value.transportMode)) return null;
  if (value.priceSensitivity !== undefined
    && !["low", "medium", "high"].includes(value.priceSensitivity)) return null;
  if (value.maxTravelDuration !== undefined) {
    if (value.maxTravelDuration === "" || value.maxTravelDuration === null) return null;
    const minutes = Number(value.maxTravelDuration);
    if (!Number.isFinite(minutes) || !Number.isInteger(minutes) || minutes < 5 || minutes > 240) return null;
  }

  const rawLiked = uniqueBounded(value.likedFoods, MAX_FOOD_SELECTIONS);
  const rawDisliked = Array.isArray(value.dislikedFoods) && value.dislikedFoods.length
    ? uniqueBounded(value.dislikedFoods, MAX_FOOD_SELECTIONS)
    : uniqueBounded(value.food, MAX_FOOD_SELECTIONS).map(normalizeLegacyFood);
  if (rawLiked.some((label) => rawDisliked.includes(label))) return null;
  const customUnion = uniqueBounded((value.customFoods || []).concat(rawLiked, rawDisliked)
    .filter((label) => foodCommonOptions.indexOf(label) === -1), MAX_CUSTOM_FOODS + (MAX_FOOD_SELECTIONS * 2));
  if (customUnion.length > MAX_CUSTOM_FOODS) return null;
  return normalizePreferences(value);
}

function readPreferences() {
  try {
    return normalizePreferences(privacyService.readLocalData(PROFILE_KEY, {}));
  } catch (e) {
    return normalizePreferences(defaultPreferences);
  }
}

function savePreferences(preferences) {
  const normalized = normalizePreferencesForImport(preferences);
  if (!normalized) return false;
  return privacyService.writeLocalData(PROFILE_KEY, normalized);
}

function buildGroups(preferences) {
  return optionGroups.map((group) => ({
    key: group.key,
    title: group.title,
    theme: group.theme,
    options: group.options.map((label) => ({
      label,
      selected: (preferences[group.key] || []).indexOf(label) > -1,
    })),
  }));
}

function buildFoodOptions(preferences) {
  const likedFoods = preferences.likedFoods || [];
  const dislikedFoods = preferences.dislikedFoods || [];
  const customFoods = preferences.customFoods || [];
  return unique(foodCommonOptions.concat(customFoods, likedFoods, dislikedFoods)).map((label) => ({
    label,
    liked: likedFoods.indexOf(label) > -1,
    disliked: dislikedFoods.indexOf(label) > -1,
  }));
}

function buildFoodDraft(preferences) {
  return {
    likedFoods: unique(preferences.likedFoods || []),
    dislikedFoods: unique(preferences.dislikedFoods || []),
    customFoods: unique(preferences.customFoods || []),
  };
}

module.exports = {
  defaultPreferences,
  foodCommonOptions,
  MAX_CUSTOM_FOODS,
  MAX_FOOD_SELECTIONS,
  MAX_GROUP_SELECTIONS,
  MAX_PREFERENCE_LABEL_CHARS,
  unique,
  normalizePreferences,
  normalizePreferencesForImport,
  readPreferences,
  getPreferences: readPreferences,
  savePreferences,
  buildGroups,
  buildFoodOptions,
  buildFoodDraft,
};
