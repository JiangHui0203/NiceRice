const privacyService = require("./privacyService.js");
const { hasCoordinates, normalizeCoordinate } = require("./locationUtils.js");

const LOCATION_PREF_KEY = "life_helper_location_preferences";
const MAX_LOCATIONS = 20;
const LOCATION_TEXT_LIMITS = {
  id: 96,
  role: 24,
  name: 48,
  address: 160,
  desc: 160,
  source: 40,
  selectedAt: 40,
};
const LOCATION_ROLES = ["work", "home", "friend", "custom"];
const TRAVEL_MODES = ["transit", "walking", "driving", "cycling"];

const DEFAULT_LOCATIONS = [
  {
    id: "work",
    role: "work",
    name: "学校/公司",
    address: "",
    latitude: null,
    longitude: null,
    desc: "可设置学校或公司地址，供工作日路线参考。",
    travelMode: "transit",
  },
  {
    id: "home",
    role: "home",
    name: "家",
    address: "",
    latitude: null,
    longitude: null,
    desc: "可设置家庭地址，供回程路线参考。",
    travelMode: "transit",
  },
  {
    id: "friend",
    role: "friend",
    name: "朋友常用点",
    address: "",
    latitude: null,
    longitude: null,
    desc: "可设置常用聚会地点，供多人约饭参考。",
    travelMode: "transit",
  },
];

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasCoordinateValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function normalizeRequiredToken(value, maxLength) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const text = String(value).trim();
  return text && text.length <= maxLength ? text : "";
}

function normalizeOptionalText(value, maxLength) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length <= maxLength ? text : null;
}

function normalizeLocationForImport(item = {}) {
  if (!isRecord(item)) return null;
  const rawId = item.id !== undefined ? item.id : item.role;
  const id = normalizeRequiredToken(rawId, LOCATION_TEXT_LIMITS.id);
  const rawRole = item.role !== undefined
    ? item.role
    : (["work", "home", "friend"].includes(id) ? id : "custom");
  const role = normalizeRequiredToken(rawRole, LOCATION_TEXT_LIMITS.role);
  const name = typeof item.name === "string"
    ? normalizeRequiredToken(item.name, LOCATION_TEXT_LIMITS.name)
    : "";
  if (!id || !LOCATION_ROLES.includes(role) || !name) return null;

  const address = normalizeOptionalText(item.address, LOCATION_TEXT_LIMITS.address);
  const desc = normalizeOptionalText(item.desc, LOCATION_TEXT_LIMITS.desc);
  const source = normalizeOptionalText(item.source, LOCATION_TEXT_LIMITS.source);
  const selectedAt = normalizeOptionalText(item.selectedAt, LOCATION_TEXT_LIMITS.selectedAt);
  if ([address, desc, source, selectedAt].some((value) => value === null)) return null;
  if (selectedAt && !Number.isFinite(Date.parse(selectedAt))) return null;

  const travelMode = normalizeOptionalText(item.travelMode, 16);
  if (travelMode === null || (travelMode && !TRAVEL_MODES.includes(travelMode))) return null;

  const rawLatitude = hasCoordinateValue(item.latitude) ? item.latitude : item.lat;
  const rawLongitude = hasCoordinateValue(item.longitude) ? item.longitude : item.lng;
  const hasLatitude = hasCoordinateValue(rawLatitude);
  const hasLongitude = hasCoordinateValue(rawLongitude);
  if (hasLatitude !== hasLongitude) return null;
  if (hasLatitude && !hasCoordinates({ latitude: rawLatitude, longitude: rawLongitude })) return null;

  const latitude = hasLatitude ? normalizeCoordinate(rawLatitude) : null;
  const longitude = hasLongitude ? normalizeCoordinate(rawLongitude) : null;
  return {
    id,
    role,
    name,
    address,
    desc,
    latitude,
    longitude,
    lat: latitude,
    lng: longitude,
    source,
    selectedAt,
    travelMode,
  };
}

function formatLocationLabel(location = {}) {
  const name = location.name || "常用地点";
  if (hasCoordinates(location)) return `${name} · 已选地图点`;
  if (location.address) return `${name} · 待补地图点`;
  return `${name} · 暂无地址`;
}

function normalizeList(list) {
  const ids = new Set();
  const reservedRoles = new Set();
  return (Array.isArray(list) ? list : [])
    .slice(0, MAX_LOCATIONS)
    .map(normalizeLocationForImport)
    .filter((item) => {
      if (!item || ids.has(item.id)) return false;
      if (item.role !== "custom" && reservedRoles.has(item.role)) return false;
      ids.add(item.id);
      if (item.role !== "custom") reservedRoles.add(item.role);
      return true;
    });
}

function readLocations() {
  try {
    const stored = privacyService.readLocalData(LOCATION_PREF_KEY, null);
    if (Array.isArray(stored)) return normalizeList(stored);
  } catch (e) {
    return normalizeList(DEFAULT_LOCATIONS);
  }
  return normalizeList(DEFAULT_LOCATIONS);
}

function saveLocations(locations) {
  if (!Array.isArray(locations)) return false;
  if (locations.length > MAX_LOCATIONS) {
    console.warn("location preference storage rejected too many locations");
    return false;
  }
  const normalized = locations.map(normalizeLocationForImport);
  if (normalized.some((item) => !item)) {
    console.warn("location preference storage rejected invalid data");
    return false;
  }
  const ids = new Set();
  const reservedRoles = new Set();
  for (let index = 0; index < normalized.length; index += 1) {
    const item = normalized[index];
    if (ids.has(item.id)) {
      console.warn("location preference storage rejected duplicate IDs");
      return false;
    }
    ids.add(item.id);
    if (item.role !== "custom") {
      if (reservedRoles.has(item.role)) {
        console.warn("location preference storage rejected duplicate reserved roles");
        return false;
      }
      reservedRoles.add(item.role);
    }
  }
  const success = privacyService.writeLocalData(LOCATION_PREF_KEY, normalized);
  if (!success) console.warn("location preference storage failed");
  return success;
}

function updateLocation(locationId, patch = {}) {
  const targetId = normalizeRequiredToken(locationId, LOCATION_TEXT_LIMITS.id);
  if (!targetId || !isRecord(patch)) return null;
  const locations = readLocations();
  let updatedLocation = null;
  const next = locations.map((item) => {
    if (item.id !== targetId && item.role !== targetId) return item;
    updatedLocation = normalizeLocationForImport(Object.assign({}, item, patch, {
      id: item.id,
      role: item.role,
    }));
    return updatedLocation;
  });
  if (!updatedLocation || !saveLocations(next)) return null;
  return updatedLocation;
}

function resetLocations() {
  const defaults = normalizeList(DEFAULT_LOCATIONS);
  if (!saveLocations(defaults)) return null;
  return defaults;
}

function getPrimaryOrigin() {
  const locations = readLocations();
  return locations.find((item) => item.role === "work")
    || locations.find((item) => item.role === "home")
    || locations[0]
    || null;
}

function saveLocation(location = {}) {
  if (!isRecord(location)) return null;
  const locations = readLocations();
  const matched = locations.find((item) => (
    (location.id && item.id === location.id)
    || (location.role && item.role === location.role)
  ));
  if (matched) {
    return updateLocation(matched.id, Object.assign({}, location, {
      id: matched.id,
      role: matched.role || location.role,
    }));
  }

  if (locations.length >= MAX_LOCATIONS) return null;
  const normalized = normalizeLocationForImport(location);
  if (!normalized || !saveLocations(locations.concat(normalized))) return null;
  return normalized;
}

module.exports = {
  DEFAULT_LOCATIONS,
  LOCATION_PREF_KEY,
  LOCATION_ROLES,
  LOCATION_TEXT_LIMITS,
  MAX_LOCATIONS,
  TRAVEL_MODES,
  formatLocationLabel,
  getPrimaryOrigin,
  hasCoordinates,
  normalizeLocationForImport,
  readLocations,
  resetLocations,
  saveLocations,
  saveLocation,
  updateLocation,
};
