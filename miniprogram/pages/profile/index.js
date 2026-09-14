const preferenceStore = require("../../utils/preferenceStore.js");
const friendStore = require("../../utils/friendStore.js");
const scheduleStore = require("../../utils/scheduleStore.js");
const locationPreferenceStore = require("../../utils/locationPreferenceStore.js");
const activityLogStore = require("../../utils/activityLogStore.js");
const privacyService = require("../../utils/privacyService.js");
const haptics = require("../../utils/haptics.js");
const {
  buildPrivacyView,
  formatFriendsForView,
  normalizeUserInfo,
} = require("./profileHelper.js");
const preferenceHandlers = require("./handlers/preferenceHandlers.js");
const privacyHandlers = require("./handlers/privacyHandlers.js");
const locationHandlers = require("./handlers/locationHandlers.js");
const scheduleHandlers = require("./handlers/scheduleHandlers.js");
const friendHandlers = require("./handlers/friendHandlers.js");
const accountBackupHandlers = require("./handlers/accountBackupHandlers.js");
const weatherHandlers = require("./handlers/weatherHandlers.js");

const FRIEND_RENDER_PAGE_SIZE = 20;
const SCHEDULE_RENDER_PAGE_SIZE = 40;

const pageConfig = {
  data: {
    version: "v0.7.4",
    preferences: preferenceStore.defaultPreferences,
    preferenceGroups: preferenceStore.buildGroups(preferenceStore.defaultPreferences),
    transportModes: [
      { id: "transit", label: "公共交通" },
      { id: "walking", label: "步行优先" },
      { id: "driving", label: "驾车/打车" },
      { id: "cycling", label: "骑行优先" },
    ],
    transportModeIndex: 0,
    locations: [],
    editingLocationId: "",
    locationDraft: {},
    friends: [],
    friendTotal: 0,
    friendDraftName: "",
    friendDraftRegion: "",
    friendDraftRestrictions: "",
    scheduleDraft: "",
    schedules: [],
    scheduleTotal: 0,
    weather: {},
    weatherOptions: [],
    categories: [],
    activeCategory: "sunny",
    activeSubWeathers: [],
    isWeatherOverride: false,
    activityStats: { completedCount: 0, totalSaved: "0.0" },
    activeSections: {
      privacy: true,
      preferences: false,
      weather: false,
      locations: false,
      schedules: false,
      friends: false,
    },
    privacySummaryText: "",
    preferencesSummaryText: "",
    weatherSummaryText: "",
    locationSummaryText: "",
    scheduleSummaryText: "",
    friendSummaryText: "",
  },

  onLoad() {
    this.unloaded = false;
    this.hidden = false;
    this.allFriends = [];
    this.allSchedules = [];
    this.friendVisibleCount = FRIEND_RENDER_PAGE_SIZE;
    this.scheduleVisibleCount = SCHEDULE_RENDER_PAGE_SIZE;
  },

  onShow() {
    if (this.unloaded) return;
    this.hidden = false;
    const preferences = preferenceStore.readPreferences();
    let userInfo = normalizeUserInfo();
    try { userInfo = normalizeUserInfo(privacyService.readLocalData("life_helper_user_info", null)); } catch (error) {}
    const activityStats = activityLogStore.getStatisticsSummary();
    const weatherState = weatherHandlers.getWeatherState(this);
    const currentMode = preferences.transportMode || "transit";
    const transportModeIndex = Math.max(0, this.data.transportModes.findIndex((mode) => mode.id === currentMode));
    const friends = formatFriendsForView(friendStore.readFriends());
    const schedules = scheduleStore.readSchedules();
    this.allFriends = friends;
    this.allSchedules = schedules;
    this.friendVisibleCount = Math.min(
      Math.max(FRIEND_RENDER_PAGE_SIZE, Number(this.friendVisibleCount) || 0),
      friends.length,
    );
    this.scheduleVisibleCount = Math.min(
      Math.max(SCHEDULE_RENDER_PAGE_SIZE, Number(this.scheduleVisibleCount) || 0),
      schedules.length,
    );

    this.setData({
      preferences,
      transportModeIndex,
      userInfo,
      activityStats,
      ...weatherState,
      preferenceGroups: preferenceStore.buildGroups(preferences),
      friends: friends.slice(0, this.friendVisibleCount),
      friendTotal: friends.length,
      schedules: schedules.slice(0, this.scheduleVisibleCount),
      scheduleTotal: schedules.length,
      locations: locationPreferenceStore.readLocations(),
      privacy: buildPrivacyView(),
    }, () => {
      if (this.unloaded || this.hidden) return;
      this.updateSummaries();
      this.consumeFocusTarget();
    });
  },

  goCompletedHistory() {
    haptics.light();
    wx.navigateTo({ url: "/pages/completed-history/index" });
  },

  consumeFocusTarget() {
    let target = "";
    try {
      target = wx.getStorageSync("life_helper_profile_focus");
      if (target) wx.removeStorageSync("life_helper_profile_focus");
    } catch (error) {}
    if (target === "schedule") {
      if (this.focusTimer) clearTimeout(this.focusTimer);
      this.focusTimer = setTimeout(() => {
        this.focusTimer = null;
        if (this.unloaded || this.hidden) return;
        this.setData({ "activeSections.schedules": true });
        wx.pageScrollTo({ selector: "#schedule-section", duration: 220 });
      }, 120);
    }
  },

  onHide() {
    this.hidden = true;
    this.loginToken = (this.loginToken || 0) + 1;
    if (this.loginPending) {
      this.loginPending = false;
      try {
        wx.hideLoading();
      } catch (error) {}
    }
    if (this.focusTimer) {
      clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
    this.allFriends = [];
    this.allSchedules = [];
    this.friendVisibleCount = FRIEND_RENDER_PAGE_SIZE;
    this.scheduleVisibleCount = SCHEDULE_RENDER_PAGE_SIZE;
    if (!this.unloaded) {
      this.setData({ friends: [], schedules: [] });
    }
  },

  onUnload() {
    this.unloaded = true;
    this.onHide();
  },

  stopPropagation() {},

  applyFriendCollection(friends, patch = {}, callback) {
    const source = Array.isArray(friends) ? friends : [];
    this.allFriends = source;
    this.friendVisibleCount = Math.min(
      Math.max(FRIEND_RENDER_PAGE_SIZE, Number(this.friendVisibleCount) || 0),
      source.length,
    );
    this.setData(Object.assign({}, patch, {
      friends: source.slice(0, this.friendVisibleCount),
      friendTotal: source.length,
    }), callback);
  },

  applyScheduleCollection(schedules, patch = {}, callback) {
    const source = Array.isArray(schedules) ? schedules : [];
    this.allSchedules = source;
    this.scheduleVisibleCount = Math.min(
      Math.max(SCHEDULE_RENDER_PAGE_SIZE, Number(this.scheduleVisibleCount) || 0),
      source.length,
    );
    this.setData(Object.assign({}, patch, {
      schedules: source.slice(0, this.scheduleVisibleCount),
      scheduleTotal: source.length,
    }), callback);
  },

  showMoreFriends() {
    if (this.hidden || this.unloaded || !Array.isArray(this.allFriends)) return;
    const currentCount = Number(this.friendVisibleCount) || 0;
    const nextCount = Math.min(currentCount + FRIEND_RENDER_PAGE_SIZE, this.allFriends.length);
    if (nextCount <= currentCount) return;
    const patch = {};
    this.allFriends.slice(currentCount, nextCount).forEach((friend, index) => {
      patch[`friends[${currentCount + index}]`] = friend;
    });
    this.friendVisibleCount = nextCount;
    this.setData(patch);
  },

  showMoreSchedules() {
    if (this.hidden || this.unloaded || !Array.isArray(this.allSchedules)) return;
    const currentCount = Number(this.scheduleVisibleCount) || 0;
    const nextCount = Math.min(currentCount + SCHEDULE_RENDER_PAGE_SIZE, this.allSchedules.length);
    if (nextCount <= currentCount) return;
    const patch = {};
    this.allSchedules.slice(currentCount, nextCount).forEach((schedule, index) => {
      patch[`schedules[${currentCount + index}]`] = schedule;
    });
    this.scheduleVisibleCount = nextCount;
    this.setData(patch);
  },

  toggleSection(e) {
    haptics.light();
    const section = e.currentTarget.dataset.section;
    if (!Object.prototype.hasOwnProperty.call(this.data.activeSections, section)) return;
    this.setData({ [`activeSections.${section}`]: !this.data.activeSections[section] });
  },

  updateSummaries() {
    const { preferences, privacy, locations, weather } = this.data;
    const schedules = Array.isArray(this.allSchedules) ? this.allSchedules : [];
    const friends = Array.isArray(this.allFriends) ? this.allFriends : [];
    const likedFoods = preferences.likedFoods || [];
    const dislikedFoods = preferences.dislikedFoods || [];
    const preferenceParts = [];
    if (likedFoods.length) preferenceParts.push(`爱吃:${likedFoods[0]}`);
    if (dislikedFoods.length) preferenceParts.push(`忌口:${dislikedFoods[0]}`);
    if (preferences.commuteLimit) preferenceParts.push(preferences.commuteLimit);

    this.setData({
      privacySummaryText: privacy.modeLabel || "本地保护",
      preferencesSummaryText: preferenceParts.length ? preferenceParts.join(" · ") : "未设置偏好",
      weatherSummaryText: weather.weatherText || weather.condition || "天气待更新",
      locationSummaryText: `${locations.length}个地点`,
      scheduleSummaryText: `${schedules.length}个日程`,
      friendSummaryText: `${friends.length}位好友`,
    });
  },

  openFoodEditor() {
    wx.navigateTo({
      url: "/pages/foodPreferences/index",
      fail: () => wx.showToast({ title: "暂时无法打开编辑页", icon: "none" }),
    });
  },

  openDebug() {
    wx.navigateTo({ url: "/pages/debug/index" });
  },
};

Object.assign(
  pageConfig,
  preferenceHandlers,
  privacyHandlers,
  locationHandlers,
  scheduleHandlers,
  friendHandlers,
  accountBackupHandlers,
  weatherHandlers
);

Page(pageConfig);
