/**
 * couponRepository.js
 * 优惠券数据持久化仓储层
 * 封装 privacyService.readLocalData / writeLocalData，支持安全透明解密与缓存
 */

const mock = require("../mock.js");
const privacyService = require("../privacyService.js");
const { normalizeCoupon } = require("./couponNormalizer.js");

const COUPON_KEY = "life_helper_coupons";
const COUPON_OVERRIDE_KEY = "life_helper_coupon_overrides";
const COUPON_DELETED_KEY = "life_helper_coupon_deleted";
const MAX_STORED_COUPONS = 500;
const MAX_OVERRIDE_FIELDS = 30;

function normalizeExactId(value) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  if (!id || id !== value || Array.from(id).length > 96
    || ["__proto__", "constructor", "prototype"].includes(id)) return "";
  return id;
}

function sanitizeOverridePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return null;
  const keys = Object.keys(patch);
  if (keys.length > MAX_OVERRIDE_FIELDS) return null;
  const result = {};
  for (let index = 0; index < keys.length; index += 1) {
    const rawKey = keys[index];
    const key = rawKey.trim();
    if (!key || key !== rawKey || key.length > 48
      || ["id", "__proto__", "constructor", "prototype"].includes(key)) return null;
    const value = patch[rawKey];
    if (typeof value === "string") {
      if (value.length > 500) return null;
      result[key] = value;
    }
    else if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    else if (typeof value === "boolean" || value === null) result[key] = value;
    else if (Array.isArray(value)) {
      if (value.length > 30) return null;
      const items = [];
      for (let itemIndex = 0; itemIndex < value.length; itemIndex += 1) {
        const item = value[itemIndex];
        if (typeof item === "string") {
          if (item.length > 160) return null;
          items.push(item);
        } else if (typeof item === "number" && Number.isFinite(item)) items.push(item);
        else if (typeof item === "boolean" || item === null) items.push(item);
        else return null;
      }
      result[key] = items;
    }
    else return null;
  }
  return result;
}

function readStorage(key, fallback = null) {
  const data = privacyService.readLocalData(key, fallback);
  return data !== "" && data !== null && data !== undefined ? data : fallback;
}

function readDeletedCouponIds() {
  const data = readStorage(COUPON_DELETED_KEY, []);
  const seen = new Set();
  return (Array.isArray(data) ? data : []).reduce((ids, item) => {
    const id = normalizeExactId(item);
    if (!id || id !== item || seen.has(id) || ids.length >= MAX_STORED_COUPONS) return ids;
    seen.add(id);
    ids.push(id);
    return ids;
  }, []);
}

function saveDeletedCouponIds(ids = []) {
  if (!Array.isArray(ids) || ids.length > MAX_STORED_COUPONS) return false;
  const sanitized = readIdsForWrite(ids);
  if (!sanitized) return false;
  return privacyService.writeLocalData(COUPON_DELETED_KEY, sanitized);
}

function readIdsForWrite(ids) {
  const seen = new Set();
  const result = [];
  for (let index = 0; index < ids.length; index += 1) {
    const item = ids[index];
    const id = normalizeExactId(item);
    if (!id || id !== item || seen.has(id)) return null;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function readCouponOverrides() {
  const data = readStorage(COUPON_OVERRIDE_KEY, {});
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const result = {};
  const rawIds = Object.keys(data);
  let validCount = 0;
  for (let index = 0; index < rawIds.length; index += 1) {
    if (validCount >= MAX_STORED_COUPONS) break;
    const rawId = rawIds[index];
    const id = normalizeExactId(rawId);
    if (!id) continue;
    const patch = sanitizeOverridePatch(data[rawId]);
    // Reads are tolerant for legacy/corrupt storage, but fail closed per
    // override: never partially apply or remap an invalid patch.
    if (patch && Object.keys(patch).length) {
      result[id] = patch;
      validCount += 1;
    }
  }
  return result;
}

function saveCouponOverrides(overrides = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return false;
  const ids = Object.keys(overrides);
  if (ids.length > MAX_STORED_COUPONS) return false;
  const sanitized = {};
  for (let index = 0; index < ids.length; index += 1) {
    const rawId = ids[index];
    const id = normalizeExactId(rawId);
    if (!id || id !== rawId) return false;
    const patch = sanitizeOverridePatch(overrides[rawId]);
    if (!patch) return false;
    if (Object.keys(patch).length) sanitized[id] = patch;
  }
  return privacyService.writeLocalData(COUPON_OVERRIDE_KEY, sanitized);
}

function snapshotCouponStorage() {
  return {
    userCoupons: readUserCoupons(),
    deletedIds: readDeletedCouponIds(),
    overrides: readCouponOverrides(),
  };
}

function restoreCouponStorage(snapshot = {}) {
  const couponsRestored = Array.isArray(snapshot.userCoupons)
    ? saveUserCoupons(snapshot.userCoupons)
    : privacyService.removeLocalData(COUPON_KEY);
  const deletedRestored = saveDeletedCouponIds(snapshot.deletedIds || []);
  const overridesRestored = saveCouponOverrides(snapshot.overrides || {});
  return Boolean(couponsRestored && deletedRestored && overridesRestored);
}

function readUserCoupons() {
  const stored = readStorage(COUPON_KEY, null);
  if (Array.isArray(stored)) return stored.slice(0, MAX_STORED_COUPONS);
  return null;
}

function saveUserCoupons(coupons = []) {
  if (!Array.isArray(coupons) || coupons.length > MAX_STORED_COUPONS) return false;
  return privacyService.writeLocalData(COUPON_KEY, coupons);
}

function mergeCouponOverride(coupon, overrides = {}) {
  if (!coupon || typeof coupon !== "object" || Array.isArray(coupon)) return null;
  const id = coupon.id;
  const hasOverride = id !== undefined
    && Object.prototype.hasOwnProperty.call(overrides, id)
    && overrides[id]
    && typeof overrides[id] === "object"
    && !Array.isArray(overrides[id]);
  return hasOverride ? Object.assign({}, coupon, overrides[id]) : coupon;
}

function getCachedCoupons(includeDeleted = false) {
  const userCoupons = readUserCoupons();
  const deletedIds = new Set(readDeletedCouponIds());
  const overrides = readCouponOverrides();

  // Package samples and durable user coupons are two layers, not mutually
  // exclusive sources. User records take precedence on an id collision while
  // untouched samples remain visible after a backup import or first real
  // coupon save. Explicit sample deletions are still enforced by tombstones.
  const sourceCoupons = (Array.isArray(userCoupons) ? userCoupons : [])
    .concat(mock.coupons || []);
  const mergedCoupons = sourceCoupons
    .map((coupon) => mergeCouponOverride(coupon, overrides))
    .filter(Boolean);

  const seenIds = new Set();
  return mergedCoupons.reduce((result, rawCoupon) => {
    if (result.length >= MAX_STORED_COUPONS) return result;
    const coupon = normalizeCoupon(rawCoupon);
    if (!coupon || seenIds.has(coupon.id)
      || (!includeDeleted && deletedIds.has(coupon.id))) return result;
    seenIds.add(coupon.id);
    result.push(coupon);
    return result;
  }, []);
}

function saveCouponRecord(coupon) {
  const sourceId = normalizeExactId(coupon && coupon.id);
  if (!sourceId || sourceId !== coupon.id) return null;
  const normalized = normalizeCoupon(coupon);
  if (!normalized || normalized.id !== sourceId) return null;

  const snapshot = snapshotCouponStorage();
  // Persist only the user layer. Saving one custom coupon must not copy every
  // bundled sample into LocalStorage.
  const current = (Array.isArray(snapshot.userCoupons) ? snapshot.userCoupons : [])
    .map(normalizeCoupon)
    .filter(Boolean);
  const originalDeletedIds = readDeletedCouponIds();
  const index = current.findIndex((c) => c.id === normalized.id);

  if (index > -1) {
    current[index] = normalized;
  } else {
    current.unshift(normalized);
  }

  if (!saveUserCoupons(current)) {
    if (!restoreCouponStorage(snapshot)) console.warn("coupon save rollback failed", normalized.id);
    return null;
  }

  // Ordinary saves do not touch the tombstone key. Besides avoiding an
  // unnecessary storage write, this keeps the common path atomic by itself.
  if (originalDeletedIds.includes(normalized.id)) {
    const deletedIds = originalDeletedIds.filter((id) => id !== normalized.id);
    if (!saveDeletedCouponIds(deletedIds)) {
      // Recreating a deleted coupon is a two-key transaction. Restore the
      // exact previous record-list state (including an absent user list) when
      // clearing its tombstone fails.
      if (!restoreCouponStorage(snapshot)) {
        console.warn("coupon save rollback failed", normalized.id);
      }
      return null;
    }
  }

  return normalized;
}

function saveCouponRecordWithOverride(coupon, patch = null) {
  const sanitizedPatch = patch === null ? null : sanitizeOverridePatch(patch);
  if (patch !== null && !sanitizedPatch) return null;
  const snapshot = snapshotCouponStorage();
  const saved = saveCouponRecord(coupon);
  if (!saved) {
    // saveCouponRecord already attempts its own rollback. Retry the full
    // snapshot here because this public operation spans all three keys.
    if (!restoreCouponStorage(snapshot)) {
      console.warn("coupon transaction rollback failed before override", coupon && coupon.id);
    }
    return null;
  }

  const overrides = readCouponOverrides();
  if (patch === null) {
    delete overrides[saved.id];
  } else {
    overrides[saved.id] = Object.assign({}, overrides[saved.id] || {}, sanitizedPatch);
  }
  if (saveCouponOverrides(overrides)) return saved;

  if (!restoreCouponStorage(snapshot)) {
    console.warn("coupon transaction rollback failed", saved.id);
  }
  return null;
}

function saveCouponRecordsWithOverrides(coupons, patchesById = {}) {
  if (!Array.isArray(coupons) || coupons.length > MAX_STORED_COUPONS
    || !patchesById || typeof patchesById !== "object" || Array.isArray(patchesById)) {
    return false;
  }
  const patchIds = Object.keys(patchesById);
  if (patchIds.length > MAX_STORED_COUPONS) return false;
  const sanitizedPatchesById = Object.create(null);
  const couponIds = new Set();
  const normalizedCoupons = [];
  for (let index = 0; index < coupons.length; index += 1) {
    const coupon = coupons[index];
    const id = normalizeExactId(coupon && coupon.id);
    const normalized = normalizeCoupon(coupon);
    if (!id || !normalized || normalized.id !== id || couponIds.has(id)) return false;
    couponIds.add(id);
    normalizedCoupons.push(normalized);
  }
  for (let index = 0; index < patchIds.length; index += 1) {
    const rawId = patchIds[index];
    const id = normalizeExactId(rawId);
    const patch = patchesById[rawId];
    if (!id || id !== rawId || !couponIds.has(id)
      || (patch !== null && (!patch || typeof patch !== "object" || Array.isArray(patch)))) return false;
    if (patch === null) sanitizedPatchesById[rawId] = null;
    else {
      const sanitizedPatch = sanitizeOverridePatch(patch);
      if (!sanitizedPatch) return false;
      sanitizedPatchesById[rawId] = sanitizedPatch;
    }
  }
  const snapshot = snapshotCouponStorage();
  const patchedIds = new Set(patchIds);
  const patchedCoupons = normalizedCoupons.filter((coupon) => patchedIds.has(coupon.id));
  const durableCoupons = (Array.isArray(snapshot.userCoupons) ? snapshot.userCoupons : [])
    .map(normalizeCoupon)
    .filter(Boolean)
    .filter((coupon) => !patchedIds.has(coupon.id));
  const nextUserCoupons = patchedCoupons.concat(durableCoupons);
  if (nextUserCoupons.length > MAX_STORED_COUPONS || !saveUserCoupons(nextUserCoupons)) {
    if (!restoreCouponStorage(snapshot)) console.warn("coupon batch update rollback failed");
    return false;
  }

  const overrides = readCouponOverrides();
  patchIds.forEach((rawId) => {
    const patch = sanitizedPatchesById[rawId];
    if (patch === null) delete overrides[rawId];
    else overrides[rawId] = Object.assign({}, overrides[rawId] || {}, patch);
  });
  if (saveCouponOverrides(overrides)) return true;
  if (!restoreCouponStorage(snapshot)) console.warn("coupon batch update rollback failed");
  return false;
}

function importCouponRecords(coupons = []) {
  if (!Array.isArray(coupons) || coupons.length > MAX_STORED_COUPONS) return false;
  if (!coupons.length) return true;

  const importedIds = new Set();
  const normalizedImports = [];
  for (let index = 0; index < coupons.length; index += 1) {
    const source = coupons[index];
    if (!source || typeof source !== "object" || Array.isArray(source)
      || typeof source.id !== "string") return false;
    const id = source.id.trim();
    const title = typeof source.title === "string" ? source.title.trim() : "";
    if (!id || id !== source.id || Array.from(id).length > 96 || importedIds.has(id)
      || ["__proto__", "constructor", "prototype"].includes(id)
      || !title
      || [source.venue, source.merchantName].some((value) => (
        value !== undefined && value !== null && typeof value !== "string"
      ))) return false;
    const normalized = normalizeCoupon(source);
    if (!normalized || normalized.id !== id) return false;
    importedIds.add(id);
    normalizedImports.push(normalized);
  }

  const snapshot = snapshotCouponStorage();
  // Only durable user records participate in an import merge. getCachedCoupons
  // deliberately falls back to bundled samples and must not be used here.
  const storedCoupons = Array.isArray(snapshot.userCoupons) ? snapshot.userCoupons : [];
  const preservedCoupons = storedCoupons.filter((coupon) => {
    const existingId = normalizeExactId(coupon && coupon.id);
    return !existingId || existingId !== coupon.id || !importedIds.has(existingId);
  });
  const mergedCoupons = normalizedImports.concat(preservedCoupons);
  if (mergedCoupons.length > MAX_STORED_COUPONS) return false;

  const deletedIds = (snapshot.deletedIds || []).filter((id) => !importedIds.has(id));
  const overrides = Object.assign({}, snapshot.overrides || {});
  let overridesChanged = false;
  importedIds.forEach((id) => {
    if (!Object.prototype.hasOwnProperty.call(overrides, id)) return;
    delete overrides[id];
    overridesChanged = true;
  });
  const deletedChanged = deletedIds.length !== (snapshot.deletedIds || []).length;

  if (!saveUserCoupons(mergedCoupons)) {
    if (!restoreCouponStorage(snapshot)) console.warn("coupon snapshot import rollback failed");
    return false;
  }
  if ((deletedChanged && !saveDeletedCouponIds(deletedIds))
    || (overridesChanged && !saveCouponOverrides(overrides))) {
    if (!restoreCouponStorage(snapshot)) console.warn("coupon snapshot import rollback failed");
    return false;
  }
  return true;
}

function deleteCouponRecords(ids = []) {
  if (!Array.isArray(ids) || ids.length > MAX_STORED_COUPONS) return false;
  const normalizedIds = [];
  const seenIds = new Set();
  for (let index = 0; index < ids.length; index += 1) {
    const id = normalizeExactId(ids[index]);
    if (!id || id !== ids[index] || seenIds.has(id)) return false;
    seenIds.add(id);
    normalizedIds.push(id);
  }
  if (!normalizedIds.length) return false;
  const targetIds = new Set(normalizedIds);
  const current = getCachedCoupons(true);
  const currentIds = new Set(current.map((coupon) => coupon.id));
  if (normalizedIds.some((id) => !currentIds.has(id))) return false;

  const snapshot = snapshotCouponStorage();
  const deletedIds = Array.isArray(snapshot.deletedIds) ? snapshot.deletedIds.slice() : [];
  const deletedIdSet = new Set(deletedIds);
  normalizedIds.forEach((id) => {
    if (!deletedIdSet.has(id)) {
      deletedIdSet.add(id);
      deletedIds.push(id);
    }
  });
  if (deletedIds.length > MAX_STORED_COUPONS) return false;
  if (!saveDeletedCouponIds(deletedIds)) {
    if (!restoreCouponStorage(snapshot)) console.warn("coupon batch delete rollback failed");
    return false;
  }
  const durableCoupons = (Array.isArray(snapshot.userCoupons) ? snapshot.userCoupons : [])
    .filter((coupon) => !targetIds.has(normalizeExactId(coupon && coupon.id)));
  if (!saveUserCoupons(durableCoupons)) {
    if (!restoreCouponStorage(snapshot)) console.warn("coupon batch delete rollback failed");
    return false;
  }

  const overrides = Object.assign({}, snapshot.overrides || {});
  let overridesChanged = false;
  normalizedIds.forEach((id) => {
    if (!Object.prototype.hasOwnProperty.call(overrides, id)) return;
    delete overrides[id];
    overridesChanged = true;
  });
  if (!overridesChanged || saveCouponOverrides(overrides)) return true;
  if (!restoreCouponStorage(snapshot)) console.warn("coupon batch delete rollback failed");
  return false;
}

function deleteCouponRecord(id) {
  const normalizedId = normalizeExactId(id);
  return normalizedId && normalizedId === id ? deleteCouponRecords([normalizedId]) : false;
}

function saveOverride(id, patch = {}) {
  const normalizedId = normalizeExactId(id);
  const sanitizedPatch = sanitizeOverridePatch(patch);
  if (!normalizedId || normalizedId !== id || !sanitizedPatch) return false;
  const overrides = readCouponOverrides();
  overrides[normalizedId] = Object.assign({}, overrides[normalizedId] || {}, sanitizedPatch);
  return saveCouponOverrides(overrides);
}

function clearOverride(id) {
  const normalizedId = normalizeExactId(id);
  if (!normalizedId || normalizedId !== id) return false;
  const overrides = readCouponOverrides();
  if (!Object.prototype.hasOwnProperty.call(overrides, normalizedId)) return true;
  delete overrides[normalizedId];
  return saveCouponOverrides(overrides);
}

function resetSampleCoupons() {
  const snapshot = snapshotCouponStorage();
  const coupons = (mock.coupons || []).map(normalizeCoupon).filter(Boolean);
  // Reset removes user overlays and lets the immutable package layer provide
  // the samples again; it does not duplicate package data into LocalStorage.
  if (!privacyService.removeLocalData(COUPON_KEY)) {
    if (!restoreCouponStorage(snapshot)) console.warn("coupon sample reset rollback failed");
    return null;
  }
  if (!saveDeletedCouponIds([]) || !saveCouponOverrides({})) {
    if (!restoreCouponStorage(snapshot)) console.warn("coupon sample reset rollback failed");
    return null;
  }
  return coupons;
}

module.exports = {
  getCachedCoupons,
  saveCouponRecord,
  saveCouponRecordWithOverride,
  saveCouponRecordsWithOverrides,
  importCouponRecords,
  deleteCouponRecords,
  deleteCouponRecord,
  clearOverride,
  saveOverride,
  readDeletedCouponIds,
  resetSampleCoupons,
  snapshotCouponStorage,
  restoreCouponStorage,
};
