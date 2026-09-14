const privacyService = require("./privacyService.js");
const { getWx } = require("./wechatRuntime.js");

const FRIEND_KEY = "life_helper_friends";
const MAX_FRIENDS = 100;
const MAX_FRIEND_SLOTS = 64;
const MAX_FRIEND_RESTRICTIONS = 32;
const MAX_RESTRICTION_LENGTH = 64;
const RESERVED_FRIEND_IDS = new Set(["__proto__", "constructor", "prototype"]);

function normalizeOptionalFriendId(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id !== value || Array.from(id).length > 96 || RESERVED_FRIEND_IDS.has(id)) return null;
  return id;
}

function normalizeClock(value) {
  const matched = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return "";
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (hour > 23 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeAvailabilitySlot(value) {
  const text = String(value || "").trim().replace(/^星期/, "周").replace(/^周天/, "周日");
  const range = text.match(/^(周[一二三四五六日])\s+(\d{1,2}:\d{2})\s*[-至到]\s*(\d{1,2}:\d{2})$/);
  if (range) {
    const start = normalizeClock(range[2]);
    const end = normalizeClock(range[3]);
    return start && end && start !== end ? `${range[1]} ${start}-${end}` : "";
  }
  const after = text.match(/^(周[一二三四五六日])\s+(\d{1,2}:\d{2})\s*(?:后|以后)$/);
  if (after) {
    const start = normalizeClock(after[2]);
    return start ? `${after[1]} ${start}后` : "";
  }
  return "";
}

function normalizeRestriction(value) {
  return typeof value === "string" ? value.trim().slice(0, MAX_RESTRICTION_LENGTH) : "";
}

function normalizeFriend(friend) {
  if (!friend || typeof friend !== "object" || Array.isArray(friend)) return null;
  const name = typeof friend.name === "string" ? friend.name.trim() : "";
  if (!name || Array.from(name).length > 24) return null;
  const id = normalizeOptionalFriendId(friend.id);
  const inviterId = normalizeOptionalFriendId(friend.inviterId);
  if (id === null || inviterId === null) return null;
  const legacyAutomaticTravel = id.startsWith("friend_")
    && friend.travel === "单程不超过 45 分钟"
    && !friend.travelPreference;
  const rawSlots = Array.isArray(friend.slots) ? friend.slots : friend.availableSlots;
  const legacyRestrictions = friend.foodPreferences && typeof friend.foodPreferences === "object"
    && !Array.isArray(friend.foodPreferences)
    ? friend.foodPreferences.dietaryRestrictions
    : [];
  const rawRestrictions = Array.isArray(friend.restrictions) ? friend.restrictions : legacyRestrictions;
  const legacyTravel = friend.travelPreference && typeof friend.travelPreference === "object"
    && !Array.isArray(friend.travelPreference)
    ? friend.travelPreference.preferredRegion
    : "";
  return {
    id,
    name,
    inviterId,
    status: String(friend.status || "").trim().slice(0, 32),
    slots: Array.isArray(rawSlots) ? [...new Set(rawSlots.slice(0, MAX_FRIEND_SLOTS)
      .map(normalizeAvailabilitySlot)
      .filter(Boolean))]
      .slice(0, MAX_FRIEND_SLOTS) : [],
    restrictions: Array.isArray(rawRestrictions) ? rawRestrictions
      .slice(0, MAX_FRIEND_RESTRICTIONS)
      .reduce((result, item) => {
        const restriction = normalizeRestriction(item);
        if (!restriction) return result;
        const normalizedKey = restriction.toLowerCase();
        if (result.some((existing) => existing.toLowerCase() === normalizedKey)) return result;
        if (result.length < MAX_FRIEND_RESTRICTIONS) result.push(restriction);
        return result;
      }, []) : [],
    travel: legacyAutomaticTravel ? "" : String(friend.travel || legacyTravel || "").trim().slice(0, 64),
  };
}

function normalizeFriends(friends) {
  const ids = new Set();
  const names = new Set();
  return (Array.isArray(friends) ? friends : []).slice(0, MAX_FRIENDS).reduce((result, item) => {
    const friend = normalizeFriend(item);
    if (!friend) return result;
    const nameKey = friend.name.toLocaleLowerCase();
    if ((friend.id && ids.has(friend.id)) || names.has(nameKey)) return result;
    if (friend.id) ids.add(friend.id);
    names.add(nameKey);
    result.push(friend);
    return result;
  }, []);
}

function readFriends() {
  try {
    const stored = privacyService.readLocalData(FRIEND_KEY, null);
    if (Array.isArray(stored)) return normalizeFriends(stored);
  } catch (e) {
    return [];
  }
  // 好友与空档只能来自用户添加或分享导入，不能用演示人物参与真实推荐。
  return [];
}

function saveFriends(friends) {
  if (!Array.isArray(friends) || friends.length > MAX_FRIENDS) return false;
  const normalized = friends.map(normalizeFriend);
  if (normalized.some((friend) => !friend)) return false;
  const idKeys = normalized.map((friend) => friend.id).filter(Boolean);
  const nameKeys = normalized.map((friend) => friend.name.toLocaleLowerCase());
  if (new Set(idKeys).size !== idKeys.length || new Set(nameKeys).size !== nameKeys.length) return false;
  const success = privacyService.writeLocalData(FRIEND_KEY, normalized);
  if (!success) console.warn("friend storage failed");
  return success;
}

function addFriend(name) {
  const rawValue = String(name || "").trim();
  if (!rawValue || rawValue.length > 24) return null;
  const value = rawValue;

  const api = getWx();
  let selfName = "我";
  try {
    selfName = String(privacyService.readLocalData("life_helper_self_name", "我") || "我");
  } catch (error) {}
  if (value.toLowerCase() === "我" || value.toLowerCase() === selfName.toLowerCase()) {
    if (api && typeof api.showToast === "function") {
      api.showToast({
        title: "不能添加与自己重名的好友",
        icon: "none",
      });
    }
    return null;
  }

  const friends = readFriends();
  if (friends.length >= MAX_FRIENDS) {
    if (api && typeof api.showToast === "function") {
      api.showToast({ title: `最多添加 ${MAX_FRIENDS} 位好友`, icon: "none" });
    }
    return null;
  }
  const exists = friends.some((friend) => String(friend.name || "").toLowerCase() === value.toLowerCase());
  if (exists) {
    if (api && typeof api.showToast === "function") {
      api.showToast({
        title: "该好友已存在",
        icon: "none",
      });
    }
    return null;
  }
  const friend = {
    id: `friend_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: value,
    status: "本地可约时间",
    slots: [],
    restrictions: [],
    travel: "",
  };
  if (!saveFriends(friends.concat(friend))) return null;
  return friend;
}

function findFriendIndex(friends, friendId) {
  const exactId = normalizeOptionalFriendId(friendId);
  if (!exactId) return -1;
  const idIndex = friends.findIndex((friend) => friend.id === exactId);
  if (idIndex > -1) return idIndex;
  // Name fallback exists only for truly legacy records without an ID. Mixing
  // the two namespaces lets one friend's name shadow another friend's ID.
  return friends.findIndex((friend) => !friend.id && friend.name === exactId);
}

function updateFriend(friendId, patch) {
  const friends = readFriends();
  const index = findFriendIndex(friends, friendId);
  if (index === -1) return null;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return null;
  if (Object.prototype.hasOwnProperty.call(patch, "id")) {
    const nextId = normalizeOptionalFriendId(patch.id);
    if (nextId === null || nextId !== friends[index].id) return null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "name")) {
    const nextName = typeof patch.name === "string" ? patch.name.trim() : "";
    // Renaming is a cross-domain participant migration and must not happen
    // through the ordinary preference patch API.
    if (!nextName || nextName !== friends[index].name) return null;
  }
  const updatedFriend = normalizeFriend(Object.assign({}, friends[index], patch));
  if (!updatedFriend) return null;
  friends[index] = updatedFriend;
  if (!saveFriends(friends)) return null;
  return updatedFriend;
}

function removeFriend(friendId) {
  const originalFriends = readFriends();
  const friends = originalFriends.slice();
  const index = findFriendIndex(friends, friendId);
  if (index === -1) return false;
  const friend = friends[index];
  const targetFriendId = friend.id;
  const targetFriendName = friend.name;
  friends.splice(index, 1);
  let planStore = null;
  let originalPlans = null;
  let plansChanged = false;
  let planWriteAttempted = false;
  const restoreOriginalState = () => {
    let plansRestored = true;
    let friendsRestored = true;
    if (planWriteAttempted && planStore && Array.isArray(originalPlans)) {
      try { plansRestored = planStore.saveStoredPlans(originalPlans); } catch (error) { plansRestored = false; }
    }
    try { friendsRestored = saveFriends(originalFriends); } catch (error) { friendsRestored = false; }
    if (!plansRestored || !friendsRestored) {
      console.error("Failed to fully roll back friend removal", {
        plansRestored,
        friendsRestored,
      });
    }
    return Boolean(plansRestored && friendsRestored);
  };
  try {
    planStore = require("./planStore.js");
    originalPlans = planStore.getStoredPlans();
    const nextPlans = originalPlans.map((plan) => {
      const participants = plan.participants || [];
      const matchesTargetFriend = (participant) => {
        if (targetFriendId && participant.id === targetFriendId) return true;
        const participantId = typeof participant.id === "string" ? participant.id : "";
        const legacyIdentity = !participantId || /^participant_\d+$/.test(participantId);
        return legacyIdentity && participant.name === targetFriendName;
      };
      const hasFriend = participants.some((participant) => (
        matchesTargetFriend(participant)
      ));
      if (!hasFriend) return plan;
      plansChanged = true;
      const nextParticipants = participants.filter((participant) => !matchesTargetFriend(participant));
      const patch = { participants: nextParticipants };
      if (nextParticipants.length <= 1) {
        if (plan.statusCode === "pending") patch.statusCode = "confirmed";
        patch.friendDecision = "none";
      }
      return Object.assign({}, plan, patch);
    });
    if (plansChanged) {
      planWriteAttempted = true;
      if (!planStore.saveStoredPlans(nextPlans)) {
        restoreOriginalState();
        return false;
      }
    }
    if (!saveFriends(friends)) {
      restoreOriginalState();
      return false;
    }
    return true;
  } catch (e) {
    console.error("Failed to clean up plan participants on friend remove:", e);
    restoreOriginalState();
    return false;
  }
}

function addFriendSlot(friendId, slot) {
  const value = normalizeAvailabilitySlot(slot);
  if (!value) return null;
  const friends = readFriends();
  const index = findFriendIndex(friends, friendId);
  if (index === -1) return null;
  const friend = friends[index];
  const slots = Array.isArray(friend.slots) ? friend.slots : [];
  if (slots.includes(value) || slots.length >= MAX_FRIEND_SLOTS) return null;
  return updateFriend(friendId, { slots: slots.concat(value) });
}

function addFriendRestriction(friendId, restriction) {
  const rawValue = typeof restriction === "string" ? restriction.trim() : "";
  if (!rawValue || rawValue.length > MAX_RESTRICTION_LENGTH) return null;
  const value = normalizeRestriction(rawValue);
  const friends = readFriends();
  const index = findFriendIndex(friends, friendId);
  if (index === -1) return null;
  const friend = friends[index];
  const restrictions = Array.isArray(friend.restrictions) ? friend.restrictions : [];
  if (restrictions.length >= MAX_FRIEND_RESTRICTIONS
    || restrictions.some((item) => item.toLowerCase() === value.toLowerCase())) return null;
  return updateFriend(friendId, { restrictions: restrictions.concat(value) });
}

module.exports = {
  addFriend,
  addFriendRestriction,
  addFriendSlot,
  readFriends,
  getFriends: readFriends,
  removeFriend,
  saveFriends,
  updateFriend,
  normalizeFriend,
  normalizeAvailabilitySlot,
  MAX_FRIENDS,
  MAX_FRIEND_SLOTS,
  MAX_FRIEND_RESTRICTIONS,
  MAX_RESTRICTION_LENGTH,
};
