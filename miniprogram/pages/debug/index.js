const tests = require("../../utils/recommendationTests.js");
const eventLogger = require("../../utils/eventLogger.js");
const storageManager = require("../../utils/storageManager.js");
const notificationService = require("../../utils/services/notificationService.js");
const weatherService = require("../../utils/services/weatherService.js");
const weatherApiSettingsStore = require("../../utils/services/weatherApiSettingsStore.js");
const routeService = require("../../utils/services/routeService.js");
const haptics = require("../../utils/haptics.js");

const TEMPLATE_FIELDS = [
  { key: "couponExpiring", label: "券过期", placeholder: "券快过期提醒模板 ID" },
  { key: "planDeparture", label: "出发", placeholder: "计划出发提醒模板 ID" },
  { key: "friendPending", label: "朋友", placeholder: "朋友待确认提醒模板 ID" },
  { key: "reservation", label: "预约", placeholder: "预约提醒模板 ID" },
  { key: "weatherChanged", label: "天气", placeholder: "天气变化提醒模板 ID" },
];

function buildTemplateFields(templateIds) {
  return TEMPLATE_FIELDS.map((item) => Object.assign({}, item, {
    value: templateIds[item.key] || "",
    configured: Boolean(templateIds[item.key]),
  }));
}

Page({
  data: {
    schemaVersion: storageManager.CURRENT_SCHEMA_VERSION,
    testResults: [],
    eventLogs: [],
    recommendationLogs: [],
    templateFields: [],
    templateSummary: "未配置",
    activeTab: "weather",

    // 气象实验室状态
    isMockWeather: false,
    currentWeather: {},
    categories: [],
    weatherOptions: [],
    activeCategory: "sunny",
    activeSubWeathers: [],

    // 和风 API 联调状态
    hasApiKey: false,
    maskedApiKey: "",
    apiKeyDraft: "",
    apiHostDraft: "",
    directWeatherApiEnabled: false,
    isTestingApi: false,
    apiTestResult: null,
  },

  onShow() {
    if (this.unloaded) return;
    this.hidden = false;
    if (this.data.isTestingApi) this.setData({ isTestingApi: false });
    this.refresh();
  },

  onHide() {
    this.hidden = true;
    this.apiTestRequestId = (this.apiTestRequestId || 0) + 1;
    this.liveWeatherRequestId = (this.liveWeatherRequestId || 0) + 1;
    if (this.refreshTimer !== null && this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  },

  onUnload() {
    this.unloaded = true;
    this.onHide();
  },

  switchTab(e) {
    haptics.light();
    const tab = e.currentTarget.dataset.tab;
    if (!["weather", "algo", "system"].includes(tab)) return;
    this.setData({ activeTab: tab }, () => {
      if (!this.hidden && !this.unloaded) this.refresh();
    });
  },

  refresh() {
    if (this.hidden || this.unloaded) return;
    const templateIds = notificationService.getTemplateIds();
    const templateFields = buildTemplateFields(templateIds);
    const configuredCount = templateFields.filter((item) => item.configured).length;

    const isMockWeather = weatherService.isWeatherOverrideActive();
    const currentWeather = weatherService.getWeather() || {};
    const categories = weatherService.getWeatherCategories() || [];
    const weatherOptions = weatherService.getWeatherOptions() || [];
    const activeCategory = this.data.activeCategory || currentWeather.category || "sunny";
    const activeSubWeathers = weatherOptions.filter((opt) => opt.category === activeCategory);

    const apiSettings = weatherApiSettingsStore.readSettings();
    const apiKey = apiSettings.apiKey;
    const hasApiKey = Boolean(apiKey);
    const maskedApiKey = hasApiKey ? weatherApiSettingsStore.maskApiKey(apiKey) : "";
    const apiHost = apiSettings.apiHost;
    const hasApiHost = Boolean(apiHost);
    const keepApiDraft = this.weatherApiSettingsDirty === true;

    this.setData({
      schemaVersion: storageManager.getSchemaVersion(),
      // Recommendation scoring is intentionally lazy. Running it on every
      // weather toggle, log clear and page show needlessly allocates hundreds
      // of transient slot/score objects in the simulator.
      testResults: this.data.activeTab === "algo"
        ? tests.runRecommendationRegression()
        : this.data.testResults,
      eventLogs: eventLogger.getEventLogs().slice(0, 8),
      recommendationLogs: eventLogger.getRecommendationLogs().slice(0, 8),
      templateFields,
      templateSummary: configuredCount ? `${configuredCount}/5 已配置` : "未配置",
      isMockWeather,
      currentWeather,
      categories,
      weatherOptions,
      activeCategory,
      activeSubWeathers,
      hasApiKey,
      maskedApiKey,
      hasApiHost,
      apiHostDraft: keepApiDraft ? this.data.apiHostDraft : apiHost,
      apiKeyDraft: keepApiDraft ? this.data.apiKeyDraft : "",
      directWeatherApiEnabled: keepApiDraft
        ? this.data.directWeatherApiEnabled
        : apiSettings.enabled,
    });
  },

  // 1. 拟真天气控制
  toggleMockWeather(e) {
    haptics.light();
    const isMock = Boolean(e.detail.value);
    if (isMock) {
      if (!weatherService.saveWeatherOverride("sunny")) {
        wx.showToast({ title: "模拟天气保存失败", icon: "none" });
        this.refresh();
        return;
      }
      wx.showToast({ title: "已开启模拟天气", icon: "success" });
    } else {
      if (!weatherService.clearWeatherOverride()) {
        wx.showToast({ title: "实况模式保存失败", icon: "none" });
        this.refresh();
        return;
      }
      this.refresh();
      this.refreshLiveWeather({
        liveMessage: "已切回实时天气",
        fallbackMessage: "已切回实况模式，当前显示本地天气",
      });
      return;
    }
    this.refresh();
  },

  refreshLiveWeather(options = {}) {
    const requestId = (this.liveWeatherRequestId || 0) + 1;
    this.liveWeatherRequestId = requestId;
    return Promise.resolve()
      .then(() => weatherService.fetchLiveWeather(routeService.getActiveRouteOrigin(), true))
      .then((liveWeather) => {
        if (this.hidden || this.unloaded || requestId !== this.liveWeatherRequestId) return false;
        this.refresh();
        const displayedWeather = weatherService.getWeather() || {};
        const liveApplied = Boolean(liveWeather && displayedWeather.source === "api");
        wx.showToast({
          title: liveApplied
            ? (options.liveMessage || "实时天气已更新")
            : (options.fallbackMessage || "实时天气暂不可用，当前显示本地天气"),
          icon: liveApplied ? "success" : "none",
        });
        return liveApplied;
      })
      .catch((error) => {
        console.warn("refresh live weather failed", error);
        if (!this.hidden && !this.unloaded && requestId === this.liveWeatherRequestId) {
          this.refresh();
          wx.showToast({ title: options.fallbackMessage || "实时天气暂不可用", icon: "none" });
        }
        return false;
      });
  },

  selectCategory(e) {
    haptics.light();
    const catId = e.currentTarget.dataset.id;
    const weatherOptions = this.data.weatherOptions || [];
    this.setData({
      activeCategory: catId,
      activeSubWeathers: weatherOptions.filter((opt) => opt.category === catId),
    });
  },

  selectSubWeather(e) {
    haptics.light();
    const val = e.currentTarget.dataset.value;
    if (!weatherService.saveWeatherOverride(val)) {
      wx.showToast({ title: "天气场景保存失败", icon: "none" });
      return;
    }
    this.refresh();
    wx.showToast({ title: "天气场景已生效", icon: "success" });
  },

  restoreLiveWeather() {
    haptics.light();
    if (!weatherService.clearWeatherOverride()) {
      wx.showToast({ title: "实况模式保存失败", icon: "none" });
      return;
    }
    this.refresh();
    this.refreshLiveWeather({
      liveMessage: "已恢复实时和风天气",
      fallbackMessage: "已恢复实况模式，实时天气暂不可用",
    });
  },

  // 2. 和风 API 联调
  onHostInput(e) {
    this.weatherApiSettingsDirty = true;
    this.setData({ apiHostDraft: e.detail.value });
  },

  onApiKeyInput(e) {
    this.weatherApiSettingsDirty = true;
    this.setData({ apiKeyDraft: e.detail.value });
  },

  onDirectWeatherApiChange(e) {
    this.weatherApiSettingsDirty = true;
    this.setData({ directWeatherApiEnabled: Boolean(e.detail.value) });
  },

  persistWeatherApiSettings(showSuccessToast = true) {
    const existing = weatherApiSettingsStore.readSettings();
    const validation = weatherApiSettingsStore.validateSettings({
      enabled: this.data.directWeatherApiEnabled,
      apiHost: this.data.apiHostDraft,
      apiKey: String(this.data.apiKeyDraft || "").trim() || existing.apiKey,
    });
    if (!validation.valid) {
      wx.showToast({ title: validation.error, icon: "none", duration: 2200 });
      return null;
    }
    if (!weatherApiSettingsStore.saveSettings(validation.settings)) {
      wx.showToast({ title: "本机天气配置保存失败", icon: "none" });
      return null;
    }
    this.weatherApiSettingsDirty = false;
    this.setData({ apiKeyDraft: "", apiTestResult: null });
    if (showSuccessToast) {
      wx.showToast({
        title: validation.settings.enabled ? "天气 API 直连已启用" : "天气 API 直连已关闭",
        icon: "success",
      });
    }
    this.refresh();
    return validation.settings;
  },

  saveWeatherApiSettings() {
    haptics.light();
    this.persistWeatherApiSettings(true);
  },

  runApiTest() {
    haptics.medium();
    const apiSettings = this.persistWeatherApiSettings(false);
    if (!apiSettings || !apiSettings.enabled) {
      this.setData({
        isTestingApi: false,
        apiTestResult: {
          success: false,
          statusCode: 0,
          message: apiSettings ? "请先开启“允许本机直连天气 API”" : "请先完成有效的本机天气 API 配置",
        },
      });
      return;
    }
    const requestId = (this.apiTestRequestId || 0) + 1;
    this.apiTestRequestId = requestId;
    this.setData({ isTestingApi: true, apiTestResult: null });

    const origin = routeService.getActiveRouteOrigin();
    Promise.resolve()
      .then(() => weatherService.testQWeatherApiConnection(
        apiSettings.apiHost,
        apiSettings.apiKey,
        origin,
      ))
      .then((result) => {
        if (this.hidden || this.unloaded || requestId !== this.apiTestRequestId) return;
        this.setData({ isTestingApi: false, apiTestResult: result });
        if (result.success) {
          haptics.success();
        } else {
          haptics.warning();
        }
      }).catch((err) => {
        if (this.hidden || this.unloaded || requestId !== this.apiTestRequestId) return;
        this.setData({
          isTestingApi: false,
          apiTestResult: { success: false, message: `测试异常: ${err.message || err}` },
        });
        haptics.warning();
      });
  },

  clearWeatherCache() {
    haptics.light();
    if (!weatherService.clearLiveWeatherCache()) {
      wx.showToast({ title: "天气缓存清理失败", icon: "none" });
      return;
    }
    wx.showToast({ title: "天气缓存已清空", icon: "success" });
    this.refresh();
  },

  // 3. 订阅模板与日志
  onTemplateInput(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;
    this.setData({
      templateFields: this.data.templateFields.map((item) => item.key === key ? Object.assign({}, item, { value }) : item),
    });
  },

  saveTemplateIds() {
    const templateIds = {};
    this.data.templateFields.forEach((item) => {
      templateIds[item.key] = String(item.value || "").trim();
    });
    if (!notificationService.saveTemplateIds(templateIds)) {
      wx.showToast({ title: "模板保存失败，请重试", icon: "none" });
      return;
    }
    wx.showToast({
      title: "模板已保存",
      icon: "success",
    });
    this.refresh();
  },

  clearTemplateIds() {
    const cleared = notificationService.saveTemplateIds(TEMPLATE_FIELDS.reduce((map, item) => {
      map[item.key] = "";
      return map;
    }, {}));
    if (!cleared) {
      wx.showToast({ title: "模板清空失败，请重试", icon: "none" });
      return;
    }
    wx.showToast({
      title: "模板已清空",
      icon: "none",
    });
    this.refresh();
  },

  resetData() {
    wx.showModal({
      title: "重置本地原型数据",
      content: "会清空本地新增券、计划、偏好、朋友、转盘候选、邀请和日志，恢复示例原型。",
      confirmText: "重置",
      success: (res) => {
        if (!res.confirm || this.hidden || this.unloaded) return;
        Promise.resolve().then(() => storageManager.resetLocalPrototypeData()).then((cleaned) => {
          if (this.hidden || this.unloaded) return;
          wx.showToast({
            title: cleaned ? "已重置" : "部分数据或附件清理未完成",
            icon: cleaned ? "success" : "none",
          });
          this.refresh();
        }).catch((error) => {
          console.warn("reset local prototype data failed", error);
          if (!this.hidden && !this.unloaded) {
            wx.showToast({ title: "重置失败，请重试", icon: "none" });
          }
        });
      },
    });
  },

  clearAllStorage() {
    wx.showModal({
      title: "清空全部本地存储",
      content: "将彻底清理小程序的所有 LocalStorage 缓存（包括登录、天气缓存、历史记录等）并重新初始化基础原型。",
      confirmColor: "#dc2626",
      confirmText: "全部清空",
      success: (res) => {
        if (!res.confirm || this.hidden || this.unloaded) return;
        Promise.resolve()
          .then(() => storageManager.clearAllLocalData())
          .then((cleaned) => {
            if (this.hidden || this.unloaded) return;
            wx.showToast({
              title: cleaned ? "已清空所有存储" : "存储清理未完全完成，请重试",
              icon: cleaned ? "success" : "none",
            });
            this.refreshTimer = setTimeout(() => {
              this.refreshTimer = null;
              if (!this.hidden && !this.unloaded) this.refresh();
            }, 400);
          }).catch((error) => {
            console.warn("clear all storage failed", error);
            if (!this.hidden && !this.unloaded) {
              wx.showToast({ title: "清理失败，请重试", icon: "none" });
            }
          });
      },
    });
  },

  clearLogs() {
    if (!eventLogger.clearLogs()) {
      wx.showToast({ title: "日志清理失败", icon: "none" });
      return;
    }
    this.refresh();
    wx.showToast({ title: "日志已清空", icon: "none" });
  },
});
