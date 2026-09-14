/**
 * Remote weather transport, geocoding and cache orchestration.
 * Dependencies are injected so the local weather facade remains independently testable.
 */

const {
  isValidLatitude,
  isValidLongitude,
  normalizeCoordinate,
} = require("../locationUtils.js");

function readCoordinate(location, primaryKey, aliasKey) {
  const primary = location && location[primaryKey];
  const alias = location && location[aliasKey];
  const raw = primary !== undefined && primary !== null && primary !== ""
    ? primary
    : (alias !== undefined && alias !== null && alias !== "" ? alias : null);
  return normalizeCoordinate(raw);
}

function resolveRequestCoordinates(location = {}) {
  const lat = readCoordinate(location, "latitude", "lat");
  const lng = readCoordinate(location, "longitude", "lng");
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) return null;
  return { lat, lng };
}

function buildCoordinateCacheKey(location = {}) {
  const coordinates = resolveRequestCoordinates(location);
  if (!coordinates) return "";
  return `${coordinates.lat.toFixed(4)},${coordinates.lng.toFixed(4)}`;
}

function isCoordinateCacheFresh(cache, locationKey, now, ttl, validateData) {
  return Boolean(
    cache
    && cache.locationKey === locationKey
    && cache.timestamp
    && now - cache.timestamp < ttl
    && validateData(cache.data)
  );
}

function numberOr(value, fallback) {
  if (value === "" || value === null || value === undefined) return fallback;
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  if (typeof value === "string" && !value.trim()) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readTemperature(value) {
  const parsed = numberOr(value, null);
  return Number.isFinite(parsed) && parsed >= -100 && parsed <= 100 ? parsed : null;
}

function readProviderText(value, maxLength = 64) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().slice(0, maxLength);
}

function isValidForecastDate(value) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function createWeatherRemoteService(dependencies = {}) {
  const {
    config,
    liveWeatherCacheKey: LIVE_WEATHER_CACHE_KEY,
    privacyService,
    weatherApiSettingsStore,
    weatherApiAdapter,
    weatherEngine,
    weeklyWeatherCacheKey: WEEKLY_WEATHER_CACHE_KEY,
    withMeta,
  } = dependencies;
  let liveRequestSequence = 0;
  let weeklyRequestSequence = 0;

function normalizeHost(host) {
  const localCredential = weatherApiSettingsStore
    && typeof weatherApiSettingsStore.getEnabledCredential === "function"
    ? weatherApiSettingsStore.getEnabledCredential()
    : null;
  const rawHost = host !== undefined && host !== null
    ? host
    : ((localCredential && localCredential.apiHost) || (config && config.QWEATHER_API_HOST));
  if (typeof rawHost !== "string") return "";
  let h = rawHost.trim();
  if (Array.from(h).length > 512) return "";
  if (!h) return "";
  if (!/^https?:\/\//i.test(h)) {
    h = `https://${h}`;
  }
  return h.replace(/\/+$/, "");
}

function normalizeApiKey(value) {
  if (typeof value !== "string") return "";
  const key = value.trim();
  return Array.from(key).length <= 512 ? key : "";
}

function getEffectiveApiKey() {
  const localCredential = weatherApiSettingsStore
    && typeof weatherApiSettingsStore.getEnabledCredential === "function"
    ? weatherApiSettingsStore.getEnabledCredential()
    : null;
  if (localCredential && localCredential.apiKey) {
    return normalizeApiKey(localCredential.apiKey);
  }
  if (!config) return "";
  if (typeof config.getWeatherApiKey === "function") {
    return normalizeApiKey(config.getWeatherApiKey());
  }
  return normalizeApiKey(config.QWEATHER_API_KEY);
}

function isRemoteWeatherAllowed() {
  if (!privacyService || typeof privacyService.isLocalOnly !== "function") return false;
  if (!privacyService.isLocalOnly()) return true;
  return Boolean(
    weatherApiSettingsStore
    && typeof weatherApiSettingsStore.isDirectAccessEnabled === "function"
    && weatherApiSettingsStore.isDirectAccessEnabled()
  );
}

function buildApiKeyHeader(key) {
  return { "X-QW-Api-Key": key };
}

function lookupCity(location = {}) {
  return new Promise((resolve) => {
    if (!isRemoteWeatherAllowed()) {
      resolve(null);
      return;
    }
    const key = getEffectiveApiKey();
    if (!key) {
      resolve(null);
      return;
    }
    const coordinates = resolveRequestCoordinates(location);
    if (!coordinates) {
      resolve(null);
      return;
    }
    const { lat, lng } = coordinates;
    const host = normalizeHost();
    if (!host) {
      resolve(null);
      return;
    }
    const reqLocation = `${lng.toFixed(4)},${lat.toFixed(4)}`;
    const api = typeof wx !== "undefined" ? wx : null;
    if (!api || typeof api.request !== "function") {
      resolve(null);
      return;
    }

    api.request({
      url: `${host}/geo/v2/city/lookup`,
      data: {
        location: reqLocation,
      },
      header: buildApiKeyHeader(key),
      method: "GET",
      timeout: 5000,
      success(res) {
        if (!isRemoteWeatherAllowed()) {
          resolve(null);
          return;
        }
        if (res.statusCode === 200 && res.data && res.data.code === "200" && Array.isArray(res.data.location) && res.data.location[0]) {
          const item = res.data.location[0];
          const district = readProviderText(item.name, 64);
          const city = readProviderText(item.adm2 || item.adm1, 64);
          const province = readProviderText(item.adm1, 64);
          if (!district && !city && !province) {
            resolve(null);
            return;
          }
          let displayName = district;
          if (city && city !== district) {
            displayName = `${city} · ${district}`;
          }
          resolve({
            name: displayName,
            district,
            city,
            province,
            address: `${province}${city}${district}`,
            latitude: lat,
            longitude: lng,
            lat,
            lng,
          });
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

function fetchLiveWeather(location = {}, forceRefresh = false) {
  return new Promise((resolve) => {
    const requestId = ++liveRequestSequence;
    const key = getEffectiveApiKey();
    if (!key) {
      resolve(null);
      return;
    }

    if (!isRemoteWeatherAllowed()) {
      resolve(null);
      return;
    }

    const coordinates = resolveRequestCoordinates(location);
    if (!coordinates) {
      resolve(null);
      return;
    }
    const { lat, lng } = coordinates;
    const locationKey = buildCoordinateCacheKey(location);

    const cache = privacyService.readLocalData(LIVE_WEATHER_CACHE_KEY, null);
    const ttl = (config && config.WEATHER_CACHE_TTL_MS) || (30 * 60 * 1000);
    const now = Date.now();
    if (!forceRefresh && isCoordinateCacheFresh(cache, locationKey, now, ttl, (data) => Boolean(data))) {
      console.log(`[WeatherService] 📦 使用缓存实况天气 (更新于: ${cache.data.updatedAt})`);
      fetchWeeklyForecast(location, false);
      resolve(cache.data);
      return;
    }

    const api = typeof wx !== "undefined" ? wx : null;
    if (!api || typeof api.request !== "function") {
      resolve(null);
      return;
    }

    const host = normalizeHost();
    if (!host) {
      resolve(null);
      return;
    }
    const reqLocation = `${lng.toFixed(4)},${lat.toFixed(4)}`;

    console.log(`[WeatherService] 🌤️ 正在请求和风天气实况与预报 (经纬度: ${reqLocation})...`);

    // 1. 请求实况天气
    const reqNow = new Promise((resNow) => {
      api.request({
        url: `${host}/v7/weather/now`,
        data: { location: reqLocation },
        header: buildApiKeyHeader(key),
        method: "GET",
        timeout: 6000,
        success: (res) => resNow(res),
        fail: (err) => {
          console.warn("[WeatherService] 实况接口请求失败:", err);
          resNow(null);
        },
      });
    });

    // 2. 并行请求 7 天预报（获取最高/最低温）
    const req7d = fetchWeeklyForecast(location, forceRefresh).catch(() => null);

    // 3. 并行反查城市区县
    const reqCity = (location.name && location.name !== "当前位置" && location.name !== "当前起点")
      ? Promise.resolve({ name: location.name, address: location.address || "" })
      : lookupCity(location).catch(() => null);

    Promise.all([reqNow, req7d, reqCity]).then(([resNow, weeklyList, cityInfo]) => {
      if (requestId !== liveRequestSequence || !isRemoteWeatherAllowed()) {
        resolve(null);
        return;
      }
      if (resNow && resNow.statusCode === 200 && resNow.data && resNow.data.code === "200" && resNow.data.now) {
        try {
          const nowData = resNow.data.now;
          const parsed = weatherApiAdapter.parseWeatherApiResponse(resNow.data, "qweather");
          if (!parsed) {
            resolve(null);
            return;
          }
          const localNow = new Date();
          const pad = (value) => String(value).padStart(2, "0");
          const todayKey = `${localNow.getFullYear()}-${pad(localNow.getMonth() + 1)}-${pad(localNow.getDate())}`;
          const todayForecast = (Array.isArray(weeklyList)
            ? weeklyList.find((item) => item && item.date === todayKey)
            : null) || {};
          const currentTemp = parsed.temperature;
          const tempMax = readTemperature(todayForecast.temperatureMax);
          const tempMin = readTemperature(todayForecast.temperatureMin);
          const resolvedLocName = readProviderText(
            (cityInfo && cityInfo.name) || (location && location.name),
            64
          );

          if (parsed) {
            const liveOverrides = {
              title: parsed.condition,
              condition: parsed.condition,
              desc: parsed.summary,
              temperature: currentTemp,
              temperatureText: `${currentTemp}°`,
              locationName: resolvedLocName,
              mainCondition: parsed.mainCondition,
              intensity: parsed.intensity,
              timePhase: parsed.timePhase,
              tips: parsed.tips,
              isLiveApi: true,
              updatedAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
            };
            if (tempMin !== null && tempMax !== null && tempMin <= tempMax) {
              liveOverrides.temperatureMax = tempMax;
              liveOverrides.temperatureMin = tempMin;
              liveOverrides.temperatureRange = `${tempMin}-${tempMax}°`;
            }
            const liveData = withMeta(Object.assign({}, parsed.raw, liveOverrides), "api");

            console.log(`[WeatherService] ✅ 和风实况与最高/最低温同步成功:`, {
              位置: resolvedLocName,
              天气: parsed.condition,
              当前气温: `${currentTemp}°C`,
              最高温: tempMax === null ? "预报未提供" : `${tempMax}°C`,
              最低温: tempMin === null ? "预报未提供" : `${tempMin}°C`,
              体感: `${nowData.feelsLike || currentTemp}°C`,
              更新时间: liveData.updatedAt
            });

            const cacheSaved = privacyService.writeLocalData(LIVE_WEATHER_CACHE_KEY, {
              timestamp: now,
              locationKey,
              data: liveData,
            });
            if (!cacheSaved) {
              console.warn("[WeatherService] 实况天气已获取，但本地缓存保存失败");
              resolve(null);
              return;
            }

            resolve(liveData);
            return;
          }
        } catch (e) {
          console.error("[WeatherService] 解析和风天气数据失败:", e);
        }
      }
      resolve(null);
    }).catch((e) => {
      console.warn("[WeatherService] 请求天气异常:", e);
      resolve(null);
    });
  });
}

/**
 * 获取未来 7 天真实气象预报 (/v7/weather/7d)
 */
function fetchWeeklyForecast(location = {}, forceRefresh = false, requestOptions = {}) {
  return new Promise((resolve) => {
    const requestId = ++weeklyRequestSequence;
    const hasOverrideKey = Object.prototype.hasOwnProperty.call(requestOptions, "apiKey");
    const key = hasOverrideKey ? normalizeApiKey(requestOptions.apiKey) : getEffectiveApiKey();
    if (!key) {
      resolve(null);
      return;
    }

    if (!isRemoteWeatherAllowed()) {
      resolve(null);
      return;
    }

    const coordinates = resolveRequestCoordinates(location);
    if (!coordinates) {
      resolve(null);
      return;
    }
    const { lat, lng } = coordinates;
    const locationKey = buildCoordinateCacheKey(location);

    const useSharedCache = !hasOverrideKey && !requestOptions.host && requestOptions.skipCache !== true;
    const cache = useSharedCache
      ? privacyService.readLocalData(WEEKLY_WEATHER_CACHE_KEY, null)
      : null;
    const ttl = 2 * 60 * 60 * 1000; // 7天预报缓存 2 小时
    const now = Date.now();
    if (useSharedCache && !forceRefresh && isCoordinateCacheFresh(cache, locationKey, now, ttl, Array.isArray)) {
      resolve(cache.data);
      return;
    }

    const api = typeof wx !== "undefined" ? wx : null;
    if (!api || typeof api.request !== "function") {
      resolve(null);
      return;
    }

    const host = normalizeHost(requestOptions.host);
    if (!host) {
      resolve(null);
      return;
    }
    const reqLocation = `${lng.toFixed(4)},${lat.toFixed(4)}`;

    api.request({
      url: `${host}/v7/weather/7d`,
      data: {
        location: reqLocation,
      },
      header: buildApiKeyHeader(key),
      method: "GET",
      timeout: 6000,
      success(res) {
        if (requestId !== weeklyRequestSequence || !isRemoteWeatherAllowed()) {
          resolve(null);
          return;
        }
        if (res.statusCode === 200 && res.data && res.data.code === "200" && Array.isArray(res.data.daily)) {
          try {
            const list = res.data.daily.slice(0, 7).map((item, idx) => {
              if (!item || typeof item !== "object") return null;
              const date = readProviderText(item.fxDate, 16);
              const tempMax = readTemperature(item.tempMax);
              const tempMin = readTemperature(item.tempMin);
              const iconCode = readProviderText(item.iconDay, 16);
              const textDay = readProviderText(item.textDay, 64);
              const textNight = readProviderText(item.textNight, 64);
              const matchedDay = weatherApiAdapter.matchQWeatherCode(iconCode, textDay);
              if (
                !isValidForecastDate(date)
                || tempMax === null
                || tempMin === null
                || tempMin > tempMax
                || !iconCode
                || !textDay
                || !matchedDay
              ) return null;
              const tempAvg = Math.round((tempMax + tempMin) / 2);
              const windScaleText = readProviderText(item.windScaleDay, 16);
              const windScaleMatched = windScaleText.match(/\d+/);
              const humidity = numberOr(item.humidity, null);
              const precip = numberOr(item.precip, null);
              const uvIndex = numberOr(item.uvIndex, null);
              const rawDay = {
                temperature: tempAvg,
                temperatureMin: tempMin,
                temperatureMax: tempMax,
                conditionCode: iconCode,
                conditionText: textDay,
                mainCondition: matchedDay.condition,
                intensity: matchedDay.intensity,
                timePhase: "afternoon",
              };
              if (windScaleMatched) rawDay.windLevel = Number(windScaleMatched[0]);
              const windDir = readProviderText(item.windDirDay, 32);
              if (windDir) rawDay.windDir = windDir;
              if (Number.isFinite(humidity)) rawDay.humidity = humidity;
              if (Number.isFinite(precip)) {
                rawDay.precip = precip;
                rawDay.rain = precip > 0
                  ? Math.min(100, Math.round(precip * 10))
                  : (matchedDay.condition === "rain" ? 40 : 0);
              }
              if (Number.isFinite(uvIndex)) rawDay.uvIndex = uvIndex;

              const v2Scene = weatherEngine.generateWeatherScene(rawDay);

              let icon = "☀️";
              if (matchedDay.condition === "rain") icon = "🌧️";
              else if (matchedDay.condition === "snow") icon = "❄️";
              else if (matchedDay.condition === "cloudy") icon = "⛅";
              else if (matchedDay.condition === "overcast") icon = "☁️";
              else if (matchedDay.condition === "thunderstorm") icon = "⛈️";
              else if (matchedDay.condition === "fog" || matchedDay.condition === "haze") icon = "🌫️";

              return {
                dayOffset: idx,
                date,
                fxDate: date,
                temperature: `${tempMin}-${tempMax}°`,
                temperatureRange: `${tempMin}-${tempMax}°`,
                tempSimple: `${tempAvg}°`,
                temperatureMin: tempMin,
                temperatureMax: tempMax,
                tempAvg,
                condition: textDay,
                conditionDay: textDay,
                conditionNight: textNight,
                icon,
                mainCondition: matchedDay.condition,
                precip: rawDay.precip,
                rain: rawDay.rain,
                uvIndex: rawDay.uvIndex,
                windDir,
                windScale: windScaleText,
                v2Scene,
                raw: rawDay,
                source: "api_forecast",
              };
            }).filter(Boolean);

            if (!list.length) {
              resolve(null);
              return;
            }

            console.log(`[WeatherService] 📅 和风未来 7 天预报获取成功: ${list.length} 天`);
            if (useSharedCache && requestOptions.skipWrite !== true) {
              const cacheSaved = privacyService.writeLocalData(WEEKLY_WEATHER_CACHE_KEY, {
                timestamp: now,
                locationKey,
                data: list,
              });
              if (!cacheSaved) {
                console.warn("[WeatherService] 天气预报已获取，但本地缓存保存失败");
                resolve(null);
                return;
              }
            }
            resolve(list);
            return;
          } catch (err) {
            console.error("[WeatherService] 解析 7 天天气预报失败:", err);
          }
        }
        resolve(null);
      },
      fail(err) {
        if (requestId !== weeklyRequestSequence) {
          resolve(null);
          return;
        }
        console.warn("[WeatherService] 7 天天气预报网络请求失败:", err);
        resolve(null);
      },
    });
  });
}

function testQWeatherApiConnection(customHost, customKey, location = {}) {
  return new Promise((resolve) => {
    if (!isRemoteWeatherAllowed()) {
      resolve({ success: false, code: "weather_direct_disabled", message: "请先开启本机天气 API 直连授权" });
      return;
    }
    const key = normalizeApiKey(customKey || getEffectiveApiKey());
    if (!key) {
      resolve({ success: false, message: "尚未配置和风天气 API Key" });
      return;
    }

    const host = normalizeHost(customHost);
    if (!host) {
      resolve({ success: false, message: "天气 API 接口地址格式不正确" });
      return;
    }
    const coordinates = resolveRequestCoordinates(location);
    if (!coordinates) {
      resolve({ success: false, message: "经纬度格式不正确" });
      return;
    }
    const { lat, lng } = coordinates;
    const reqLocation = `${lng.toFixed(2)},${lat.toFixed(2)}`;

    const api = typeof wx !== "undefined" ? wx : null;
    if (!api || typeof api.request !== "function") {
      resolve({ success: false, message: "非微信小程序运行环境" });
      return;
    }

    api.request({
      url: `${host}/v7/weather/now`,
      data: {
        location: reqLocation,
      },
      header: buildApiKeyHeader(key),
      method: "GET",
      timeout: 6000,
      success(res) {
        if (!isRemoteWeatherAllowed()) {
          resolve({ success: false, code: "weather_direct_disabled", message: "本机天气 API 直连已关闭，连接测试停止" });
          return;
        }
        if (res.statusCode === 200 && res.data) {
          if (res.data.code === "200" && res.data.now) {
            const parsed = weatherApiAdapter.parseWeatherApiResponse(res.data, "qweather");
            if (!parsed) {
              resolve({
                success: false,
                statusCode: 200,
                code: "invalid_weather_payload",
                message: "接口已响应，但实况天气字段不完整",
              });
              return;
            }
            
            // 顺便测试并预热 7 天预报接口
            // The connection test must use exactly the host/key being tested;
            // using the saved credential here could falsely report that the
            // 7-day endpoint worked (or failed) for another configuration.
            fetchWeeklyForecast(location, true, {
              apiKey: key,
              host,
              skipCache: true,
              skipWrite: true,
            }).then((forecastList) => {
              if (!isRemoteWeatherAllowed()) {
                resolve({ success: false, code: "weather_direct_disabled", message: "本机天气 API 直连已关闭，连接测试停止" });
                return;
              }
              const forecastDays = Array.isArray(forecastList) ? forecastList.length : 0;
              resolve({
                success: true,
                statusCode: 200,
                code: "200",
                message: forecastDays > 0
                  ? "连接成功！实况与 7 天预报已打通"
                  : "实况连接成功，7 天预报暂不可用",
                now: res.data.now,
                parsed,
                forecastDays,
                reqLocation,
              });
            }).catch(() => {
              resolve({
                success: true,
                statusCode: 200,
                code: "200",
                message: "连接成功！",
                now: res.data.now,
                parsed,
                forecastDays: 0,
                reqLocation,
              });
            });
            return;
          }
          resolve({
            success: false,
            statusCode: 200,
            code: res.data.code,
            message: `接口返回状态码: ${res.data.code}`,
            raw: res.data,
          });
          return;
        }
        
        let hint = "";
        if (res.statusCode === 403) {
          hint = "（403 Invalid Host: 请确认开发者选项中的专属 Host 与和风控制台一致）";
        }
        resolve({
          success: false,
          statusCode: res.statusCode,
          message: `HTTP ${res.statusCode} ${hint}`,
          raw: res.data,
        });
      },
      fail(err) {
        resolve({
          success: false,
          statusCode: 0,
          message: `网络请求失败: ${err.errMsg || "请确认是否在开发者工具中开启了「不校验合法域名」"}`,
          err,
        });
      },
    });
  });
}


  return {
    fetchLiveWeather,
    fetchWeeklyForecast,
    getEffectiveApiKey,
    lookupCity,
    normalizeHost,
    testQWeatherApiConnection,
  };
}

module.exports = {
  buildCoordinateCacheKey,
  createWeatherRemoteService,
  isCoordinateCacheFresh,
  resolveRequestCoordinates,
};
