const locationPreferenceStore = require("../../../utils/locationPreferenceStore.js");
const locationService = require("../../../utils/services/locationService.js");
const routeService = require("../../../utils/services/routeService.js");
const weatherService = require("../../../utils/services/weatherService.js");
const { hasCoordinates } = require("../../../utils/locationUtils.js");
const {
  buildCustomOrigin,
  buildGpsOrigin,
  buildLocationActionItems,
  buildSavedRoleOrigin,
  hasSavedLocation,
} = require("../locationFlowHelper.js");

function isPageActive(page) {
  return Boolean(page && !page.unloaded && page.pageVisible !== false);
}

function beginLocationOperation(page) {
  if (page.locationLoadingToken && typeof wx !== "undefined" && typeof wx.hideLoading === "function") {
    wx.hideLoading();
  }
  page.locationInitializationPending = false;
  page.locationLoadingToken = 0;
  page.locationOperationToken = (page.locationOperationToken || 0) + 1;
  return page.locationOperationToken;
}

function finishLocationInitialization(page, token) {
  if (page && page.locationOperationToken === token) page.locationInitializationPending = false;
}

function isCurrentLocationOperation(page, token) {
  return isPageActive(page) && page.locationOperationToken === token;
}

function getOfflineLocationName(location) {
  return locationService.getOfflineEstimateAddress(location.latitude, location.longitude);
}

function updateOriginFromLiveWeather(origin, liveWeather) {
  const locationName = String((liveWeather && liveWeather.locationName) || "").trim();
  const isGpsOrigin = Boolean(origin && (origin.role === "gps" || origin.source === "wx.getLocation"));
  // Weather geocoding is city/district level. It may enrich a raw GPS origin,
  // but must never overwrite the precise venue name chosen on the map.
  if (!isGpsOrigin || !locationName || locationName === String((origin && origin.name) || "").trim()) {
    return { origin, originUpdateFailed: false };
  }
  const enrichedOrigin = Object.assign({}, origin, {
    name: locationName,
  });
  const savedOrigin = routeService.saveActiveRouteOrigin(enrichedOrigin);
  return {
    origin: savedOrigin || origin,
    originUpdateFailed: !savedOrigin,
  };
}

function fetchWeatherForOrigin(page, origin, token, forceRefresh) {
  return weatherService.fetchLiveWeather(origin, forceRefresh).then((liveWeather) => {
    if (!isCurrentLocationOperation(page, token)) return { stale: true, liveWeather: null };
    const originUpdate = updateOriginFromLiveWeather(origin, liveWeather);
    return {
      stale: !isCurrentLocationOperation(page, token),
      liveWeather,
      origin: originUpdate.origin,
      originUpdateFailed: originUpdate.originUpdateFailed,
    };
  });
}

function chooseCustomLocation(page) {
  return locationService.chooseCouponLocation()
    .then((location) => {
      if (!isPageActive(page)) return false;
      return page.applyCustomLocation(location);
    })
    .catch((error) => {
      if (isPageActive(page) && !locationService.isCancelError(error)) {
        wx.showToast({ title: "地图选点未完成", icon: "none" });
      }
    });
}

function showPermissionFallback(page) {
  if (!isPageActive(page)) return;
  wx.showModal({
    title: "需要位置权限",
    content: "您尚未开启位置权限，是否前往设置开启？",
    confirmText: "去开启",
    cancelText: "地图选点",
    success: (result) => {
      if (!isPageActive(page)) return;
      if (result.confirm && wx.openSetting) {
        wx.openSetting({
          success: (setting) => {
            if (!isPageActive(page)) return;
            const enabled = setting.authSetting && setting.authSetting["scope.userLocation"];
            if (enabled) refreshGpsLocation(page);
            else wx.showToast({ title: "位置权限尚未开启", icon: "none" });
          },
          fail: () => {
            if (isPageActive(page)) wx.showToast({ title: "位置设置打开失败", icon: "none" });
          },
        });
      } else if (result.cancel) {
        chooseCustomLocation(page);
      }
    },
  });
}

function refreshGpsLocation(page) {
  if (!isPageActive(page)) return Promise.resolve({ success: false, code: "page_inactive" });
  const token = beginLocationOperation(page);
  let savedOrigin = null;
  page.locationLoadingToken = token;
  if (!weatherService.clearWeatherOverride()) {
    page.locationLoadingToken = 0;
    if (isCurrentLocationOperation(page, token)) {
      wx.showToast({ title: "实况天气模式保存失败，请重试", icon: "none" });
    }
    return Promise.resolve({ success: false, code: "storage_failed" });
  }
  wx.showLoading({ title: "定位与更新天气中...", mask: true });
  return locationService.getCurrentLocation({ timeout: 6000 })
    .then((location) => locationService.reverseGeocode(location.latitude, location.longitude)
      .catch(() => null)
      .then((resolved) => ({ location, resolved })))
    .then(({ location, resolved }) => {
      if (!isCurrentLocationOperation(page, token)) return { stale: true, liveWeather: null, origin: null };
      const origin = buildGpsOrigin(location, resolved || {}, getOfflineLocationName(location));
      savedOrigin = routeService.saveActiveRouteOrigin(origin);
      if (!savedOrigin) throw new Error("起点保存失败");
      return fetchWeatherForOrigin(page, savedOrigin, token, true);
    })
    .then(({ stale, liveWeather, origin, originUpdateFailed }) => {
      if (!stale && isCurrentLocationOperation(page, token)) {
        wx.hideLoading();
        page.locationLoadingToken = 0;
        const effectiveOrigin = origin || savedOrigin;
        const isEstimatedOrigin = effectiveOrigin.estimated === true;
        const isUnresolvedOrigin = effectiveOrigin.resolved === false;
        let toastTitle = isEstimatedOrigin
          ? `GPS已更新，区域估算: ${effectiveOrigin.name}`
          : (isUnresolvedOrigin ? "GPS已更新，地名暂未解析" : `已定位到: ${effectiveOrigin.name}`);
        if (liveWeather) {
          const conditionText = `${liveWeather.condition || "实况"} ${liveWeather.temperatureText || ""}`.trim();
          toastTitle = originUpdateFailed
            ? `定位已更新，地点名称保存失败 (${conditionText})`
            : `已更新: ${effectiveOrigin.name} (${conditionText})`;
        } else {
          toastTitle = isEstimatedOrigin
            ? "GPS已更新，区域为估算，天气暂不可用"
            : (isUnresolvedOrigin
              ? "GPS已更新，地名与天气暂不可用"
              : `已定位到: ${effectiveOrigin.name}，天气暂不可用`);
        }
        wx.showToast({
          title: toastTitle,
          icon: "none",
          duration: 2500,
        });
        page.renderDashboard();
      }
    })
    .catch((error) => {
      if (!isCurrentLocationOperation(page, token)) return;
      wx.hideLoading();
      page.locationLoadingToken = 0;
      if (savedOrigin) {
        wx.showToast({ title: "定位已保存，天气更新失败", icon: "none" });
        page.renderDashboard();
        return;
      }
      const message = String((error && (error.errMsg || error.message)) || "");
      if (locationService.isPermissionError(error)) showPermissionFallback(page);
      else if (message.includes("起点保存失败")) wx.showToast({ title: "起点保存失败，请重试", icon: "none" });
      else if (message.includes("超时") || (error && error.code === "timeout")) {
        wx.showToast({ title: "获取定位超时，建议在地图选点", icon: "none" });
      } else {
        wx.showToast({ title: "获取定位失败，建议在地图选点", icon: "none" });
      }
    });
}

function pickAndSaveRoleLocation(page, role) {
  if (!isPageActive(page)) return;
  const token = beginLocationOperation(page);
  wx.chooseLocation({
    success: (location) => {
      if (!isCurrentLocationOperation(page, token)) return;
      const origin = buildSavedRoleOrigin(role, location);
      if (!locationPreferenceStore.saveLocation(origin)) {
        wx.showToast({ title: "常用地点保存失败，请重试", icon: "none" });
        return;
      }
      if (!routeService.saveActiveRouteOrigin(origin)) {
        wx.showToast({ title: "地点已保存，当前起点切换失败", icon: "none" });
        return;
      }
      fetchWeatherForOrigin(page, origin, token, true)
        .then(() => {
          if (!isCurrentLocationOperation(page, token)) return;
          wx.showToast({ title: role === "home" ? "已设置家位置并保存" : "已设置工作地并保存", icon: "success" });
          page.renderDashboard();
        })
        .catch(() => {
          if (!isCurrentLocationOperation(page, token)) return;
          wx.showToast({ title: "地点已保存，天气更新失败", icon: "none" });
          page.renderDashboard();
        });
    },
    fail: (error) => {
      if (isCurrentLocationOperation(page, token) && !locationService.isCancelError(error)) {
        wx.showToast({ title: "地图选点未完成", icon: "none" });
      }
    },
  });
}

function useSavedRoleLocation(page, role, location) {
  if (!isPageActive(page)) return;
  if (!hasSavedLocation(location)) {
    pickAndSaveRoleLocation(page, role);
    return;
  }
  const token = beginLocationOperation(page);
  if (!routeService.saveActiveRouteOrigin(location)) {
    wx.showToast({ title: "起点切换保存失败，请重试", icon: "none" });
    return;
  }
  fetchWeatherForOrigin(page, location, token, true)
    .then(() => {
      if (!isCurrentLocationOperation(page, token)) return;
      wx.showToast({ title: role === "home" ? "已切换为家" : "已切换为学校/公司", icon: "success" });
      page.renderDashboard();
    })
    .catch(() => {
      if (!isCurrentLocationOperation(page, token)) return;
      wx.showToast({ title: "起点已切换，天气更新失败", icon: "none" });
      page.renderDashboard();
    });
}

module.exports = {
  cancelLocationOperations() {
    if (this.locationInitializationPending && !this.unloaded) this.locationReloadOnShow = true;
    beginLocationOperation(this);
  },

  initLocationAndWeather() {
    const token = beginLocationOperation(this);
    this.locationInitializationPending = true;
    try {
      const origin = routeService.getActiveRouteOrigin();
      if (typeof wx !== "undefined" && wx.getSetting) {
        wx.getSetting({
          success: (result) => {
            if (!isCurrentLocationOperation(this, token)) return;
            const hasAuthorization = result.authSetting && result.authSetting["scope.userLocation"];
            if (hasAuthorization && (!hasCoordinates(origin) || origin.role === "gps")) {
              locationService.getCurrentLocation({ timeout: 5000 })
                .then((location) => locationService.reverseGeocode(location.latitude, location.longitude)
                  .catch(() => null)
                  .then((resolved) => ({ location, resolved })))
                .then(({ location, resolved }) => {
                  if (!isCurrentLocationOperation(this, token)) return { stale: true };
                  const newOrigin = buildGpsOrigin(location, resolved || {}, getOfflineLocationName(location));
                  const savedOrigin = routeService.saveActiveRouteOrigin(newOrigin);
                  if (!savedOrigin) return { stale: false, originSaveFailed: true };
                  return fetchWeatherForOrigin(this, savedOrigin, token, false);
                })
                .then(() => {
                  if (isCurrentLocationOperation(this, token)) {
                    finishLocationInitialization(this, token);
                    this.renderDashboard();
                  }
                })
                .catch(() => {
                  if (isCurrentLocationOperation(this, token)) {
                    finishLocationInitialization(this, token);
                    this.renderDashboard();
                  }
                });
            } else {
              finishLocationInitialization(this, token);
              this.renderDashboard();
            }
          },
          fail: () => {
            if (isCurrentLocationOperation(this, token)) {
              finishLocationInitialization(this, token);
              this.renderDashboard();
            }
          },
        });
      } else {
        if (isCurrentLocationOperation(this, token)) {
          finishLocationInitialization(this, token);
          this.renderDashboard();
        }
      }
    } catch (error) {
      if (isCurrentLocationOperation(this, token)) {
        finishLocationInitialization(this, token);
        this.renderDashboard();
      }
    }
  },

  changeRouteOrigin() {
    if (!isPageActive(this)) return;
    const actionState = buildLocationActionItems(locationPreferenceStore.readLocations());
    wx.showActionSheet({
      itemList: actionState.itemList,
      success: (result) => {
        if (!isPageActive(this)) return;
        if (result.tapIndex === 0) chooseCustomLocation(this);
        else if (result.tapIndex === 1) refreshGpsLocation(this);
        else if (result.tapIndex === 2) useSavedRoleLocation(this, "work", actionState.workLocation);
        else if (result.tapIndex === 3) useSavedRoleLocation(this, "home", actionState.homeLocation);
      },
    });
  },

  applyCustomLocation(location) {
    if (!location || !isPageActive(this)) return Promise.resolve(false);
    const token = beginLocationOperation(this);
    const origin = buildCustomOrigin(location);
    if (!routeService.saveActiveRouteOrigin(origin)) {
      wx.showToast({ title: "自定义起点保存失败，请重试", icon: "none" });
      return Promise.resolve(false);
    }
    return fetchWeatherForOrigin(this, origin, token, true)
      .then(() => {
        if (!isCurrentLocationOperation(this, token)) return false;
        const displayTitle = origin.name.length > 10 ? `${origin.name.slice(0, 9)}...` : origin.name;
        wx.showToast({ title: `已定位到: ${displayTitle}`, icon: "none" });
        this.renderDashboard();
        return true;
      })
      .catch(() => {
        if (!isCurrentLocationOperation(this, token)) return false;
        wx.showToast({ title: "位置已保存，天气更新失败", icon: "none" });
        this.renderDashboard();
        return true;
      });
  },
  __test__: {
    beginLocationOperation,
    isCurrentLocationOperation,
    refreshGpsLocation,
  },
};
