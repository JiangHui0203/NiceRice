const preferenceStore = require("../../utils/preferenceStore.js");
const friendStore = require("../../utils/friendStore.js");
const scheduleStore = require("../../utils/scheduleStore.js");
const locationPreferenceStore = require("../../utils/locationPreferenceStore.js");
const locationService = require("../../utils/services/locationService.js");
const backupService = require("../../utils/backupService.js");
const privacyService = require("../../utils/privacyService.js");
const cloudService = require("../../utils/services/cloudService.js");

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_PIXELS = 8 * 1024 * 1024;

function normalizeUserInfo(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const loggedIn = source.loggedIn === true;
  const isCloudBound = loggedIn && source.isCloudBound === true;
  const openid = isCloudBound ? String(source.openid || "").trim().slice(0, 128) : "";
  return {
    loggedIn,
    isCloudBound: Boolean(isCloudBound && openid),
    openid: isCloudBound ? openid : "",
    openidShort: isCloudBound && openid ? `${openid.slice(0, 8)}...` : "本地离线",
    nickName: String(source.nickName || "本地用户").trim().slice(0, 32) || "本地用户",
    avatarUrl: String(source.avatarUrl || "").trim().slice(0, 2048),
  };
}

// 1. Data Backup & Import (Base64)
function buildPrivacyView() {
  const settings = privacyService.getSettings();
  const storage = privacyService.getStorageDiagnostics();
  const cloudAvailable = cloudService.isCloudReady();
  const cloudEnabled = cloudAvailable
    && settings.localOnly !== true
    && settings.cloudUploadEnabled === true;
  return Object.assign({}, settings, {
    cloudAvailable,
    cloudEnabled,
    modeLabel: cloudEnabled ? "云端增强" : "本地保护",
    modeBadge: cloudEnabled ? "增强模式" : "隐私模式",
    itemCount: storage.itemCount,
    estimatedKb: storage.estimatedKb,
  });
}

function exportBackupToClipboard(isActive = () => true) {
  const result = backupService.exportBackupPayload();
  if (!result.success) {
    wx.showToast({ title: "备份导出失败", icon: "none" });
    return;
  }
  wx.setClipboardData({
    data: result.payload,
    success: () => {
      if (!isActive()) return;
      wx.showModal({
        title: "备份已复制到剪贴板",
        content: `共导出 ${result.meta.couponCount} 张优惠券、${result.meta.planCount} 个计划、${result.meta.scheduleCount} 条固定日程和 ${result.meta.locationCount} 个常用地点。本地截图文件不包含在可移植备份中，请妥善保存备份文本。`,
        showCancel: false,
      });
    },
    fail: () => {
      if (!isActive()) return;
      wx.showToast({ title: "复制到剪贴板失败", icon: "none" });
    },
  });
}

function importBackupFromClipboard(onSuccess, isActive = () => true) {
  wx.getClipboardData({
    success: (res) => {
      if (!isActive()) return;
      const text = String(res.data || "").trim();
      if (!text) {
        wx.showModal({
          title: "无效的备份文本",
          content: "剪贴板中未检测到合法的备份数据代码，请先复制完整的备份文本后重试。",
          showCancel: false,
        });
        return;
      }
      wx.showModal({
        title: "确认恢复数据",
        content: "恢复数据将合并或覆盖现有优惠券、计划、偏好、日程和常用地点；备份不包含本地截图文件。是否继续？",
        confirmColor: "#0f766e",
        confirmText: "立即恢复",
        success: (modalRes) => {
          if (!modalRes.confirm || !isActive()) return;
          const importResult = backupService.importBackupPayload(text);
          if (!isActive()) return;
          if (!importResult.success) {
            wx.showModal({
              title: "恢复失败",
              content: importResult.error || "备份数据解析异常",
              showCancel: false,
            });
            return;
          }
          wx.showToast({
            title: `已恢复${importResult.importedCoupons}张券和${importResult.importedPlans}个计划`,
            icon: "success",
            duration: 2000,
          });
          if (typeof onSuccess === "function") {
            setTimeout(() => {
              if (isActive()) onSuccess();
            }, 500);
          }
        },
      });
    },
    fail: () => {
      if (!isActive()) return;
      wx.showToast({ title: "无法读取剪贴板", icon: "none" });
    },
  });
}

// 2. Location Management
function editLocationDraft(locations, id) {
  const location = (locations || []).find((item) => item.id === id || item.role === id);
  if (!location) return null;
  return {
    editingLocationId: location.id,
    locationDraft: {
      name: location.name || "",
      address: location.address || "",
      desc: location.desc || "",
      latitude: location.latitude !== null && location.latitude !== undefined ? location.latitude : "",
      longitude: location.longitude !== null && location.longitude !== undefined ? location.longitude : "",
      source: location.source || "",
      selectedAt: location.selectedAt || "",
      hasMapPoint: locationPreferenceStore.hasCoordinates(location),
    },
  };
}

function chooseLocationDraftPoint(currentDraft = {}) {
  return locationService.chooseCouponLocation({
    latitude: currentDraft.latitude,
    longitude: currentDraft.longitude,
  }).then((location) => {
    return {
      name: location.name || currentDraft.name || "",
      address: location.address || currentDraft.address || "",
      latitude: location.latitude !== null && location.latitude !== undefined ? location.latitude : "",
      longitude: location.longitude !== null && location.longitude !== undefined ? location.longitude : "",
      source: location.source || "wx.chooseLocation",
      selectedAt: location.selectedAt || new Date().toISOString(),
      hasMapPoint: true,
    };
  });
}

function saveLocationDraft(id, draft) {
  if (!id) return { success: false, error: "未选择地点" };
  if (!String(draft.name || "").trim()) {
    return { success: false, error: "先填写地点名称" };
  }
  const savedLocation = locationPreferenceStore.updateLocation(id, draft);
  if (!savedLocation) {
    return { success: false, error: "地点保存失败，请重试" };
  }
  return { success: true, locations: locationPreferenceStore.readLocations() };
}

function resetAllLocations() {
  const locations = locationPreferenceStore.resetLocations();
  if (!locations) {
    return { success: false, error: "默认地点恢复失败，请重试" };
  }
  return { success: true, locations };
}

const AVATAR_COLORS = [
  "linear-gradient(135deg, #0d9488, #14b8a6)",
  "linear-gradient(135deg, #0284c7, #38bdf8)",
  "linear-gradient(135deg, #7c3aed, #a855f7)",
  "linear-gradient(135deg, #ea580c, #f97316)",
  "linear-gradient(135deg, #059669, #34d399)",
];

function formatFriendsForView(friends = []) {
  return (friends || []).map((f, idx) => {
    const name = String(f.name || "好友").trim();
    const avatarChar = name ? name.slice(0, 1) : "友";
    const avatarBg = AVATAR_COLORS[idx % AVATAR_COLORS.length];

    const slots = (f.slots || f.availableSlots || []).filter(Boolean);
    const restrictions = (f.restrictions || (f.foodPreferences && f.foodPreferences.dietaryRestrictions) || []).filter(Boolean);
    const travelText = f.travel || (f.travelPreference && f.travelPreference.preferredRegion) || "出行偏好待补充";

    return Object.assign({}, f, {
      name,
      avatarChar,
      avatarBg,
      slots,
      restrictions,
      travelText,
      hasSlots: slots.length > 0,
      hasRestrictions: restrictions.length > 0,
      statusLabel: slots.length > 0 ? `${slots.length}个空闲时段` : "空档待添加",
    });
  });
}

// 3. Friend & Schedule Management
function addFriendService(name) {
  const value = String(name || "").trim();
  if (!value) return { success: false, error: "请先输入朋友名字" };
  let selfName = "我";
  try {
    selfName = String(privacyService.readLocalData("life_helper_self_name", "我") || "我");
  } catch (error) {}
  if (value === "我" || value.toLowerCase() === selfName.toLowerCase()) {
    return { success: false, error: "不能添加与自己重名的好友" };
  }
  const existingFriends = friendStore.readFriends();
  if (existingFriends.some((friend) => String(friend.name || "").toLowerCase() === value.toLowerCase())) {
    return { success: false, error: "该好友已存在" };
  }
  const friend = friendStore.addFriend(value);
  if (!friend) return { success: false, error: "好友保存失败，请重试" };
  return { success: true, friend, friends: formatFriendsForView(friendStore.readFriends()) };
}

function addFriendSlotService(id, slotText) {
  if (!String(slotText || "").trim()) {
    return { success: false, error: "先填写可约时段" };
  }
  const friend = friendStore.addFriendSlot(id, slotText);
  if (!friend) return { success: false, error: "时段保存失败，请重试" };
  return { success: true, friends: formatFriendsForView(friendStore.readFriends()) };
}

function addFriendRestrictionService(id, text) {
  if (!String(text || "").trim()) {
    return { success: false, error: "先填写饮食忌口" };
  }
  const friend = friendStore.addFriendRestriction(id, text);
  if (!friend) return { success: false, error: "忌口保存失败，请重试" };
  return { success: true, friends: formatFriendsForView(friendStore.readFriends()) };
}

function findFriendByIdentity(friends, friendId) {
  const source = Array.isArray(friends) ? friends : [];
  return source.find((item) => item && item.id && item.id === friendId)
    || source.find((item) => item && !item.id && item.name === friendId)
    || null;
}

function removeFriendSlotService(_friends, friendId, slot) {
  const storedFriends = friendStore.readFriends();
  const friend = findFriendByIdentity(storedFriends, friendId);
  if (!friend) return { success: false, error: "好友不存在或已移除" };
  const slots = (friend.slots || []).filter(s => s !== slot);
  if (slots.length === (friend.slots || []).length) {
    return { success: false, error: "该时段已不存在" };
  }
  const updatedFriend = friendStore.updateFriend(friend.id || friend.name, { slots });
  if (!updatedFriend) return { success: false, error: "删除时段失败，请重试" };
  return { success: true, friends: formatFriendsForView(friendStore.readFriends()) };
}

function removeFriendRestrictionService(_friends, friendId, restriction) {
  const storedFriends = friendStore.readFriends();
  const friend = findFriendByIdentity(storedFriends, friendId);
  if (!friend) return { success: false, error: "好友不存在或已移除" };
  const restrictions = (friend.restrictions || []).filter(r => r !== restriction);
  if (restrictions.length === (friend.restrictions || []).length) {
    return { success: false, error: "该忌口已不存在" };
  }
  const updatedFriend = friendStore.updateFriend(friend.id || friend.name, { restrictions });
  if (!updatedFriend) return { success: false, error: "删除忌口失败，请重试" };
  return { success: true, friends: formatFriendsForView(friendStore.readFriends()) };
}

function updateFriendTravelService(friendId, travel) {
  const friend = friendStore.updateFriend(friendId, { travel });
  if (!friend) return { success: false, error: "出行偏好保存失败，请重试" };
  return { success: true, friends: formatFriendsForView(friendStore.readFriends()) };
}

function removeFriendService(id) {
  if (!friendStore.removeFriend(id)) {
    return { success: false, error: "好友移除失败，请重试" };
  }
  return { success: true, friends: formatFriendsForView(friendStore.readFriends()) };
}

function addScheduleService(draft) {
  if (!String(draft || "").trim()) {
    return { success: false, error: "先填写固定日程" };
  }
  if (!scheduleStore.parseScheduleText(draft)) {
    return { success: false, error: "请按“周三 14:00-16:00 组会”填写有效时段" };
  }
  const schedule = scheduleStore.addSchedule(draft);
  if (!schedule) return { success: false, error: "日程保存失败，请重试" };
  return { success: true, schedules: scheduleStore.readSchedules() };
}

function removeScheduleService(id) {
  if (!scheduleStore.removeSchedule(id)) {
    return { success: false, error: "日程删除失败，请重试" };
  }
  return { success: true, schedules: scheduleStore.readSchedules() };
}

// 4. WeChat Authentication & Profile
function performWechatLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          reject(new Error("登录凭证获取失败"));
          return;
        }
        const cloudReady = cloudService.isCloudReady();

        const finalizeUser = (openid, isCloudBound = false) => {
          const previousUser = normalizeUserInfo(privacyService.readLocalData("life_helper_user_info", null));
          const newUser = normalizeUserInfo({
            loggedIn: true,
            isCloudBound,
            openid: isCloudBound ? openid : "",
            nickName: previousUser.nickName,
            avatarUrl: previousUser.avatarUrl,
          });
          if (!privacyService.writeLocalData("life_helper_user_info", newUser)) {
            reject(new Error("用户信息保存失败"));
            return;
          }
          if (isCloudBound && !privacyService.saveSettings({ cloudUploadEnabled: true, localOnly: false })) {
            const rolledBack = privacyService.writeLocalData("life_helper_user_info", previousUser);
            reject(new Error(rolledBack ? "云端隐私设置保存失败" : "云端隐私设置保存失败，且用户信息回滚失败"));
            return;
          }
          resolve(newUser);
        };

        if (cloudReady && wx.cloud) {
          wx.cloud.callFunction({
            name: "lifeServices",
            data: { type: "getOpenId" },
            success: (res) => {
              const realOpenid = res && res.result && res.result.openid;
              if (realOpenid) {
                finalizeUser(realOpenid, true);
              } else {
                finalizeUser("", false);
              }
            },
            fail: () => {
              finalizeUser("", false);
            }
          });
        } else {
          finalizeUser("", false);
        }
      },
      fail: (err) => reject(err)
    });
  });
}

function removeSavedAvatar(filePath) {
  if (!filePath || String(filePath).indexOf("wxfile://usr/") !== 0
    || typeof wx === "undefined" || typeof wx.removeSavedFile !== "function") return;
  wx.removeSavedFile({ filePath, fail() {} });
}

function persistAvatarFile(tempFilePath) {
  if (!tempFilePath) return Promise.reject(new Error("没有选择头像"));
  if (String(tempFilePath).indexOf("wxfile://usr/") === 0) return Promise.resolve(tempFilePath);
  return new Promise((resolve, reject) => {
    if (typeof wx === "undefined" || typeof wx.saveFile !== "function") {
      reject(new Error("当前环境无法持久化头像"));
      return;
    }
    wx.saveFile({
      tempFilePath,
      success(res) {
        if (res && res.savedFilePath) resolve(res.savedFilePath);
        else reject(new Error("头像文件保存失败"));
      },
      fail: reject,
    });
  });
}

function validateAvatarFile(tempFilePath) {
  const path = String(tempFilePath || "").trim();
  if (!path) return Promise.reject(new Error("没有选择头像"));
  const dimensionCheck = typeof wx !== "undefined" && typeof wx.getImageInfo === "function"
    ? new Promise((resolve, reject) => {
      wx.getImageInfo({
        src: path,
        success(res) {
          const width = Number(res && res.width);
          const height = Number(res && res.height);
          if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
            || width * height > MAX_AVATAR_PIXELS) {
            reject(new Error("头像分辨率过高或格式无效"));
            return;
          }
          resolve();
        },
        fail: () => reject(new Error("无法读取头像图片")),
      });
    })
    : Promise.resolve();
  const sizeCheck = () => {
    if (typeof wx === "undefined" || typeof wx.getFileInfo !== "function") return Promise.resolve();
    return new Promise((resolve, reject) => {
      wx.getFileInfo({
        filePath: path,
        success(res) {
          const size = Number(res && res.size);
          if (!Number.isFinite(size) || size < 0 || size > MAX_AVATAR_BYTES) {
            reject(new Error("头像文件过大或无法确认大小"));
            return;
          }
          resolve();
        },
        fail: () => reject(new Error("无法读取头像文件")),
      });
    });
  };
  return dimensionCheck.then(sizeCheck).then(() => path);
}

function updateAvatar(userInfo, avatarUrl) {
  const currentUser = normalizeUserInfo(userInfo);
  const previousAvatar = currentUser.avatarUrl;
  return validateAvatarFile(avatarUrl).then(persistAvatarFile).then((savedFilePath) => {
    const updated = normalizeUserInfo(Object.assign({}, currentUser, { avatarUrl: savedFilePath }));
    if (!privacyService.writeLocalData("life_helper_user_info", updated)) {
      if (savedFilePath !== previousAvatar) removeSavedAvatar(savedFilePath);
      throw new Error("头像信息保存失败");
    }
    if (previousAvatar && previousAvatar !== savedFilePath) removeSavedAvatar(previousAvatar);
    return updated;
  });
}

function updateNickname(userInfo, nickName) {
  const value = String(nickName || "").trim().slice(0, 32);
  if (!value) return normalizeUserInfo(userInfo);
  const updated = normalizeUserInfo(Object.assign({}, userInfo, { nickName: value }));
  return privacyService.writeLocalData("life_helper_user_info", updated) ? updated : null;
}

module.exports = {
  buildPrivacyView,
  exportBackupToClipboard,
  importBackupFromClipboard,
  editLocationDraft,
  chooseLocationDraftPoint,
  saveLocationDraft,
  resetAllLocations,
  addFriendService,
  addFriendSlotService,
  addFriendRestrictionService,
  removeFriendSlotService,
  removeFriendRestrictionService,
  updateFriendTravelService,
  removeFriendService,
  addScheduleService,
  removeScheduleService,
  performWechatLogin,
  updateAvatar,
  updateNickname,
  formatFriendsForView,
  normalizeUserInfo,
  MAX_AVATAR_BYTES,
  MAX_AVATAR_PIXELS,
};
