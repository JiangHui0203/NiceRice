/**
 * Reverse geocoding, offline district estimation and geocode cache.
 */

const mapDistanceService = require("./mapDistanceService.js");
const cloudService = require("./cloudService.js");
const privacyService = require("../privacyService.js");
const { getWx } = require("../wechatRuntime.js");
const { hasCoordinates } = require("../locationUtils.js");

const UNRESOLVED_LOCATION_NAME = "当前定位";
const REVERSE_GEOCODE_CACHE_KEY = "life_helper_reverse_geocode_cache";
const REVERSE_GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REVERSE_GEOCODE_CACHE_RADIUS_METERS = 250;
const REVERSE_GEOCODE_CACHE_LIMIT = 50;

let _reverseGeocodeCache = null;
const _reverseGeocodePending = {};

function boundedText(value, maxLength) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).slice(0, maxLength * 2).trim().slice(0, maxLength);
}

function clearReverseGeocodeCache() {
  _reverseGeocodeCache = null;
  Object.keys(_reverseGeocodePending).forEach((key) => delete _reverseGeocodePending[key]);
}

function normalizeReverseGeocodeResult(result = {}, latitude, longitude) {
  const payload = result.location && typeof result.location === "object" ? result.location : result;
  const formatted = payload.formatted_addresses || {};
  const component = payload.address_component || {};
  const pois = Array.isArray(payload.pois) ? payload.pois : [];
  const nearestPoi = pois[0] || {};
  const address = boundedText(
    payload.address
      || nearestPoi.address
      || formatted.recommend
      || formatted.rough
      || "",
    256,
  );
  const name = boundedText(
    nearestPoi.title
      || formatted.recommend
      || formatted.rough
      || (component.district ? `${component.district}${component.street || ""}` : "")
      || address,
    96,
  );

  if (!name && !address) return null;
  return {
    name: name || UNRESOLVED_LOCATION_NAME,
    address: address || name,
    city: boundedText(component.city, 64),
    district: boundedText(component.district, 64),
    street: boundedText(component.street, 64),
    latitude,
    longitude,
    lat: latitude,
    lng: longitude,
    source: result.source || "tencent_geocoder",
    resolved: true,
  };
}

function distanceBetweenCoordinates(latitude1, longitude1, latitude2, longitude2) {
  const lat1 = Number(latitude1);
  const lng1 = Number(longitude1);
  const lat2 = Number(latitude2);
  const lng2 = Number(longitude2);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;
  const radLat1 = lat1 * Math.PI / 180;
  const radLat2 = lat2 * Math.PI / 180;
  const deltaLat = (lat2 - lat1) * Math.PI / 180;
  const deltaLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(deltaLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function readReverseGeocodeCache() {
  if (Array.isArray(_reverseGeocodeCache)) return _reverseGeocodeCache;
  const stored = privacyService.readLocalData(REVERSE_GEOCODE_CACHE_KEY, []);
  _reverseGeocodeCache = (Array.isArray(stored) ? stored.slice(0, REVERSE_GEOCODE_CACHE_LIMIT) : [])
    .map(normalizeCachedEntry)
    .filter(Boolean);
  return _reverseGeocodeCache;
}

function normalizeCachedEntry(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const latitude = Number(item.latitude);
  const longitude = Number(item.longitude);
  const cachedAt = Number(item.cachedAt);
  const location = item.location;
  if (!hasCoordinates({ latitude, longitude }) || !Number.isFinite(cachedAt)
    || !location || typeof location !== "object" || Array.isArray(location)
    || location.resolved !== true) return null;
  const name = boundedText(location.name, 96);
  const address = boundedText(location.address, 256);
  if (!name && !address) return null;
  return {
    latitude,
    longitude,
    cachedAt,
    location: {
      name: name || address,
      address: address || name,
      city: boundedText(location.city, 64),
      district: boundedText(location.district, 64),
      street: boundedText(location.street, 64),
      latitude,
      longitude,
      lat: latitude,
      lng: longitude,
      source: boundedText(location.source, 40) || "cache",
      resolved: true,
      cached: false,
    },
  };
}

function writeReverseGeocodeCache(cache) {
  const next = (Array.isArray(cache) ? cache : [])
    .slice(0, REVERSE_GEOCODE_CACHE_LIMIT).map(normalizeCachedEntry).filter(Boolean);
  if (!privacyService.writeLocalData(REVERSE_GEOCODE_CACHE_KEY, next)) return false;
  // The module cache represents the last durable value. Do not retain a
  // location that disappeared after restart because a quota write failed.
  _reverseGeocodeCache = next;
  return true;
}

function cloneCachedLocation(location, latitude, longitude) {
  return Object.assign({}, location, {
    latitude,
    longitude,
    lat: latitude,
    lng: longitude,
    cached: true,
  });
}

function findCachedReverseGeocode(latitude, longitude) {
  const now = Date.now();
  const cache = readReverseGeocodeCache();
  let changed = false;
  const valid = cache.filter((item) => {
    const isValid = item
      && item.cachedAt
      && now >= item.cachedAt
      && now - item.cachedAt < REVERSE_GEOCODE_CACHE_TTL_MS
      && item.location
      && item.location.resolved === true;
    if (!isValid) changed = true;
    return isValid;
  });
  if (changed) writeReverseGeocodeCache(valid);

  let nearest = null;
  let nearestDistance = Infinity;
  valid.forEach((item) => {
    const distance = distanceBetweenCoordinates(
      latitude,
      longitude,
      item.latitude,
      item.longitude,
    );
    if (distance <= REVERSE_GEOCODE_CACHE_RADIUS_METERS && distance < nearestDistance) {
      nearest = item;
      nearestDistance = distance;
    }
  });
  return nearest ? cloneCachedLocation(nearest.location, latitude, longitude) : null;
}

function saveReverseGeocodeCache(location) {
  if (!location || location.resolved !== true) return false;
  const cache = readReverseGeocodeCache().filter((item) => distanceBetweenCoordinates(
    location.latitude,
    location.longitude,
    item.latitude,
    item.longitude,
  ) > REVERSE_GEOCODE_CACHE_RADIUS_METERS);
  cache.unshift({
    latitude: location.latitude,
    longitude: location.longitude,
    cachedAt: Date.now(),
    location: Object.assign({}, location, { cached: false }),
  });
  return writeReverseGeocodeCache(cache);
}

function findPendingReverseGeocode(latitude, longitude) {
  return Object.keys(_reverseGeocodePending).map((key) => _reverseGeocodePending[key])
    .find((item) => distanceBetweenCoordinates(latitude, longitude, item.latitude, item.longitude)
      <= REVERSE_GEOCODE_CACHE_RADIUS_METERS);
}

function callCloudReverseGeocode(api, latitude, longitude) {
  return new Promise((resolve, reject) => {
    if (!api || !api.cloud || typeof api.cloud.callFunction !== "function" || !cloudService.isCloudReady()) {
      reject(new Error("cloud_geocoder_unavailable"));
      return;
    }
    api.cloud.callFunction({
      name: "lifeServices",
      data: {
        type: "reverseGeocode",
        data: { latitude, longitude },
      },
      success(response) {
        const result = response && response.result || {};
        if (!result.success || !result.location) {
          reject(new Error(result.message || "cloud_geocoder_failed"));
          return;
        }
        const normalized = normalizeReverseGeocodeResult(result.location, latitude, longitude);
        if (!normalized) {
          reject(new Error("cloud_geocoder_empty"));
          return;
        }
        resolve(normalized);
      },
      fail: reject,
    });
  });
}

function requestTencentReverseGeocode(api, latitude, longitude) {
  return new Promise((resolve) => {
    if (!api || typeof api.request !== "function") {
      resolve(null);
      return;
    }
    const key = (mapDistanceService && typeof mapDistanceService.getStoredKey === "function")
      ? mapDistanceService.getStoredKey()
      : "";
    if (!key) {
      resolve(null);
      return;
    }
    api.request({
      url: "https://apis.map.qq.com/ws/geocoder/v1/",
      data: {
        location: `${latitude},${longitude}`,
        key,
        get_poi: 1,
      },
      method: "GET",
      timeout: 8000,
      success(response) {
        if (response.statusCode === 200 && response.data && response.data.status === 0 && response.data.result) {
          resolve(normalizeReverseGeocodeResult(response.data.result, latitude, longitude));
          return;
        }
        resolve(null);
      },
      fail() {
        resolve(null);
      },
    });
  });
}

const DISTRICT_CENTROIDS = [
  // 广州
  { city: "广州", district: "天河", lat: 23.125, lng: 113.361 },
  { city: "广州", district: "海珠", lat: 23.083, lng: 113.317 },
  { city: "广州", district: "越秀", lat: 23.129, lng: 113.266 },
  { city: "广州", district: "荔湾", lat: 23.125, lng: 113.244 },
  { city: "广州", district: "白云", lat: 23.157, lng: 113.273 },
  { city: "广州", district: "番禺", lat: 22.938, lng: 113.384 },
  { city: "广州", district: "黄埔", lat: 23.106, lng: 113.458 },
  { city: "广州", district: "花都", lat: 23.403, lng: 113.220 },
  { city: "广州", district: "南沙", lat: 22.802, lng: 113.524 },

  // 深圳
  { city: "深圳", district: "南山", lat: 22.532, lng: 113.930 },
  { city: "深圳", district: "福田", lat: 22.522, lng: 114.055 },
  { city: "深圳", district: "罗湖", lat: 22.548, lng: 114.131 },
  { city: "深圳", district: "宝安", lat: 22.553, lng: 113.883 },
  { city: "深圳", district: "龙华", lat: 22.654, lng: 114.029 },
  { city: "深圳", district: "龙岗", lat: 22.721, lng: 114.247 },
  { city: "深圳", district: "盐田", lat: 22.557, lng: 114.237 },
  { city: "深圳", district: "光明", lat: 22.748, lng: 113.915 },

  // 北京
  { city: "北京", district: "朝阳", lat: 39.921, lng: 116.443 },
  { city: "北京", district: "海淀", lat: 39.959, lng: 116.298 },
  { city: "北京", district: "西城", lat: 39.912, lng: 116.365 },
  { city: "北京", district: "东城", lat: 39.928, lng: 116.416 },
  { city: "北京", district: "丰台", lat: 39.858, lng: 116.286 },
  { city: "北京", district: "昌平", lat: 40.218, lng: 116.231 },
  { city: "北京", district: "大兴", lat: 39.726, lng: 116.341 },
  { city: "北京", district: "通州", lat: 39.909, lng: 116.657 },
  { city: "北京", district: "石景山", lat: 39.905, lng: 116.223 },

  // 上海
  { city: "上海", district: "浦东", lat: 31.221, lng: 121.544 },
  { city: "上海", district: "黄浦", lat: 31.231, lng: 121.484 },
  { city: "上海", district: "徐汇", lat: 31.188, lng: 121.436 },
  { city: "上海", district: "静安", lat: 31.228, lng: 121.448 },
  { city: "上海", district: "长宁", lat: 31.220, lng: 121.424 },
  { city: "上海", district: "普陀", lat: 31.250, lng: 121.397 },
  { city: "上海", district: "杨浦", lat: 31.259, lng: 121.526 },
  { city: "上海", district: "虹口", lat: 31.264, lng: 121.505 },
  { city: "上海", district: "闵行", lat: 31.112, lng: 121.381 },

  // 杭州
  { city: "杭州", district: "西湖", lat: 30.259, lng: 120.130 },
  { city: "杭州", district: "拱墅", lat: 30.318, lng: 120.142 },
  { city: "杭州", district: "上城", lat: 30.242, lng: 120.169 },
  { city: "杭州", district: "滨江", lat: 30.208, lng: 120.211 },
  { city: "杭州", district: "余杭", lat: 30.418, lng: 119.979 },
  { city: "杭州", district: "萧山", lat: 30.185, lng: 120.264 },

  // 成都
  { city: "成都", district: "武侯", lat: 30.642, lng: 104.043 },
  { city: "成都", district: "锦江", lat: 30.656, lng: 104.083 },
  { city: "成都", district: "青羊", lat: 30.673, lng: 104.062 },
  { city: "成都", district: "金牛", lat: 30.691, lng: 104.052 },
  { city: "成都", district: "成华", lat: 30.660, lng: 104.102 },
  { city: "成都", district: "高新", lat: 30.551, lng: 104.066 },

  // 武汉
  { city: "武汉", district: "江汉", lat: 30.601, lng: 114.270 },
  { city: "武汉", district: "武昌", lat: 30.553, lng: 114.316 },
  { city: "武汉", district: "洪山", lat: 30.500, lng: 114.343 },
  { city: "武汉", district: "江岸", lat: 30.598, lng: 114.304 },

  // 南京
  { city: "南京", district: "玄武", lat: 32.048, lng: 118.797 },
  { city: "南京", district: "秦淮", lat: 32.016, lng: 118.798 },
  { city: "南京", district: "鼓楼", lat: 32.059, lng: 118.769 },
  { city: "南京", district: "建邺", lat: 32.004, lng: 118.732 },
  { city: "南京", district: "江宁", lat: 31.952, lng: 118.839 },

  // 重庆
  { city: "重庆", district: "渝中", lat: 29.556, lng: 106.568 },
  { city: "重庆", district: "江北", lat: 29.575, lng: 106.574 },
  { city: "重庆", district: "渝北", lat: 29.718, lng: 106.631 },
  { city: "重庆", district: "南岸", lat: 29.531, lng: 106.563 },

  // 西安
  { city: "西安", district: "雁塔", lat: 34.222, lng: 108.947 },
  { city: "西安", district: "碑林", lat: 34.230, lng: 108.939 },
  { city: "西安", district: "未央", lat: 34.293, lng: 108.947 },

  // 长沙
  { city: "长沙", district: "岳麓", lat: 28.233, lng: 112.931 },
  { city: "长沙", district: "芙蓉", lat: 28.198, lng: 113.031 },
  { city: "长沙", district: "天心", lat: 28.112, lng: 112.989 },

  // 苏州
  { city: "苏州", district: "姑苏", lat: 31.325, lng: 120.619 },
  { city: "苏州", district: "工业园区", lat: 31.317, lng: 120.672 },
  { city: "苏州", district: "虎丘", lat: 31.339, lng: 120.570 },
  { city: "苏州", district: "吴中", lat: 31.262, lng: 120.632 },

  // 佛山
  { city: "佛山", district: "禅城", lat: 23.009, lng: 113.122 },
  { city: "佛山", district: "南海", lat: 23.028, lng: 113.142 },
  { city: "佛山", district: "顺德", lat: 22.804, lng: 113.293 },

  // 东莞
  { city: "东莞", district: "南城", lat: 23.016, lng: 113.738 },
  { city: "东莞", district: "东城", lat: 23.019, lng: 113.779 },
  { city: "东莞", district: "松山湖", lat: 22.915, lng: 113.882 },

  // 珠海
  { city: "珠海", district: "香洲", lat: 22.271, lng: 113.576 },
];

function getOfflineEstimateAddress(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!hasCoordinates({ latitude, longitude })) {
    return "点击获取实时定位";
  }

  let nearest = null;
  let minDistance = Infinity;

  for (let i = 0; i < DISTRICT_CENTROIDS.length; i++) {
    const item = DISTRICT_CENTROIDS[i];
    const dist = distanceBetweenCoordinates(latitude, longitude, item.lat, item.lng);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = item;
    }
  }

  if (nearest) {
    if (minDistance <= 60000) {
      return `${nearest.city} · ${nearest.district}`;
    }
    if (minDistance <= 150000) {
      return nearest.city;
    }
  }

  return "实时定位点";
}

function buildUnresolvedLocation(latitude, longitude) {
  const estimate = getOfflineEstimateAddress(latitude, longitude);
  const isEstimated = estimate
    && !["当前位置", "点击获取实时定位", "实时定位点"].includes(estimate);
  return {
    name: estimate,
    address: estimate,
    city: isEstimated ? estimate.split(" · ")[0] : "",
    district: isEstimated ? estimate.split(" · ")[1] : "",
    latitude,
    longitude,
    lat: latitude,
    lng: longitude,
    source: "offline_district",
    // 质心最近邻只能给出区域估算，不能伪装成逆地理解析成功。
    resolved: false,
    estimated: Boolean(isEstimated),
  };
}

function reverseGeocode(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!hasCoordinates({ latitude: lat, longitude: lng })) return Promise.resolve(null);

  const cached = findCachedReverseGeocode(lat, lng);
  if (cached) return Promise.resolve(cached);

  const pending = findPendingReverseGeocode(lat, lng);
  if (pending) {
    return pending.promise.then((result) => result ? cloneCachedLocation(result, lat, lng) : result);
  }

  const api = getWx();
  const fallback = buildUnresolvedLocation(lat, lng);

  if (privacyService.isLocalOnly()) {
    return Promise.resolve(fallback);
  }

  // 1. 优先使用已配置的和风天气 GeoAPI 进行免费逆地理反查（由于已配 Key/Host）
  const queryQWeatherGeo = () => {
    try {
      const weatherService = require("./weatherService.js");
      if (weatherService && typeof weatherService.lookupCity === "function") {
        return weatherService.lookupCity({ latitude: lat, longitude: lng }).then((res) => {
          if (res && res.name) {
            return {
              name: res.name,
              address: res.address || res.name,
              city: res.city,
              district: res.district,
              province: res.province,
              latitude: lat,
              longitude: lng,
              lat,
              lng,
              source: "qweather_geo",
              resolved: true,
            };
          }
          return null;
        }).catch(() => null);
      }
    } catch (e) {}
    return Promise.resolve(null);
  };

  const requestDirectly = () => requestTencentReverseGeocode(api, lat, lng).then((result) => result || fallback);

  const promise = queryQWeatherGeo().then((qRes) => {
    if (qRes) return qRes;
    return api && cloudService.isCloudReady()
      ? callCloudReverseGeocode(api, lat, lng).catch(requestDirectly)
      : requestDirectly();
  }).then((result) => {
    // A privacy-mode switch can happen while the provider request is in
    // flight. Do not apply or cache the remote result after that opt-out.
    if (privacyService.isLocalOnly()) return fallback;
    if (result && result.resolved === true) saveReverseGeocodeCache(result);
    return result || fallback;
  });

  const pendingKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  _reverseGeocodePending[pendingKey] = { latitude: lat, longitude: lng, promise };
  const clearPending = () => {
    delete _reverseGeocodePending[pendingKey];
  };
  // Do not discard the Promise returned by finally(): if the provider throws,
  // that derived rejection becomes an unhandled rejection in some runtimes.
  promise.then(clearPending, clearPending);
  return promise;
}

module.exports = {
  clearReverseGeocodeCache,
  getOfflineEstimateAddress,
  reverseGeocode,
};
