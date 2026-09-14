const { hasCoordinates, normalizeCoordinate } = require("../../utils/locationUtils.js");

const INVALID_LOCATION_NAMES = new Set(["当前位置", "广深附近", "当前起点"]);

function formatLocationOption(roleName, location = {}) {
  const address = location.address || (hasCoordinates(location) ? location.name : "") || "";
  const displayAddress = address.length > 10 ? `${address.slice(0, 8)}...` : address;
  return `${roleName}: ${displayAddress || "点击设置"}`;
}

function buildLocationActionItems(locations = []) {
  const workLocation = locations.find((location) => location.role === "work") || {};
  const homeLocation = locations.find((location) => location.role === "home") || {};
  return {
    homeLocation,
    itemList: [
      "🗺️ 打开微信地图精确定位 (推荐)",
      "📍 刷新手机 GPS 坐标",
      formatLocationOption("🏢 学校/公司", workLocation),
      formatLocationOption("🏠 家", homeLocation),
    ],
    workLocation,
  };
}

function resolveGpsLocationName(location = {}, resolved = {}, offlineName = "当前位置") {
  const resolvedName = String(resolved.name || "").trim();
  if (resolvedName && !INVALID_LOCATION_NAMES.has(resolvedName)) return resolvedName;
  return offlineName || location.name || "当前位置";
}

function getCoordinates(location = {}) {
  const latitude = normalizeCoordinate(location.latitude !== undefined ? location.latitude : location.lat);
  const longitude = normalizeCoordinate(location.longitude !== undefined ? location.longitude : location.lng);
  return { latitude, longitude };
}

function buildGpsOrigin(location = {}, resolved = {}, offlineName = "当前位置") {
  const { latitude, longitude } = getCoordinates(location);
  const name = resolveGpsLocationName(location, resolved, offlineName);
  const offlineNameIsEstimate = !resolved.name
    && !["", "当前位置", "实时定位点", "点击获取实时定位"].includes(String(offlineName || "").trim());
  return {
    id: "loc_gps",
    role: "gps",
    name,
    address: resolved.address || name,
    city: resolved.city || "",
    district: resolved.district || "",
    latitude,
    longitude,
    lat: latitude,
    lng: longitude,
    source: "wx.getLocation",
    resolved: resolved.resolved === true,
    estimated: resolved.estimated === true || offlineNameIsEstimate,
    resolutionSource: resolved.source || "offline_estimate",
  };
}

function buildSavedRoleOrigin(role, location = {}) {
  const { latitude, longitude } = getCoordinates(location);
  const fallbackName = role === "home" ? "家" : "学校/公司";
  return {
    id: `loc_${role}`,
    role,
    name: location.name || fallbackName,
    address: location.address,
    latitude,
    longitude,
    lat: latitude,
    lng: longitude,
    source: location.source || "wx.chooseLocation",
    selectedAt: location.selectedAt || new Date().toISOString(),
  };
}

function buildCustomOrigin(location = {}, now = Date.now) {
  const { latitude, longitude } = getCoordinates(location);
  return {
    id: `loc_custom_${now()}`,
    role: "custom",
    name: location.name || "已选位置",
    address: location.address || location.name || "",
    latitude,
    longitude,
    lat: latitude,
    lng: longitude,
    source: "wx.chooseLocation",
    resolved: true,
  };
}

function hasSavedLocation(location = {}) {
  return hasCoordinates(location);
}

module.exports = {
  buildCustomOrigin,
  buildGpsOrigin,
  buildLocationActionItems,
  buildSavedRoleOrigin,
  formatLocationOption,
  hasSavedLocation,
  resolveGpsLocationName,
};
