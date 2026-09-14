/**
 * mapDistanceService.js
 * 地图服务直连距离与路线规划模块
 * 支持：腾讯位置服务 (Tencent Map Distance Matrix API)、高德地图 API 与本地离线高性能智能测距兜底
 */
const { getWx } = require("../wechatRuntime.js");
const { hasCoordinates } = require("../locationUtils.js");
const privacyService = require("../privacyService.js");

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟缓存
const MAX_DISTANCE_CACHE_ENTRIES = 200;
// The local fallback models city travel. Beyond this range, converting a
// straight-line distance with an urban average speed creates fake precision
// such as "8766 minutes". Treat it as a different-region destination instead.
const MAX_LOCAL_ROUTE_DISTANCE_METERS = 200 * 1000;

// 不在小程序包内内置公共 Key。未配置自己的 Key 时只使用本地测距，不发起第三方请求。
const DEFAULT_TENCENT_MAP_KEY = "";

let memoryDistanceCache = Object.create(null);
let cacheGeneration = 0;

function pruneDistanceCache(now = Date.now()) {
  Object.keys(memoryDistanceCache).forEach((key) => {
    const entry = memoryDistanceCache[key];
    if (!entry || now - entry.timestamp >= CACHE_TTL_MS) delete memoryDistanceCache[key];
  });
  const keys = Object.keys(memoryDistanceCache);
  if (keys.length <= MAX_DISTANCE_CACHE_ENTRIES) return;
  keys.sort((left, right) => {
    const leftAccessedAt = memoryDistanceCache[left].lastAccessedAt || memoryDistanceCache[left].timestamp;
    const rightAccessedAt = memoryDistanceCache[right].lastAccessedAt || memoryDistanceCache[right].timestamp;
    return rightAccessedAt - leftAccessedAt;
  });
  keys.slice(MAX_DISTANCE_CACHE_ENTRIES).forEach((key) => delete memoryDistanceCache[key]);
}

function setDistanceCache(key, data, now = Date.now()) {
  memoryDistanceCache[key] = { data, timestamp: now, lastAccessedAt: now };
  pruneDistanceCache(now);
  return data;
}

function getDistanceCache(key, now = Date.now()) {
  const cached = memoryDistanceCache[key];
  if (!cached) return null;
  if (now - cached.timestamp >= CACHE_TTL_MS) {
    delete memoryDistanceCache[key];
    return null;
  }
  cached.lastAccessedAt = now;
  return cached.data;
}

function clearDistanceCache() {
  memoryDistanceCache = Object.create(null);
  cacheGeneration += 1;
}

function getStoredKey() {
  try {
    const stored = privacyService.readLocalData("life_helper_custom_map_key", "");
    if (typeof stored !== "string") return DEFAULT_TENCENT_MAP_KEY;
    const key = stored.trim();
    return Array.from(key).length <= 512 ? (key || DEFAULT_TENCENT_MAP_KEY) : DEFAULT_TENCENT_MAP_KEY;
  } catch (e) {
    return DEFAULT_TENCENT_MAP_KEY;
  }
}

function saveCustomMapKey(key) {
  // A user-supplied provider credential must not remain as plaintext storage.
  if (typeof key !== "string") return false;
  const normalizedKey = key.trim();
  if (Array.from(normalizedKey).length > 512) return false;
  const saved = privacyService.writeLocalData("life_helper_custom_map_key", normalizedKey);
  if (saved) clearDistanceCache();
  return saved;
}

function buildCacheKey(lat1, lng1, lat2, lng2, mode = "walking") {
  const fLat = Number(lat1).toFixed(4);
  const fLng = Number(lng1).toFixed(4);
  const tLat = Number(lat2).toFixed(4);
  const tLng = Number(lng2).toFixed(4);
  return `${mode}_${fLat},${fLng}_${tLat},${tLng}`;
}

function isCrossRegionDistance(distanceMeters) {
  const distance = Number(distanceMeters);
  return Number.isFinite(distance) && distance > MAX_LOCAL_ROUTE_DISTANCE_METERS;
}

/**
 * 球面大圆距离（Haversine）本地快速测算
 */
function calculateLocalDistance(lat1, lng1, lat2, lng2, mode = "walking") {
  if (!hasCoordinates({ latitude: lat1, longitude: lng1 }) || !hasCoordinates({ latitude: lat2, longitude: lng2 })) return null;
  const radLat1 = (lat1 * Math.PI) / 180.0;
  const radLat2 = (lat2 * Math.PI) / 180.0;
  const a = radLat1 - radLat2;
  const b = ((lng1 * Math.PI) / 180.0) - ((lng2 * Math.PI) / 180.0);
  let s = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin(a / 2), 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(b / 2), 2)));
  s = s * 6378.137; // Earth Radius in km
  const straightMeters = Math.round(s * 1000);
  const actualDistanceMeters = Math.round(straightMeters * 1.35); // 城市路网弯折修正
  const distanceKmText = actualDistanceMeters < 1000
    ? `${actualDistanceMeters}m`
    : `${(actualDistanceMeters / 1000).toFixed(1)}km`;
  const isCrossRegion = isCrossRegionDistance(actualDistanceMeters);
  if (isCrossRegion) {
    return {
      distanceMeters: actualDistanceMeters,
      durationMinutes: null,
      distanceKmText,
      travelTimeText: "异地商户",
      source: "local_geo_engine",
      transportType: mode,
      isCrossRegion: true,
    };
  }
  const speedMetersPerMinute = mode === "driving"
    ? 350
    : (mode === "bicycling" || mode === "cycling" ? 250 : (mode === "transit" ? 300 : 80));
  const fixedOverheadMinutes = mode === "driving" || mode === "transit" ? 5 : 0;
  const durationMinutes = Math.max(
    1,
    Math.round(actualDistanceMeters / speedMetersPerMinute) + fixedOverheadMinutes,
  );

  return {
    distanceMeters: actualDistanceMeters,
    durationMinutes,
    distanceKmText,
    travelTimeText: `约${durationMinutes}分钟`,
    source: "local_geo_engine",
    transportType: mode,
    isCrossRegion: false,
  };
}

/**
 * 直接调用腾讯位置服务 WebService 距离矩阵 API 获取真实路网距离
 * 文档: https://lbs.qq.com/service/webService/webServiceGuide/webServiceDistance
 */
function fetchTencentMapDistance({ from, toList = [], mode = "walking" } = {}) {
  return new Promise((resolve) => {
    const api = getWx();
    const normalizedFrom = {
      latitude: Number(from && (from.latitude !== undefined ? from.latitude : from.lat)),
      longitude: Number(from && (from.longitude !== undefined ? from.longitude : from.lng)),
    };
    const normalizedTargets = (Array.isArray(toList) ? toList : []).slice(0, 25).map((target) => ({
      latitude: Number(target && (target.latitude !== undefined ? target.latitude : target.lat)),
      longitude: Number(target && (target.longitude !== undefined ? target.longitude : target.lng)),
    }));
    // 距离矩阵接口没有公共交通模式，不能把 transit 偷换成 walking 后
    // 将步行结果展示为公交耗时。公交在未接专用路线 API 前只使用本地估算。
    if (mode === "transit" || !api || typeof api.request !== "function" || privacyService.isLocalOnly()
      || !hasCoordinates(normalizedFrom) || !normalizedTargets.length
      || normalizedTargets.some((target) => !hasCoordinates(target))) {
      resolve(null);
      return;
    }

    const key = getStoredKey();
    if (!key) {
      resolve(null);
      return;
    }

    const requestGeneration = cacheGeneration;
    const fromStr = `${normalizedFrom.latitude},${normalizedFrom.longitude}`;
    const toStr = normalizedTargets.map((target) => `${target.latitude},${target.longitude}`).join(";");
    const mapMode = mode === "driving"
      ? "driving"
      : ((mode === "bicycling" || mode === "cycling") ? "bicycling" : "walking");

    api.request({
      url: "https://apis.map.qq.com/ws/distance/v1/matrix",
      data: {
        mode: mapMode,
        from: fromStr,
        to: toStr,
        key,
      },
      method: "GET",
      timeout: 4000,
      success(res) {
        if (privacyService.isLocalOnly() || requestGeneration !== cacheGeneration) {
          resolve(null);
          return;
        }
        if (res.statusCode === 200 && res.data && res.data.status === 0 && res.data.result && Array.isArray(res.data.result.rows)) {
          const rawElements = res.data.result.rows[0] && res.data.result.rows[0].elements;
          const elements = Array.isArray(rawElements)
            ? rawElements.slice(0, normalizedTargets.length)
            : [];
          const results = elements.map((elem, idx) => {
            if (elem
              && elem.distance !== undefined && elem.distance !== null && elem.distance !== ""
              && elem.duration !== undefined && elem.duration !== null && elem.duration !== "") {
              const distanceMeters = Number(elem.distance);
              const durationSeconds = Number(elem.duration);
              if (!Number.isFinite(distanceMeters) || distanceMeters < 0
                || !Number.isFinite(durationSeconds) || durationSeconds < 0) return null;
              const isCrossRegion = isCrossRegionDistance(distanceMeters);
              const durationMinutes = isCrossRegion ? null : Math.max(1, Math.round(durationSeconds / 60));
              const distanceKmText = distanceMeters < 1000 ? `${distanceMeters}m` : `${(distanceMeters / 1000).toFixed(1)}km`;
              const target = normalizedTargets[idx] || {};
              const cacheKey = buildCacheKey(normalizedFrom.latitude, normalizedFrom.longitude, target.latitude, target.longitude, mode);
              
              const itemRes = {
                distanceMeters,
                durationMinutes,
                distanceKmText,
                travelTimeText: isCrossRegion ? "异地商户" : `约${durationMinutes}分钟`,
                source: "tencent_map_api",
                transportType: mode,
                isCrossRegion,
              };
              setDistanceCache(cacheKey, itemRes);
              return itemRes;
            }
            return null;
          });
          resolve(results);
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

/**
 * 统一获取距离信息：优先读缓存 -> 本地即时估算 -> 有自有 Key 时静默在线校准
 */
function resolveDistanceInfo({ from, to, mode = "walking" } = {}) {
  if (!from || !to) return null;
  const lat1 = Number(from.latitude !== undefined ? from.latitude : from.lat);
  const lng1 = Number(from.longitude !== undefined ? from.longitude : from.lng);
  const lat2 = Number(to.latitude !== undefined ? to.latitude : to.lat);
  const lng2 = Number(to.longitude !== undefined ? to.longitude : to.lng);

  if (!hasCoordinates({ latitude: lat1, longitude: lng1 }) || !hasCoordinates({ latitude: lat2, longitude: lng2 })) {
    return null;
  }

  // 1. 检查高速内存缓存
  const cacheKey = buildCacheKey(lat1, lng1, lat2, lng2, mode);
  const cached = getDistanceCache(cacheKey);
  if (cached) return cached;

  // 2. 本地计算作为即时基准
  const localRes = calculateLocalDistance(lat1, lng1, lat2, lng2, mode);
  setDistanceCache(cacheKey, localRes);

  // 3. 仅在配置自有 Key 时静默发起在线校准，否则完全不访问第三方地图接口。
  if (localRes && !localRes.isCrossRegion && !privacyService.isLocalOnly()) {
    fetchTencentMapDistance({ from: { latitude: lat1, longitude: lng1 }, toList: [{ latitude: lat2, longitude: lng2 }], mode });
  }

  return localRes;
}

module.exports = {
  calculateLocalDistance,
  clearDistanceCache,
  fetchTencentMapDistance,
  isCrossRegionDistance,
  resolveDistanceInfo,
  getStoredKey,
  saveCustomMapKey,
  __test__: {
    CACHE_TTL_MS,
    MAX_DISTANCE_CACHE_ENTRIES,
    MAX_LOCAL_ROUTE_DISTANCE_METERS,
    getDistanceCache,
    setDistanceCache,
    getDistanceCacheSize: () => Object.keys(memoryDistanceCache).length,
    getCacheGeneration: () => cacheGeneration,
  },
};
