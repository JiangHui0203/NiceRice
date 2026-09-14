const TouchDismissHelper = require("../../utils/touchDismissHelper.js");
const store = require("../../utils/couponStore.js");
const planStore = require("../../utils/planStore.js");
const eventLogger = require("../../utils/eventLogger.js");
const weatherService = require("../../utils/services/weatherService.js");
const routeService = require("../../utils/services/routeService.js");
const { buildDashboardState } = require("./dashboardBuilder.js");
const { generateRandomClouds, initWeatherCanvas, cleanupWeatherCanvas } = require("./weatherAnimation.js");
const locationHandlers = require("./handlers/locationHandlers.js");

const TIME_PHASES = ["dawn", "morning", "noon", "afternoon", "evening", "night", "lateNight"];

function isPageActive(page) {
  return Boolean(page && !page.unloaded && page.pageVisible !== false);
}

function beginWeatherOperation(page, options = {}) {
  if (page.weatherLoadingToken && typeof wx !== "undefined" && typeof wx.hideLoading === "function") {
    wx.hideLoading();
  }
  if (page.weatherPullDownToken && typeof wx !== "undefined" && typeof wx.stopPullDownRefresh === "function") {
    wx.stopPullDownRefresh();
  }
  page.weatherLoadingToken = 0;
  page.weatherPullDownToken = 0;
  page.weatherOperationToken = (page.weatherOperationToken || 0) + 1;
  const token = page.weatherOperationToken;
  if (options.loading) page.weatherLoadingToken = token;
  if (options.pullDown) page.weatherPullDownToken = token;
  return token;
}

function isCurrentWeatherOperation(page, token) {
  return isPageActive(page) && page.weatherOperationToken === token;
}

function finishWeatherOperation(page, token) {
  if (page.weatherLoadingToken === token) {
    if (typeof wx !== "undefined" && typeof wx.hideLoading === "function") wx.hideLoading();
    page.weatherLoadingToken = 0;
  }
  if (page.weatherPullDownToken === token) {
    if (typeof wx !== "undefined" && typeof wx.stopPullDownRefresh === "function") wx.stopPullDownRefresh();
    page.weatherPullDownToken = 0;
  }
}

function cancelWeatherOperations(page) {
  beginWeatherOperation(page);
}

function getWeatherFallbackMessage(prefix) {
  try {
    const currentWeather = weatherService.getWeather();
    return currentWeather && currentWeather.source === "api"
      ? `${prefix}，已显示缓存天气`
      : `${prefix}，已显示本地天气`;
  } catch (error) {
    return `${prefix}，请稍后重试`;
  }
}

const pageConfig = {
  data: {
    todayLabel: "",
    currentOriginTitle: "当前定位",
    currentOriginDetail: "实时定位",
    currentOriginLabel: "当前定位",
    weather: {},
    recommend: {},
    recommendBlocked: false,
    priorityList: [],
    avoid: null,
    weeklyArrangement: null,
    hasRecommendation: false,
    loading: true,
    errorMsg: null,
    weatherParsed: {},
    showWeatherDrawer: false,
    weatherDragY: 0,
    weatherCategories: [],
    activeWeatherCategory: "sunny",
    drawerSubWeathers: [],
    currentLocationName: "实时定位",
    timeOfDay: "day",
    isNight: false,
    feelingText: "",
    v2TimeIndex: 3,
    v2Intensity: 1,
    v2WindLevel: 2,
    v2Condition: "clear",
    v2Modifiers: [],
    v2ModifiersMap: {},
    v2Theme: "auto",
    v2Clouds: [],
    isPageVisible: true,
    themesList: [
      { id: "auto", label: "自动 (Auto)" }, { id: "ocean-blue", label: "天蓝色" },
      { id: "deep-night", label: "深邃夜蓝" }, { id: "dawn-pink", label: "清晨粉橙" },
      { id: "sunset-gold", label: "傍晚暖金" }, { id: "extreme-heat", label: "烈日赤橙" },
      { id: "rainy-gray", label: "雨天灰蓝" }, { id: "snow-white", label: "冰川冷白" },
      { id: "haze-yellow", label: "雾霾灰黄" }, { id: "thunder-purple", label: "雷暴深紫" },
    ],
    modifierOptions: [
      { id: "rainDrop", label: "🌧 雨丝" }, { id: "snowFlake", label: "❄ 雪花" },
      { id: "thunder", label: "⛈ 雷暴" }, { id: "windLine", label: "🍃 风线" },
      { id: "fogLayer", label: "🌫 雾层" }, { id: "starry", label: "✨ 星芒" },
      { id: "moonGlow", label: "🌙 月晕" }, { id: "sunGlow", label: "☀️ 日晕" },
      { id: "iceEdge", label: "🥶 冰霜" },
    ],
    timePhases: [
      { id: "dawn", label: "清晨" }, { id: "morning", label: "上午" },
      { id: "noon", label: "中午" }, { id: "afternoon", label: "下午" },
      { id: "evening", label: "傍晚" }, { id: "night", label: "夜晚" },
      { id: "lateNight", label: "深夜" },
    ],
    mainConditions: [
      { id: "clear", label: "☀ 晴天" }, { id: "cloudy", label: "☁ 多云" },
      { id: "overcast", label: "☁ 阴天" }, { id: "rain", label: "🌧 下雨" },
      { id: "snow", label: "❄ 下雪" }, { id: "fog", label: "🌫 雾天" },
      { id: "thunderstorm", label: "⛈ 雷暴" }, { id: "wind", label: "🍃 大风" },
    ],
    v2Temp: 22,
  },

  onLoad() {
    this.unloaded = false;
    this.pageVisible = true;
    this.weatherOperationToken = 0;
    this.weatherLoadingToken = 0;
    this.weatherPullDownToken = 0;
    this.locationReloadOnShow = false;
    this.canvasInitialized = false;
    this.animActive = false;
    this.initLocationAndWeather();
  },

  onShow() {
    if (this.unloaded) return;
    this.pageVisible = true;
    if (this.locationReloadOnShow) {
      this.locationReloadOnShow = false;
      this.initLocationAndWeather();
    }
    this.renderDashboard();
  },

  renderDashboard() {
    if (this.unloaded || this.pageVisible === false) return;
    try {
      const activeRouteOrigin = routeService.getActiveRouteOrigin();
      const coupons = store.getAllCoupons() || [];
      const plans = planStore.getPlans() || [];
      const rawWeather = weatherService.getWeather();

      const dashboardState = buildDashboardState({ coupons, plans, rawWeather, activeRouteOrigin });
      const weather = dashboardState.weather || {};
      const cloudSpeed = (weather.v2Scene && weather.v2Scene.visual && weather.v2Scene.visual.clouds)
        ? weather.v2Scene.visual.clouds.speed
        : 1.0;
      const v2Clouds = generateRandomClouds(cloudSpeed);

      if (dashboardState.recommend && dashboardState.recommend.recommendation) {
        eventLogger.logRecommendation(dashboardState.recommend.recommendation);
      }

      this.setData(Object.assign({
        errorMsg: null,
        v2Clouds,
        isPageVisible: true,
        loading: false,
      }, dashboardState), () => {
        if (!this.unloaded && this.pageVisible !== false) initWeatherCanvas(this);
      });
    } catch (e) {
      console.error("Homepage renderDashboard error:", e);
      if (!this.unloaded && this.pageVisible !== false) {
        this.setData({ errorMsg: "首页数据加载失败，请稍后重试", loading: false });
      }
    }
  },

  onPullDownRefresh() {
    if (!isPageActive(this)) {
      if (typeof wx !== "undefined" && typeof wx.stopPullDownRefresh === "function") wx.stopPullDownRefresh();
      return;
    }
    this.cachedDashboardState = null;
    const token = beginWeatherOperation(this, { pullDown: true });
    const finish = (liveWeather) => {
      if (!isCurrentWeatherOperation(this, token)) return;
      finishWeatherOperation(this, token);
      this.renderDashboard();
      if (!liveWeather) {
        wx.showToast({ title: getWeatherFallbackMessage("未获取到新实况"), icon: "none" });
      }
    };
    try {
      if (!weatherService.clearWeatherOverride()) {
        if (isCurrentWeatherOperation(this, token)) {
          finishWeatherOperation(this, token);
          wx.showToast({ title: "实况天气模式保存失败", icon: "none" });
        }
        return;
      }
      const origin = routeService.getActiveRouteOrigin();
      weatherService.fetchLiveWeather(origin, true)
        .then((liveWeather) => finish(liveWeather))
        .catch(() => finish(null));
    } catch (e) {
      finish(null);
    }
  },

  onHide() {
    this.pageVisible = false;
    this.cancelLocationOperations();
    cancelWeatherOperations(this);
    this.setData({ isPageVisible: false });
    cleanupWeatherCanvas(this);
  },

  onUnload() {
    this.unloaded = true;
    this.pageVisible = false;
    this.cancelLocationOperations();
    cancelWeatherOperations(this);
    cleanupWeatherCanvas(this);
  },

  changeWeather() {
    const isMock = weatherService.isWeatherOverrideActive();
    const weather = this.data.weather || {};

    if (!isMock) {
      wx.showActionSheet({
        itemList: [
          `🌤️ 刷新实况天气 (${weather.condition || "天气待更新"} ${weather.temperatureRange || "--"})`,
          "🛠️ 开发者选项 (模拟天气实验室)",
        ],
        success: (res) => {
          if (!isPageActive(this)) return;
          if (res.tapIndex === 0) {
            const origin = routeService.getActiveRouteOrigin();
            const token = beginWeatherOperation(this, { loading: true });
            wx.showLoading({ title: "刷新天气中..." });
            weatherService.fetchLiveWeather(origin, true).then((liveWeather) => {
              if (!isCurrentWeatherOperation(this, token)) return;
              finishWeatherOperation(this, token);
              this.renderDashboard();
              if (liveWeather) {
                wx.showToast({ title: "实况天气已刷新", icon: "success" });
              } else {
                wx.showToast({ title: getWeatherFallbackMessage("实况天气暂不可用"), icon: "none" });
              }
            }).catch(() => {
              if (!isCurrentWeatherOperation(this, token)) return;
              finishWeatherOperation(this, token);
              this.renderDashboard();
              wx.showToast({ title: getWeatherFallbackMessage("实况天气刷新失败"), icon: "none" });
            });
          } else if (res.tapIndex === 1) {
            wx.navigateTo({ url: "/pages/debug/index" });
          }
        },
      });
      return;
    }

    const timeIdx = TIME_PHASES.indexOf(weather.timePhase || weather.timeOfDay || "afternoon");
    const modifiersVal = weather.modifiers || [];
    const modifiersMap = {};
    modifiersVal.forEach((m) => { modifiersMap[m] = true; });

    this.setData({
      showWeatherDrawer: true,
      v2TimeIndex: timeIdx > -1 ? timeIdx : 3,
      v2Temp: typeof weather.temperature === "number" ? weather.temperature : 22,
      v2Condition: weather.mainCondition || "clear",
      v2Intensity: typeof weather.intensity === "number" ? weather.intensity : 1,
      v2Modifiers: modifiersVal,
      v2ModifiersMap: modifiersMap,
      v2Theme: weather.customTheme || "auto",
    });
  },

  closeWeatherDrawer() {
    this.setData({ showWeatherDrawer: false });
  },

  changeV2Time(e) {
    this.setData({ v2TimeIndex: e.detail.value });
  },

  changeV2Temp(e) {
    const temp = e.detail.value;
    let list = this.data.v2Modifiers || [];
    if (temp <= 0 && !list.includes("iceEdge")) list = list.concat(["iceEdge"]);
    else if (temp > 5 && list.includes("iceEdge")) list = list.filter((m) => m !== "iceEdge");

    if (temp >= 33 && !list.includes("heatGlow")) list = list.concat(["heatGlow"]);
    else if (temp < 28 && list.includes("heatGlow")) list = list.filter((m) => m !== "heatGlow");

    const modifiersMap = {};
    list.forEach((m) => { modifiersMap[m] = true; });
    this.setData({ v2Temp: temp, v2Modifiers: list, v2ModifiersMap: modifiersMap });
  },

  changeV2Intensity(e) {
    this.setData({ v2Intensity: e.detail.value });
  },

  changeV2WindLevel(e) {
    this.setData({ v2WindLevel: e.detail.value });
  },

  selectV2Condition(e) {
    const cond = e.currentTarget.dataset.id;
    let list = this.data.v2Modifiers || [];
    if (cond === "rain" && !list.includes("rainDrop")) list = list.concat(["rainDrop"]);
    else if (cond === "snow" && !list.includes("snowFlake")) list = list.concat(["snowFlake"]);
    else if (cond === "thunderstorm") {
      if (!list.includes("thunder")) list.push("thunder");
      if (!list.includes("rainDrop")) list.push("rainDrop");
    } else if (cond === "fog" && !list.includes("fogLayer")) list = list.concat(["fogLayer"]);
    else if (cond === "wind" && !list.includes("windLine")) list = list.concat(["windLine"]);

    const modifiersMap = {};
    list.forEach((m) => { modifiersMap[m] = true; });
    this.setData({ v2Condition: cond, v2Modifiers: list, v2ModifiersMap: modifiersMap });
  },

  selectV2Theme(e) {
    this.setData({ v2Theme: e.currentTarget.dataset.id });
  },

  toggleV2Modifier(e) {
    const mod = e.currentTarget.dataset.id;
    let list = this.data.v2Modifiers || [];
    list = list.includes(mod) ? list.filter((item) => item !== mod) : list.concat([mod]);
    const modifiersMap = {};
    list.forEach((m) => { modifiersMap[m] = true; });
    this.setData({ v2Modifiers: list, v2ModifiersMap: modifiersMap });
  },

  submitV2Weather() {
    const timePhase = TIME_PHASES[this.data.v2TimeIndex] || "afternoon";
    const customWeather = {
      isCustomV2: true,
      temperature: this.data.v2Temp,
      mainCondition: this.data.v2Condition,
      intensity: this.data.v2Intensity,
      windLevel: this.data.v2WindLevel,
      modifiers: this.data.v2Modifiers,
      timePhase,
      customTheme: this.data.v2Theme === "auto" ? "" : this.data.v2Theme,
      timeOfDay: ["night", "lateNight"].includes(timePhase) ? "night" : "day",
      title: "自定义天气",
      condition: "自定义天气",
      desc: "多属性自选组合天气",
      tips: ["组合模拟", "自定义"],
    };

    if (weatherService.saveCustomWeatherV2(customWeather)) {
      this.setData({ showWeatherDrawer: false });
      this.renderDashboard();
      wx.showToast({ title: "自定义天气已组合", icon: "success" });
    } else {
      wx.showToast({ title: "自定义天气保存失败，请重试", icon: "none" });
    }
  },

  resetDrawerWeather() {
    if (!weatherService.clearWeatherOverride()) {
      wx.showToast({ title: "天气设置恢复失败，请重试", icon: "none" });
      return;
    }
    this.setData({ showWeatherDrawer: false });
    this.renderDashboard();
    let restoredWeather = null;
    try {
      restoredWeather = weatherService.getWeather();
    } catch (error) {
      restoredWeather = null;
    }
    wx.showToast({
      title: !restoredWeather
        ? "已退出模拟，天气读取失败"
        : (restoredWeather.source === "api"
          ? "已恢复实况天气"
          : "已退出模拟，当前显示本地天气"),
      icon: "none",
    });
  },

  goCoupons() {
    wx.switchTab({ url: "/pages/coupons/index" });
  },

  goCouponDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/coupon-detail/index?id=${encodeURIComponent(id)}` });
  },

  onWeeklyItemTap(e) {
    const { id, planId, planned } = e.currentTarget.dataset;
    if (planned && planId) wx.navigateTo({ url: `/pages/plan-detail/index?id=${encodeURIComponent(planId)}` });
    else if (id) wx.navigateTo({ url: `/pages/coupon-detail/index?id=${encodeURIComponent(id)}` });
  },

  goWeeklyCalendar() {
    wx.navigateTo({ url: "/pages/weekly-calendar/index" });
  },

  goRecommendDetail() {
    if (this.data.recommend.id) wx.navigateTo({ url: `/pages/coupon-detail/index?id=${encodeURIComponent(this.data.recommend.id)}` });
  },

  addRecommendToPlan() {
    if (this.data.recommend.id) wx.navigateTo({ url: `/pages/plan-confirm/index?id=${encodeURIComponent(this.data.recommend.id)}` });
  },

  changeRecommendTime() {
    if (this.data.recommend.id) wx.navigateTo({ url: `/pages/plan-confirm/index?id=${encodeURIComponent(this.data.recommend.id)}&mode=times` });
  },

  goAddCoupon() {
    wx.navigateTo({ url: "/pages/coupon-edit/index" });
  },

  selectTodayPlan() {
    getApp().globalData.selectMode = "today";
    wx.switchTab({ url: "/pages/coupons/index" });
  },

  onShareAppMessage() {
    const recommendTitle = this.data.recommend ? this.data.recommend.title : "";
    const title = recommendTitle ? `🌤️ 今日首选去吃：【${recommendTitle}】！` : "🌤️ 有时好饭 · 智能餐饮生活规划助手";
    return {
      title,
      path: "/pages/index/index",
    };
  },

  onWeatherTouchStart(e) {
    if (!this.weatherTouchHelper) this.weatherTouchHelper = new TouchDismissHelper({ thresholdY: 70 });
    const result = this.weatherTouchHelper.onTouchStart(e);
    if (result) this.setData({ weatherDragY: result.dragOffsetY });
  },

  onWeatherTouchMove(e) {
    if (!this.weatherTouchHelper) return;
    const result = this.weatherTouchHelper.onTouchMove(e);
    if (result) this.setData({ weatherDragY: result.dragOffsetY });
  },

  onWeatherTouchEnd(e) {
    if (!this.weatherTouchHelper) return;
    this.weatherTouchHelper.onTouchEnd(e, () => this.closeWeatherDrawer());
    this.setData({ weatherDragY: 0 });
  },

  stopPropagation() {},

  onShareTimeline() {
    return {
      title: "🌤️ 有时好饭 · 智能餐饮生活规划助手",
      query: "",
    };
  },
};

Object.assign(pageConfig, locationHandlers);

Page(pageConfig);
