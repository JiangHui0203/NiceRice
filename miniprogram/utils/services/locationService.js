
const { hasCoordinates, normalizeCoordinate } = require("../locationUtils.js");
const { getWx } = require("../wechatRuntime.js");
const {
  getOfflineEstimateAddress,
  reverseGeocode,
} = require("./reverseGeocodeService.js");

function cleanText(value) {
  return String(value || "").slice(0, 1000).trim().slice(0, 500);
}

function normalizeLocationResult(result = {}) {
  const latitude = normalizeCoordinate(result.latitude !== undefined ? result.latitude : result.lat);
  const longitude = normalizeCoordinate(result.longitude !== undefined ? result.longitude : result.lng);
  const source = result.source || "wx.chooseLocation";
  return {
    name: cleanText(result.name),
    address: cleanText(result.address),
    latitude,
    longitude,
    lat: latitude,
    lng: longitude,
    source,
    selectedAt: result.selectedAt || (source === "manual" ? "" : new Date().toISOString()),
  };
}

function buildStoredLocation(form = {}, fallback = {}) {
  const source = form.location || fallback || {};
  const latitude = form.latitude !== undefined ? form.latitude : source.latitude !== undefined ? source.latitude : source.lat;
  const longitude = form.longitude !== undefined ? form.longitude : source.longitude !== undefined ? source.longitude : source.lng;
  const hasSelectedLocation = latitude !== undefined || longitude !== undefined || form.locationSource || source.source;
  const location = normalizeLocationResult({
    name: form.locationName || source.name || form.venue || form.merchantName || "",
    address: form.locationAddress || form.address || source.address || "",
    latitude,
    longitude,
    source: form.locationSource || source.source || (hasSelectedLocation ? "wx.chooseLocation" : "manual"),
    selectedAt: form.locationSelectedAt || source.selectedAt || "",
  });
  if (!hasSelectedLocation && !location.name && !location.address) {
    return {
      name: form.venue || form.merchantName || "待补充店名",
      address: form.address || "待补充地址",
      latitude: null,
      longitude: null,
      lat: null,
      lng: null,
      source: "manual",
      selectedAt: "",
    };
  }
  return location;
}

function formatLocationSummary(location = {}) {
  const name = cleanText(location.name);
  const address = cleanText(location.address);
  if (name && address && address.indexOf(name) === -1) return `${name} · ${address}`;
  return name || address || "待选择地点";
}

function chooseCouponLocation(options = {}) {
  return new Promise((resolve, reject) => {
    const api = getWx();
    if (!api || typeof api.chooseLocation !== "function") {
      const error = new Error("当前环境不支持选择位置");
      error.code = "unsupported";
      reject(error);
      return;
    }
    const params = {
      success(res) {
        resolve(normalizeLocationResult(res));
      },
      fail(err) {
        reject(err || new Error("选择位置失败"));
      },
    };
    const latitude = normalizeCoordinate(options.latitude);
    const longitude = normalizeCoordinate(options.longitude);
    if (latitude !== null && longitude !== null) {
      params.latitude = latitude;
      params.longitude = longitude;
    }
    api.chooseLocation(params);
  });
}

function getCurrentLocation(options = {}) {
  return new Promise((resolve, reject) => {
    const api = getWx();
    if (!api || typeof api.getLocation !== "function") {
      const error = new Error("当前环境不支持获取当前位置");
      error.code = "unsupported";
      reject(error);
      return;
    }
    let settled = false;
    const timeoutMs = options.timeout || 3000;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error("获取定位超时");
      error.code = "timeout";
      reject(error);
    }, timeoutMs);

    try {
      api.getLocation({
        type: options.type || "gcj02",
        isHighAccuracy: true,
        highAccuracyExpireTime: 4000,
        success(res) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(normalizeLocationResult(Object.assign({}, res, {
            name: "当前定位",
            address: "",
            source: "wx.getLocation",
          })));
        },
        fail(err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err || new Error("获取当前位置失败"));
        },
      });
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    }
  });
}

let _cachedUserLocation = null;
let _locationRequestPromise = null;
let _lastLocationResult = null;
let _lastLocationFailureAt = 0;
let _locationRequestGeneration = 0;
const LOCATION_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

function getCachedUserLocation() {
  return _cachedUserLocation;
}

function clearLocationCache() {
  _locationRequestGeneration += 1;
  _cachedUserLocation = null;
  _locationRequestPromise = null;
  _lastLocationResult = null;
  _lastLocationFailureAt = 0;
}

function fetchUserCurrentLocation(options = {}) {
  if (_locationRequestPromise && !options.force) return _locationRequestPromise;
  if (_cachedUserLocation && !options.force) return Promise.resolve(_cachedUserLocation);
  if (!options.force
    && _lastLocationFailureAt
    && Date.now() - _lastLocationFailureAt < LOCATION_FAILURE_COOLDOWN_MS) {
    return Promise.resolve(_lastLocationResult);
  }

  const requestGeneration = ++_locationRequestGeneration;
  const request = getCurrentLocation(options).then((loc) => {
    return reverseGeocode(loc.latitude, loc.longitude).then((geo) => {
      if (geo && (geo.name || geo.address)) {
        loc.name = geo.name || loc.name;
        loc.address = geo.address || loc.address;
        loc.city = geo.city || "";
        loc.district = geo.district || "";
        loc.street = geo.street || "";
        loc.resolved = geo.resolved === true;
        loc.locationSource = geo.source || "";
      }
      // A forced refresh or reset may supersede this request while reverse
      // geocoding is in flight. Older results must not repopulate cleared
      // caches or overwrite the newer origin.
      if (requestGeneration !== _locationRequestGeneration) return loc;
      // 只有真实逆地理编码成功时才缓存地点名称；失败结果按冷却时间后再重试。
      _cachedUserLocation = loc.resolved === true ? loc : null;
      _lastLocationResult = loc;
      _lastLocationFailureAt = loc.resolved === true ? 0 : Date.now();
      const api = getWx();
      if (api && typeof getApp === "function") {
        const app = getApp();
        if (app && app.globalData) {
          app.globalData.userLocation = loc;
          const currentActive = app.globalData.activeRouteOrigin;
          if (!currentActive || currentActive.role === "gps") {
            const fallbackAddr = getOfflineEstimateAddress(loc.latitude, loc.longitude);
            const newOrigin = Object.assign({}, loc, {
              id: "loc_gps",
              role: "gps",
              name: (loc.name && loc.name !== "当前位置") ? loc.name : "当前定位",
              address: (loc.address && loc.address !== "实时定位") ? loc.address : fallbackAddr,
              latitude: loc.latitude,
              longitude: loc.longitude,
              lat: loc.latitude,
              lng: loc.longitude,
              source: "wx.getLocation",
            });
            try {
              // 先持久化再更新全局状态，避免写入失败后本次运行与下次启动看到不同起点。
              require("./routeService.js").saveActiveRouteOrigin(newOrigin);
            } catch (e) {}
          }
        }
      }
      return loc;
    });
  }).catch((err) => {
    if (requestGeneration === _locationRequestGeneration) {
      _lastLocationFailureAt = Date.now();
      return _lastLocationResult;
    }
    return null;
  });
  const pending = request.finally(() => {
    if (_locationRequestPromise === pending) _locationRequestPromise = null;
  });
  _locationRequestPromise = pending;
  return _locationRequestPromise;
}

function refreshUserLocation(app) {
  if (_locationRequestPromise) return _locationRequestPromise;
  if (_cachedUserLocation) return Promise.resolve(_cachedUserLocation);
  return fetchUserCurrentLocation();
}

function isCancelError(error = {}) {
  return /cancel/i.test(error.errMsg || error.message || "");
}

function isPermissionError(error = {}) {
  return /auth|authorize|permission|denied|scope/i.test(error.errMsg || error.message || "");
}

module.exports = {
  buildStoredLocation,
  chooseCouponLocation,
  formatLocationSummary,
  getCurrentLocation,
  getCachedUserLocation,
  clearLocationCache,
  fetchUserCurrentLocation,
  refreshUserLocation,
  hasCoordinates,
  isCancelError,
  isPermissionError,
  normalizeLocationResult,
  reverseGeocode,
  getOfflineEstimateAddress,
};
