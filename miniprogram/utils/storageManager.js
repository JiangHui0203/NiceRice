const SCHEMA_KEY = "life_helper_schema_version";
const CURRENT_SCHEMA_VERSION = 2;
const MAX_BACKUP_PAYLOAD_CHARS = 8 * 1024 * 1024;
const MAX_STORED_COUPON_RECORDS = 500;
const MAX_SCREENSHOTS_PER_COUPON = 6;
const { decodeBase64, encodeBase64, encodeBase64Url } = require("./base64Codec.js");
const privacyService = require("./privacyService.js");

// Every record accessed through privacyService belongs here. This list drives
// plaintext-to-encrypted migration and reset, but is intentionally broader
// than the portable backup surface because caches can contain coordinates.
const ENCRYPTED_STORAGE_KEYS = [
  "life_helper_coupons",
  "life_helper_coupon_overrides",
  "life_helper_coupon_deleted",
  "life_helper_plans",
  "life_helper_plans_v2",
  "life_helper_profile_preferences",
  "life_helper_user_schedules",
  "life_helper_friends",
  "life_helper_food_wheel",
  "life_helper_plan_invites",
  "life_helper_plan_invite_tombstones",
  "life_helper_subscription_templates",
  "life_helper_notification_logs",
  "life_helper_event_logs",
  "life_helper_recommendation_logs",
  "life_helper_activity_logs",
  "life_helper_weather_override",
  "life_helper_weather_api_settings",
  "life_helper_location_preferences",
  "life_helper_live_weather_cache",
  "life_helper_weekly_weather_cache",
  "life_helper_reverse_geocode_cache",
  "life_helper_active_origin",
  "life_helper_custom_map_key",
  "life_helper_custom_candidates",
  "life_helper_heatmap_scenes",
  "life_helper_heatmap_selected_ids",
  "life_helper_self_id",
  "life_helper_self_name",
  "life_helper_self_slots",
  "life_helper_slot_votes",
  "life_helper_user_info",
  "life_helper_reorder_coupon_temp",
];

// Portable backups contain durable user-created business data only. Provider
// credentials, live GPS origins, coordinate caches and operational logs stay
// device-local. Import keeps accepting older envelopes, but ignores keys that
// are no longer in this allowlist.
const BACKUP_STORAGE_KEYS = [
  "life_helper_coupons",
  "life_helper_coupon_overrides",
  "life_helper_coupon_deleted",
  "life_helper_plans",
  "life_helper_plans_v2",
  "life_helper_profile_preferences",
  "life_helper_user_schedules",
  "life_helper_friends",
  "life_helper_food_wheel",
  "life_helper_plan_invites",
  "life_helper_plan_invite_tombstones",
  "life_helper_activity_logs",
  "life_helper_weather_override",
  "life_helper_location_preferences",
];

const RESET_STORAGE_KEYS = ENCRYPTED_STORAGE_KEYS.concat([
  "life_helper_heatmap_preset_key",
  "life_helper_local_privacy_secret",
  "life_helper_privacy_settings",
  "life_helper_profile_focus",
]);

const PRIVATE_INVITE_BACKUP_FIELDS = [
  "_openid",
  "creatorOpenid",
  "openid",
  "openId",
  "proposedByOpenid",
  "responderOpenid",
];

function sanitizeBackupStorageValue(key, value) {
  // Device-local paths are capabilities, not portable business data. Restoring
  // them on another device could alias an unrelated file in that device's user
  // directory, so both export and import remove screenshot metadata.
  if (key === "life_helper_coupons" && Array.isArray(value)) {
    return value.map((coupon) => (
      coupon && typeof coupon === "object" && !Array.isArray(coupon)
        ? Object.assign({}, coupon, { screenshots: [] })
        : coupon
    ));
  }
  if (key === "life_helper_coupon_overrides"
    && value && typeof value === "object" && !Array.isArray(value)) {
    const sanitizedOverrides = {};
    Object.keys(value).forEach((id) => {
      const patch = value[id];
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        sanitizedOverrides[id] = patch;
        return;
      }
      const sanitizedPatch = Object.assign({}, patch);
      delete sanitizedPatch.screenshots;
      sanitizedOverrides[id] = sanitizedPatch;
    });
    return sanitizedOverrides;
  }
  if (key !== "life_helper_plan_invites" || !Array.isArray(value)) return value;
  return value.slice(0, 100).filter((item) => (
    item && typeof item === "object" && !Array.isArray(item)
  )).map((item) => {
    const sanitized = Object.assign({}, item);
    PRIVATE_INVITE_BACKUP_FIELDS.forEach((field) => delete sanitized[field]);
    return sanitized;
  });
}

function runBooleanTasksWithConcurrency(items, limit, worker) {
  const source = Array.isArray(items) ? items : [];
  if (!source.length) return Promise.resolve(true);
  let cursor = 0;
  let allSucceeded = true;
  const consume = () => {
    const index = cursor;
    cursor += 1;
    if (index >= source.length) return Promise.resolve();
    return Promise.resolve()
      .then(() => worker(source[index], index))
      .then((result) => { if (!result) allSucceeded = false; })
      .catch(() => { allSucceeded = false; })
      .then(consume);
  };
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), source.length) },
    consume,
  );
  return Promise.all(workers).then(() => allSucceeded);
}

function getSchemaVersion() {
  try {
    return wx.getStorageSync(SCHEMA_KEY) || 1;
  } catch (e) {
    return 1;
  }
}

function setSchemaVersion(version) {
  try {
    wx.setStorageSync(SCHEMA_KEY, version);
    return true;
  } catch (e) {
    console.warn("schema version write failed", e);
    return false;
  }
}

function migrateStorage() {
  const version = getSchemaVersion();
  const sensitiveMigrated = migrateSensitiveStorage();
  if (version >= CURRENT_SCHEMA_VERSION) {
    return { migrated: false, success: sensitiveMigrated, version };
  }
  if (!sensitiveMigrated) {
    return { migrated: false, success: false, version };
  }
  const saved = setSchemaVersion(CURRENT_SCHEMA_VERSION);
  return {
    migrated: saved,
    success: saved,
    version: saved ? CURRENT_SCHEMA_VERSION : version,
  };
}

function migrateSensitiveStorage() {
  let success = true;
  ENCRYPTED_STORAGE_KEYS.forEach((key) => {
    try {
      const stored = wx.getStorageSync(key);
      if (stored === undefined || stored === null || stored === "" || privacyService.isEncryptedRecord(stored)) return;
      if (!privacyService.writeLocalData(key, stored)) success = false;
    } catch (e) {
      success = false;
      console.warn("sensitive storage migration failed", key, e);
    }
  });
  return success;
}

function getDirectUserFileName(filePath) {
  const path = String(filePath || "");
  const prefix = "wxfile://usr/";
  if (path.indexOf(prefix) !== 0) return "";
  const name = path.slice(prefix.length);
  if (!name || name.length > 240 || name === "." || name === ".."
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(name)) return "";
  return name;
}

function isManagedScreenshotFileName(name) {
  return /^(?:(?:shot_|coupon_screenshot_)[A-Za-z0-9][A-Za-z0-9._-]{0,221}|preview_[A-Za-z0-9][A-Za-z0-9._-]{0,231})$/.test(name);
}

function removeSavedAvatarFile(filePath) {
  const path = String(filePath || "");
  if (path.indexOf("wxfile://usr/") !== 0) return Promise.resolve(true);
  // Saved avatars are direct children of WeChat's user directory. Never let
  // corrupted metadata turn reset cleanup into a path traversal.
  if (!getDirectUserFileName(path)) return Promise.resolve(false);
  if (typeof wx === "undefined" || typeof wx.removeSavedFile !== "function") {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    wx.removeSavedFile({
      filePath: path,
      success() { resolve(true); },
      fail(error) {
        console.warn("remove saved avatar failed", error);
        resolve(false);
      },
    });
  });
}

function collectStoredAvatarPath() {
  try {
    const rawUserInfo = wx.getStorageSync("life_helper_user_info");
    let userInfo = rawUserInfo || null;
    if (privacyService.isEncryptedRecord(rawUserInfo)) {
      const decrypted = privacyService.decryptText(rawUserInfo.payload, "life_helper_user_info");
      if (!decrypted) throw new Error("用户元数据无法解密");
      userInfo = JSON.parse(decrypted);
    }
    const avatarUrl = userInfo && typeof userInfo === "object"
      && typeof userInfo.avatarUrl === "string"
      ? userInfo.avatarUrl
      : "";
    if (avatarUrl.length > 2048) throw new Error("头像路径长度无效");
    return { success: true, path: avatarUrl };
  } catch (error) {
    console.warn("read stored avatar for cleanup failed", error);
    return { success: false, path: "" };
  }
}

function clearRuntimeStorageState() {
  privacyService.clearMemoryCache();
  try { require("./plan/planRepository.js").invalidateCache(); } catch (e) {}
  try { require("./services/locationService.js").clearLocationCache(); } catch (e) {}
  try { require("./services/reverseGeocodeService.js").clearReverseGeocodeCache(); } catch (e) {}
  try { require("./services/mapDistanceService.js").clearDistanceCache(); } catch (e) {}
  if (typeof getApp !== "function") return;
  try {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.userLocation = null;
      app.globalData.activeRouteOrigin = null;
    }
  } catch (e) {
    console.warn("reset app location state failed", e);
  }
}

function collectStoredScreenshots() {
  let storedScreenshots = [];
  try {
    const coupons = privacyService.readLocalData("life_helper_coupons", []);
    const overrides = privacyService.readLocalData("life_helper_coupon_overrides", {});
    const records = (Array.isArray(coupons) ? coupons.slice(0, MAX_STORED_COUPON_RECORDS) : []).concat(
      overrides && typeof overrides === "object" && !Array.isArray(overrides)
        ? Object.values(overrides).slice(0, MAX_STORED_COUPON_RECORDS)
        : []
    );
    const seen = new Set();
    records.forEach((coupon) => {
      (Array.isArray(coupon && coupon.screenshots)
        ? coupon.screenshots.slice(0, MAX_SCREENSHOTS_PER_COUPON)
        : []).forEach((item) => {
        const key = item && typeof item === "object"
          ? (item.encryptedPath || item.savedFilePath || item.path || item.fileID || item.url || item.id)
          : String(item || "");
        if (!key || seen.has(key)) return;
        seen.add(key);
        storedScreenshots.push(item);
      });
    });
  } catch (error) {
    console.warn("read stored screenshots for cleanup failed", error);
  }
  return storedScreenshots;
}

function clearLocalScreenshotFiles(options = {}) {
  // Directory sweeping is safe only after both coupon metadata stores are
  // durably gone. Without this explicit capability, fail closed instead of
  // leaving surviving records that point at deleted attachments.
  if (options.metadataRemoved !== true) return Promise.resolve(false);
  const storedScreenshots = Array.isArray(options.storedScreenshots)
    ? options.storedScreenshots
    : collectStoredScreenshots();

  let metadataCleanup = Promise.resolve(true);
  try {
    const screenshotService = require("./services/screenshotService.js");
    metadataCleanup = runBooleanTasksWithConcurrency(
      storedScreenshots,
      2,
      // Coupon metadata has already been removed before this cleanup starts.
      (item) => screenshotService.deleteScreenshot(item),
    );
  } catch (error) {
    metadataCleanup = Promise.resolve(false);
  }

  function cleanupManagedDirectory() {
    try {
      if (!wx.getFileSystemManager || !wx.env || !wx.env.USER_DATA_PATH) return Promise.resolve(true);
      const fs = wx.getFileSystemManager();
      const basePath = String(wx.env.USER_DATA_PATH).replace(/\/+$/, "");
      if (!basePath) return Promise.resolve(false);
      if (!fs || typeof fs.readdir !== "function" || typeof fs.unlink !== "function") {
        return Promise.resolve(false);
      }
      return new Promise((resolve) => {
        fs.readdir({
          dirPath: basePath,
          success(res) {
            const names = (res.files || []).filter((name) => (
              typeof name === "string" && isManagedScreenshotFileName(name)
            ));
            if (!names.length) {
              resolve(true);
              return;
            }
            runBooleanTasksWithConcurrency(names, 2, (name) => new Promise((done) => {
              fs.unlink({
                filePath: `${basePath}/${name}`,
                success() { done(true); },
                fail(error) {
                  console.warn("remove local screenshot failed", name, error);
                  done(false);
                },
              });
            })).then(resolve);
          },
          fail() { resolve(false); },
        });
      });
    } catch (e) {
      console.warn("clear local screenshot files failed", e);
      return Promise.resolve(false);
    }
  }
  // 先按元数据删除，再扫描剩余托管文件，避免两个清理分支并发删除同一路径而误报失败。
  return Promise.resolve(metadataCleanup)
    .then((metadataCleared) => cleanupManagedDirectory()
      .then((directoryCleared) => Boolean(metadataCleared && directoryCleared)))
    .catch((error) => {
      console.warn("local screenshot cleanup failed", error);
      return false;
    });
}

function resetLocalPrototypeData(options = {}) {
  // 截图引用必须在券数据删除前取出；但只有券元数据确实删除成功后才能删文件，
  // 否则一次部分失败的重置会留下仍指向已删除文件的券记录。
  const storedScreenshots = options.skipScreenshotCleanup ? [] : collectStoredScreenshots();
  let storageCleared = true;
  let couponMetadataCleared = true;
  let userMetadataCleared = true;
  const avatarSnapshot = collectStoredAvatarPath();
  const storedAvatarPath = avatarSnapshot.path;
  if (!avatarSnapshot.success) {
    storageCleared = false;
    userMetadataCleared = false;
  }
  const privacySecretKey = "life_helper_local_privacy_secret";
  [...new Set(RESET_STORAGE_KEYS)].filter((key) => key !== privacySecretKey).forEach((key) => {
    try {
      wx.removeStorageSync(key);
    } catch (e) {
      storageCleared = false;
      if (key === "life_helper_coupons" || key === "life_helper_coupon_overrides") {
        couponMetadataCleared = false;
      }
      if (key === "life_helper_user_info") userMetadataCleared = false;
      console.warn("remove storage failed", key, e);
    }
  });
  // The local secret is removed last. If any encrypted record could not be
  // deleted, retaining the secret keeps that remaining data recoverable.
  if (storageCleared) {
    try {
      wx.removeStorageSync(privacySecretKey);
    } catch (e) {
      storageCleared = false;
      console.warn("remove privacy secret failed", e);
    }
  }
  const screenshotCleanup = options.skipScreenshotCleanup
    ? Promise.resolve(true)
    : couponMetadataCleared
      ? clearLocalScreenshotFiles({ storedScreenshots, metadataRemoved: true })
      : Promise.resolve(false);
  // The avatar is an owned saved file only after its metadata is durably gone.
  // If metadata removal failed, retaining the file avoids a dangling avatar URL.
  const avatarCleanup = userMetadataCleared
    ? removeSavedAvatarFile(storedAvatarPath)
    : Promise.resolve(false);
  clearRuntimeStorageState();
  const schemaSaved = storageCleared ? setSchemaVersion(CURRENT_SCHEMA_VERSION) : false;
  return Promise.all([screenshotCleanup, avatarCleanup]).then(([screenshotsCleared, avatarCleared]) => (
    Boolean(screenshotsCleared && avatarCleared && storageCleared && schemaSaved)
  )).catch((error) => {
    console.warn("reset local prototype data failed", error);
    return false;
  });
}

function clearAllLocalData() {
  // Capture owned-file references before clearing their only metadata. Files
  // are removed only after clearStorageSync succeeds, so a storage failure can
  // never leave surviving records pointing at deleted files.
  const storedScreenshots = collectStoredScreenshots();
  const avatarSnapshot = collectStoredAvatarPath();
  try {
    wx.clearStorageSync();
  } catch (error) {
    console.warn("clear all local storage failed", error);
    return Promise.resolve(false);
  }

  clearRuntimeStorageState();
  const schemaSaved = setSchemaVersion(CURRENT_SCHEMA_VERSION);
  const screenshotCleanup = clearLocalScreenshotFiles({ storedScreenshots, metadataRemoved: true });
  const avatarCleanup = avatarSnapshot.success
    ? removeSavedAvatarFile(avatarSnapshot.path)
    : Promise.resolve(false);
  return Promise.all([screenshotCleanup, avatarCleanup])
    .then(([screenshotsCleared, avatarCleared]) => (
      Boolean(schemaSaved && screenshotsCleared && avatarCleared)
    ))
    .catch((error) => {
      console.warn("clear all local data failed", error);
      return false;
    });
}

function exportBackup() {
  const backup = {
    version: CURRENT_SCHEMA_VERSION,
    exportTime: new Date().toISOString(),
    data: {}
  };
  BACKUP_STORAGE_KEYS.forEach((key) => {
    const val = privacyService.readLocalData(key, null);
    if (val !== null) {
      backup.data[key] = sanitizeBackupStorageValue(key, val);
    }
  });
  return encodeBase64(JSON.stringify(backup));
}

function importBackup(base64Str) {
  try {
    if (typeof base64Str !== "string" || !base64Str || base64Str.length > MAX_BACKUP_PAYLOAD_CHARS) {
      return { success: false, error: "备份数据为空或体积过大" };
    }
    const jsonStr = decodeBase64(base64Str);
    if (jsonStr.length > MAX_BACKUP_PAYLOAD_CHARS) {
      return { success: false, error: "备份数据体积过大" };
    }
    const backup = JSON.parse(jsonStr);
    if (!backup || !backup.data || typeof backup.data !== "object" || Array.isArray(backup.data)) {
      return { success: false, error: '备份数据格式不正确，缺少数据包' };
    }
    const backupVersion = backup.version === undefined ? 1 : Number(backup.version);
    if (!Number.isInteger(backupVersion) || backupVersion < 1 || backupVersion > CURRENT_SCHEMA_VERSION) {
      return { success: false, error: `备份版本不受支持: ${backup.version}` };
    }

    const targetKeys = Object.keys(backup.data).filter((key) => (
      BACKUP_STORAGE_KEYS.indexOf(key) > -1
    ));
    if (!targetKeys.length) {
      return { success: false, error: "备份中没有可恢复的业务数据" };
    }
    let storedKeySet = null;
    try {
      if (typeof wx.getStorageInfoSync === "function") {
        storedKeySet = new Set((wx.getStorageInfoSync().keys || []).map(String));
      }
    } catch (error) {}
    let snapshotReadFailed = false;
    const snapshots = targetKeys.map((key) => {
      let raw;
      let exists = false;
      try {
        raw = wx.getStorageSync(key);
        exists = storedKeySet
          ? storedKeySet.has(key)
          : raw !== undefined && raw !== null && raw !== "";
      } catch (error) {
        snapshotReadFailed = true;
      }
      return { key, exists, raw };
    });
    if (snapshotReadFailed) {
      return { success: false, error: "无法读取导入前数据，未写入任何内容" };
    }
    const failedKeys = [];
    targetKeys.forEach((key) => {
      const importedValue = sanitizeBackupStorageValue(key, backup.data[key]);
      if (!privacyService.writeLocalData(key, importedValue)) failedKeys.push(key);
    });
    if (failedKeys.length) {
      let rolledBack = true;
      // Remove keys that did not exist before first, which also frees quota for
      // restoring the previous values of existing keys.
      snapshots.filter((item) => !item.exists).forEach((item) => {
        try {
          wx.removeStorageSync(item.key);
        } catch (error) {
          rolledBack = false;
        }
        // A failed rollback leaves durable state uncertain. Discard the
        // imported cache value either way so the next read reflects disk.
        privacyService.clearMemoryCache(item.key);
      });
      snapshots.filter((item) => item.exists).forEach((item) => {
        try {
          wx.setStorageSync(item.key, item.raw);
        } catch (error) {
          rolledBack = false;
        }
        privacyService.clearMemoryCache(item.key);
      });
      clearRuntimeStorageState();
      return {
        success: false,
        error: rolledBack
          ? `以下数据写入失败，已恢复导入前状态: ${failedKeys.join(", ")}`
          : `以下数据写入失败，且部分回滚未完成: ${failedKeys.join(", ")}`,
        rollbackFailed: !rolledBack,
      };
    }

    const coupons = Array.isArray(backup.data["life_helper_coupons"])
      ? backup.data["life_helper_coupons"]
      : [];
    const friends = Array.isArray(backup.data["life_helper_friends"])
      ? backup.data["life_helper_friends"]
      : [];
    const plans = Array.isArray(backup.data["life_helper_plans_v2"])
      ? backup.data["life_helper_plans_v2"]
      : (Array.isArray(backup.data["life_helper_plans"])
        ? backup.data["life_helper_plans"]
        : []);

    // Imported values are durable now; discard service/repository snapshots so
    // subsequent reads cannot keep showing the pre-import state.
    clearRuntimeStorageState();

    return {
      success: true,
      couponCount: coupons.length,
      friendCount: friends.length,
      planCount: plans.length
    };
  } catch (e) {
    return { success: false, error: `解析错误: ${e.message}` };
  }
}

module.exports = {
  BACKUP_STORAGE_KEYS,
  CURRENT_SCHEMA_VERSION,
  ENCRYPTED_STORAGE_KEYS,
  MAX_BACKUP_PAYLOAD_CHARS,
  RESET_STORAGE_KEYS,
  clearAllLocalData,
  clearLocalScreenshotFiles,
  getSchemaVersion,
  migrateStorage,
  migrateSensitiveStorage,
  resetLocalPrototypeData,
  exportBackup,
  importBackup,
  encodeBase64,
  encodeBase64Url,
  decodeBase64,
};
