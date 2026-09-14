/**
 * couponStore.js
 * 优惠券数据管理层（Facade 门面）
 * 串联 couponNormalizer (清洗与规则计算) 与 couponRepository (存储与缓存)，整合生命周期活动日志
 */

const normalizer = require("./coupon/couponNormalizer.js");
const repository = require("./coupon/couponRepository.js");
const { hasCoordinates } = require("./locationUtils.js");

const STATUS_LABELS = {
  draft: "草稿",
  pending: "待安排",
  planned: "已安排",
  used: "已使用",
  expired: "已过期",
};

const STATUS_ALIAS_MAP = {
  草稿: "draft",
  待安排: "pending",
  未安排: "pending",
  已推荐: "pending",
  待确认: "pending",
  已安排: "planned",
  已使用: "used",
  已过期: "expired",
  draft: "draft",
  pending: "pending",
  unplanned: "pending",
  recommended: "pending",
  planned: "planned",
  used: "used",
  expired: "expired",
};

const VALID_COUPON_TRANSITIONS = {
  draft: ["pending", "expired"],
  pending: ["planned", "used", "expired", "draft"],
  planned: ["used", "pending", "expired"],
  used: ["pending"],
  expired: ["pending"],
};

const INVALID_COUPON_TITLES = ["品质套餐", "标题待补充", "自定义计划", "生活活动"];
const INVALID_COUPON_VENUES = [
  "精选餐厅", "待补充店名", "店铺待补充", "商家待补充", "地点待补充", "地点待定", "待定",
];

function resolveCouponStatus(value) {
  if (typeof value !== "string") return "";
  const status = value.trim();
  return status === value && Object.prototype.hasOwnProperty.call(STATUS_ALIAS_MAP, status)
    ? STATUS_ALIAS_MAP[status]
    : "";
}

function buildCouponActivityEntry(action, coupon) {
  if (!coupon || !coupon.id) return null;
  const loc = coupon.location || {};
  return {
      entityType: "coupon",
      entityId: coupon.id,
      action,
      title: coupon.title,
      category: coupon.type || coupon.category || "类型待补充",
      platform: coupon.platform || "平台待补充",
      finance: {
        originalPrice: Number(coupon.originalPrice) || 0,
        actualPaid: Number(coupon.price) || 0,
        savedAmount: Math.max(0, (Number(coupon.originalPrice) || 0) - (Number(coupon.price) || 0)),
      },
      executionSnapshot: {
        venue: coupon.venue || loc.name || "",
        address: coupon.address || loc.address || "",
        latitude: coupon.latitude !== undefined ? coupon.latitude : loc.latitude,
        longitude: coupon.longitude !== undefined ? coupon.longitude : loc.longitude,
        dishes: coupon.dishes || "",
        people: coupon.people || "人数待补充",
        type: coupon.type || coupon.category || "类型待补充",
        platform: coupon.platform || "平台待补充",
        scheduledDate: coupon.usedAt || "",
        scheduledTime: "已核销",
        participants: ["我"],
        // ActivityLogStore persists only the identity needed for history
        // de-duplication; avoid cloning a full coupon for every batch entry.
        couponSnapshot: { id: coupon.id },
      },
    };
}

function logCouponActivity(action, coupon) {
  const entry = buildCouponActivityEntry(action, coupon);
  if (!entry) return;
  try {
    const activityLogStore = require("./activityLogStore.js");
    activityLogStore.recordActivityLog(entry);
  } catch (e) {
    // ignore
  }
}

function validateCouponTransition(fromStatus, toStatus) {
  const normalizedFrom = resolveCouponStatus(fromStatus);
  const normalizedTo = resolveCouponStatus(toStatus);
  if (!normalizedFrom || !normalizedTo) return false;
  if (normalizedFrom === normalizedTo) return true;
  const allowed = VALID_COUPON_TRANSITIONS[normalizedFrom] || [];
  return allowed.includes(normalizedTo);
}

function getAllCoupons() {
  // Tombstones are an internal persistence detail. Public reads must never
  // revive a coupon merely because a caller wants all lifecycle statuses.
  return repository.getCachedCoupons(false);
}

function findCoupon(id) {
  const exactId = normalizeStoreId(id);
  if (!exactId) return null;
  const list = repository.getCachedCoupons(false);
  return list.find((item) => item.id === exactId) || null;
}

function getCouponById(id) {
  return findCoupon(id);
}

function saveCoupon(form = {}) {
  const rawTitle = String(form.title || "").trim();
  const title = INVALID_COUPON_TITLES.includes(rawTitle) ? "" : rawTitle;
  const venue = [form.venue, form.merchantName]
    .map((value) => String(value || "").trim())
    .find((value) => value && !INVALID_COUPON_VENUES.includes(value)) || "";
  if (!title || !venue) {
    console.warn("coupon save rejected missing required title or venue");
    return null;
  }
  const expireDate = String(form.expireDate || "").trim();
  const usableTime = String(form.usableTime || "").trim();
  if ((expireDate && !normalizer.normalizeDateText(expireDate))
    || (usableTime && !normalizer.validateUsableTimeText(usableTime))) {
    console.warn("coupon save rejected invalid date or usable time");
    return null;
  }
  const isNew = !form.id;
  const coupon = normalizer.buildCoupon(Object.assign({}, form, {
    title,
    venue,
    merchantName: venue,
    type: String(form.type || "").trim() || "类型待补充",
    platform: String(form.platform || "").trim() || "平台待补充",
    people: String(form.people || "").trim() || "人数待补充",
    expireDate: normalizer.normalizeDateText(expireDate),
    usableTime: usableTime || "时段待补充",
  }));
  // The edit form is an authoritative full-record save. Clear any legacy
  // override for this coupon in the same transaction, otherwise an old
  // expiry/status override can silently shadow the value the user just saved.
  const saved = repository.saveCouponRecordWithOverride(coupon, null);
  if (saved && isNew) {
    logCouponActivity("created", saved);
  }
  return saved;
}

function deleteCoupon(id) {
  return repository.deleteCouponRecord(id);
}

function getLocalDateTime(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function resolveUsedAt(metadata = {}, coupon = {}) {
  const explicitUsedAt = String(metadata.usedAt || "").trim();
  const explicitUseDate = String(metadata.useDate || "").trim();
  const explicitCandidate = explicitUsedAt
    || (explicitUseDate ? `${explicitUseDate}${metadata.useTime ? ` ${String(metadata.useTime).trim()}` : ""}` : "");
  if (explicitCandidate) return normalizer.formatUsedAt(explicitCandidate);
  return normalizer.formatUsedAt(coupon.usedAt) || getLocalDateTime();
}

function buildCouponStatusMutation(coupon, newStatus, metadata = {}) {
  if (!coupon) return null;
  const targetStatus = resolveCouponStatus(newStatus);
  if (!targetStatus) return null;
  if (!validateCouponTransition(coupon.statusCode, targetStatus)) return null;
  const statusPatch = {
    statusCode: targetStatus,
    status: STATUS_LABELS[targetStatus] || targetStatus,
  };
  if (targetStatus === "used") {
    const usedAt = resolveUsedAt(metadata, coupon);
    if (!usedAt) return null;
    statusPatch.usedAt = usedAt;
    const usageNote = metadata.usageNote || metadata.useNote;
    if (usageNote !== undefined) statusPatch.usageNote = String(usageNote || "").trim();
  } else if (coupon.statusCode === "used") {
    statusPatch.usedAt = "";
    statusPatch.usageNote = "";
  }
  const updated = normalizer.normalizeCoupon(Object.assign({}, coupon, statusPatch));
  return updated ? { targetStatus, statusPatch, updated } : null;
}

function updateCouponStatus(id, newStatus, metadata = {}) {
  const coupon = findCoupon(id);
  if (!coupon) return null;

  const mutation = buildCouponStatusMutation(coupon, newStatus, metadata);
  if (!mutation) {
    console.warn(`Invalid coupon transition: ${coupon.statusCode} -> ${String(newStatus || "")}`);
    return null;
  }

  const { targetStatus, statusPatch, updated } = mutation;
  if (!repository.saveCouponRecordWithOverride(updated, statusPatch)) return null;

  if (metadata.skipActivityLog !== true) {
    if (targetStatus === "used") logCouponActivity("completed", updated);
    else if (targetStatus === "expired") logCouponActivity("expired", updated);
  }

  return updated;
}

function normalizeStoreId(value) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  if (!id || id !== value || Array.from(id).length > 96
    || ["__proto__", "constructor", "prototype"].includes(id)) return "";
  return id;
}

function normalizeBatchIds(ids = []) {
  if (!Array.isArray(ids) || ids.length > 500) return [];
  const seen = new Set();
  return ids.reduce((result, rawId) => {
    const id = normalizeStoreId(rawId);
    if (!id || seen.has(id)) return result;
    seen.add(id);
    result.push(id);
    return result;
  }, []);
}

function updateCouponStatuses(ids = [], newStatus, metadata = {}) {
  const selectedIds = normalizeBatchIds(ids);
  if (!selectedIds.length || selectedIds.length !== ids.length) {
    return { successIds: [], failedIds: Array.isArray(ids) ? ids.slice(0, 500) : [], updatedCoupons: [] };
  }
  const selectedSet = new Set(selectedIds);
  const patchesById = Object.create(null);
  const updatedCoupons = [];
  const failedIds = [];
  const failedIdSet = new Set();
  const current = getAllCoupons();
  const existingIds = new Set(current.map((coupon) => coupon.id));
  selectedIds.forEach((id) => {
    if (!existingIds.has(id)) {
      failedIds.push(id);
      failedIdSet.add(id);
    }
  });
  const next = current.map((coupon) => {
    if (!selectedSet.has(coupon.id)) return coupon;
    const mutation = buildCouponStatusMutation(coupon, newStatus, metadata);
    if (!mutation) {
      if (!failedIdSet.has(coupon.id)) {
        failedIds.push(coupon.id);
        failedIdSet.add(coupon.id);
      }
      return coupon;
    }
    patchesById[coupon.id] = mutation.statusPatch;
    updatedCoupons.push(mutation.updated);
    return mutation.updated;
  });
  if (!updatedCoupons.length) return { successIds: [], failedIds, updatedCoupons: [] };
  if (!repository.saveCouponRecordsWithOverrides(next, patchesById)) {
    return { successIds: [], failedIds: selectedIds, updatedCoupons: [] };
  }
  if (metadata.skipActivityLog !== true) {
    const targetStatus = resolveCouponStatus(newStatus);
    const action = targetStatus === "used" ? "completed" : (targetStatus === "expired" ? "expired" : "");
    if (action) {
      try {
        const activityLogStore = require("./activityLogStore.js");
        activityLogStore.recordActivityLogs(updatedCoupons.map((coupon) => buildCouponActivityEntry(action, coupon)));
      } catch (error) {}
    }
  }
  return {
    successIds: updatedCoupons.map((coupon) => coupon.id),
    failedIds,
    updatedCoupons,
  };
}

function deleteCoupons(ids = []) {
  const selectedIds = normalizeBatchIds(ids);
  if (!selectedIds.length || selectedIds.length !== ids.length) {
    return { successIds: [], failedIds: Array.isArray(ids) ? ids.slice(0, 500) : [], deletedCoupons: [] };
  }
  const couponMap = new Map(getAllCoupons().map((coupon) => [coupon.id, coupon]));
  const deletedCoupons = selectedIds.map((id) => couponMap.get(id)).filter(Boolean);
  const successIds = deletedCoupons.map((coupon) => coupon.id);
  const failedIds = selectedIds.filter((id) => !couponMap.has(id));
  if (!successIds.length) return { successIds: [], failedIds, deletedCoupons: [] };
  if (!repository.deleteCouponRecords(successIds)) {
    return { successIds: [], failedIds: selectedIds, deletedCoupons: [] };
  }
  return { successIds, failedIds, deletedCoupons };
}


function extendCouponExpiry(id, newExpireDate) {
  const coupon = findCoupon(id);
  if (!coupon) return null;
  const normalizedExpireDate = normalizer.normalizeDateText(newExpireDate);
  if (!normalizedExpireDate || normalizedExpireDate !== String(newExpireDate || "").trim()) return null;
  const daysRemaining = normalizer.daysBetween(normalizedExpireDate);
  if (daysRemaining === null || daysRemaining < 0) return null;

  const targetStatus = "pending";
  const updated = normalizer.normalizeCoupon(Object.assign({}, coupon, {
    expireDate: normalizedExpireDate,
    statusCode: targetStatus,
    status: STATUS_LABELS[targetStatus] || "待安排",
    stateClass: "ready",
  }));

  if (!repository.saveCouponRecordWithOverride(updated, {
    expireDate: normalizedExpireDate,
    statusCode: targetStatus,
    status: STATUS_LABELS[targetStatus] || "待安排",
    stateClass: "ready",
  })) return null;

  return updated;
}

function importCouponSnapshot(snapshot = {}) {
  if (!snapshot || !snapshot.id) return null;
  const title = String(snapshot.title || "").trim();
  if (!title || INVALID_COUPON_TITLES.includes(title)
    || [snapshot.venue, snapshot.merchantName].some((value) => (
      value !== undefined && value !== null && typeof value !== "string"
    ))) return null;
  const normalized = normalizer.normalizeCoupon(snapshot);
  if (!normalized) return null;
  return repository.saveCouponRecordWithOverride(normalized, null);
}

function importCouponSnapshots(snapshots = []) {
  const requestedIds = (Array.isArray(snapshots) ? snapshots : [])
    .slice(0, 500)
    .map((snapshot) => (snapshot && typeof snapshot.id === "string" ? snapshot.id : ""))
    .filter(Boolean);
  const failure = (error) => ({
    success: false,
    successIds: [],
    failedIds: requestedIds,
    importedCoupons: [],
    error,
  });
  if (!Array.isArray(snapshots) || snapshots.length > 500) {
    return failure("优惠券快照数量无效");
  }
  if (!snapshots.length) {
    return { success: true, successIds: [], failedIds: [], importedCoupons: [] };
  }

  const seenIds = new Set();
  const normalizedSnapshots = [];
  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
      || typeof snapshot.id !== "string") return failure("优惠券快照格式无效");
    const id = snapshot.id.trim();
    const title = typeof snapshot.title === "string" ? snapshot.title.trim() : "";
    const expireValues = [snapshot.expireDate, snapshot.expireAt]
      .filter((value) => value !== undefined && value !== null);
    const usableTime = typeof snapshot.usableTime === "string" ? snapshot.usableTime.trim() : "";
    const rawStatus = snapshot.statusCode !== undefined ? snapshot.statusCode : snapshot.status;
    if (!id || id !== snapshot.id || Array.from(id).length > 96 || seenIds.has(id)
      || ["__proto__", "constructor", "prototype"].includes(id)
      || !title || INVALID_COUPON_TITLES.includes(title)
      || [snapshot.venue, snapshot.merchantName].some((value) => (
        value !== undefined && value !== null && typeof value !== "string"
      ))
      || expireValues.some((value) => (
        typeof value !== "string"
          || (value.trim() && !normalizer.normalizeDateText(value.trim()))
      ))
      || (snapshot.usableTime !== undefined && snapshot.usableTime !== null
        && typeof snapshot.usableTime !== "string")
      || (rawStatus !== undefined && rawStatus !== null
        && (typeof rawStatus !== "string"
          || !Object.prototype.hasOwnProperty.call(STATUS_ALIAS_MAP, rawStatus.trim())))
      || (usableTime && !normalizer.validateUsableTimeText(usableTime))) {
      return failure("优惠券快照内容无效");
    }
    const normalized = normalizer.normalizeCoupon(snapshot);
    if (!normalized || normalized.id !== id) return failure("优惠券快照无法规范化");
    seenIds.add(id);
    normalizedSnapshots.push(normalized);
  }

  if (!repository.importCouponRecords(normalizedSnapshots)) {
    return failure("优惠券快照写入失败");
  }
  return {
    success: true,
    successIds: normalizedSnapshots.map((coupon) => coupon.id),
    failedIds: [],
    importedCoupons: normalizedSnapshots,
  };
}

function addCoupon(snapshot = {}) {
  return snapshot && snapshot.id ? importCouponSnapshot(snapshot) : saveCoupon(snapshot);
}

function resetSampleCoupons() {
  return repository.resetSampleCoupons();
}

function updateCouponRoute(id, route = {}) {
  const coupon = findCoupon(id);
  if (!coupon) return null;
  const updated = normalizer.normalizeCoupon(Object.assign({}, coupon, {
    route,
    travelTime: route.distanceText || coupon.travelTime,
  }));
  return repository.saveCouponRecord(updated);
}

function updateCouponLocation(id, location = {}) {
  const coupon = findCoupon(id);
  if (!coupon) return null;
  const latitude = location.latitude !== undefined ? location.latitude : location.lat;
  const longitude = location.longitude !== undefined ? location.longitude : location.lng;
  const hasLatitude = latitude !== undefined && latitude !== null && String(latitude).trim() !== "";
  const hasLongitude = longitude !== undefined && longitude !== null && String(longitude).trim() !== "";
  if (hasLatitude !== hasLongitude || (hasLatitude && !hasCoordinates(location))) return null;
  const updated = normalizer.normalizeCoupon(Object.assign({}, coupon, {
    location,
    address: location.address || coupon.address,
    venue: location.name || coupon.venue,
    latitude: location.latitude,
    longitude: location.longitude,
  }));
  return repository.saveCouponRecord(updated);
}

const COUPON_LINK_ROLLBACK_KIND = "coupon_plan_link_batch_v1";
const couponLinkRollbackSnapshots = new WeakMap();

function exactLinkId(value) {
  return normalizeStoreId(value);
}

function couponLinkFailure(code, details = {}) {
  return Object.assign({
    success: false,
    code,
    successIds: [],
    linkedCoupons: [],
    rollbackToken: null,
  }, details);
}

/**
 * Strict all-or-nothing coupon-to-plan linker. Every changed coupon and its
 * override patch is committed by one repository transaction.
 */
function linkPlans(links = []) {
  if (!Array.isArray(links) || !links.length || links.length > 500) {
    return couponLinkFailure("invalid_coupon_links");
  }

  const normalizedLinks = [];
  const couponIds = new Set();
  const planIds = new Set();
  for (let index = 0; index < links.length; index += 1) {
    const link = links[index];
    if (!link || typeof link !== "object" || Array.isArray(link)) {
      return couponLinkFailure("invalid_coupon_link", { failedIndex: index });
    }
    const couponId = exactLinkId(link.couponId);
    const planId = exactLinkId(link.planId);
    if (!couponId || !planId) {
      return couponLinkFailure("invalid_coupon_link", { failedIndex: index });
    }
    if (couponIds.has(couponId)) {
      return couponLinkFailure("duplicate_coupon_link", { couponId, failedIndex: index });
    }
    if (planIds.has(planId)) {
      return couponLinkFailure("duplicate_plan_link", { planId, failedIndex: index });
    }
    couponIds.add(couponId);
    planIds.add(planId);
    normalizedLinks.push({ couponId, planId });
  }

  const current = getAllCoupons();
  const couponById = new Map(current.map((coupon) => [coupon.id, coupon]));
  const linkByCouponId = new Map(normalizedLinks.map((link) => [link.couponId, link]));
  const previousCoupons = [];
  const linkedById = new Map();
  const patchesById = Object.create(null);

  for (let index = 0; index < normalizedLinks.length; index += 1) {
    const link = normalizedLinks[index];
    const coupon = couponById.get(link.couponId);
    if (!coupon) return couponLinkFailure("coupon_not_found", { couponId: link.couponId });
    if (!validateCouponTransition(coupon.statusCode, "planned")) {
      return couponLinkFailure("coupon_not_linkable", { couponId: link.couponId });
    }
    if (coupon.planId && coupon.planId !== link.planId) {
      return couponLinkFailure("coupon_link_conflict", {
        couponId: link.couponId,
        planId: coupon.planId,
      });
    }
    if (coupon.planId === link.planId && coupon.statusCode === "planned") {
      linkedById.set(coupon.id, coupon);
      continue;
    }
    const patch = { planId: link.planId, statusCode: "planned", status: "已安排" };
    const updated = normalizer.normalizeCoupon(Object.assign({}, coupon, patch));
    if (!updated || updated.id !== coupon.id || updated.planId !== link.planId
      || updated.statusCode !== "planned") {
      return couponLinkFailure("coupon_link_failed", { couponId: link.couponId });
    }
    previousCoupons.push(coupon);
    linkedById.set(coupon.id, updated);
    patchesById[coupon.id] = patch;
  }

  const linkedCoupons = normalizedLinks.map((link) => linkedById.get(link.couponId));
  if (!previousCoupons.length) {
    return {
      success: true,
      code: "ok",
      successIds: normalizedLinks.map((link) => link.couponId),
      linkedCoupons,
      previousCoupons: [],
      rollbackToken: null,
    };
  }

  const snapshot = repository.snapshotCouponStorage();
  const next = current.map((coupon) => {
    const link = linkByCouponId.get(coupon.id);
    return link ? linkedById.get(coupon.id) : coupon;
  });
  if (!repository.saveCouponRecordsWithOverrides(next, patchesById)) {
    const consistencyRestored = repository.restoreCouponStorage(snapshot);
    return couponLinkFailure(
      consistencyRestored ? "coupon_link_failed" : "coupon_rollback_failed",
      { consistencyRestored, couponId: normalizedLinks[0].couponId },
    );
  }

  const rollbackToken = {
    kind: COUPON_LINK_ROLLBACK_KIND,
  };
  couponLinkRollbackSnapshots.set(rollbackToken, snapshot);
  return {
    success: true,
    code: "ok",
    successIds: normalizedLinks.map((link) => link.couponId),
    linkedCoupons,
    previousCoupons,
    rollbackToken,
  };
}

function rollbackPlanLinks(token) {
  if (!token || token.kind !== COUPON_LINK_ROLLBACK_KIND
    || !couponLinkRollbackSnapshots.has(token)) return false;
  const snapshot = couponLinkRollbackSnapshots.get(token);
  const restored = repository.restoreCouponStorage(snapshot);
  if (restored) couponLinkRollbackSnapshots.delete(token);
  return restored;
}

function linkPlan(id, planId) {
  const result = linkPlans([{ couponId: id, planId }]);
  return result.success === true ? result.linkedCoupons[0] || null : null;
}

function unlinkPlan(id, planId) {
  if (!id) return null;
  const coupon = findCoupon(id);
  if (!coupon) return null;
  if (coupon.statusCode === "used" || coupon.statusCode === "expired") return coupon;
  if (!planId || coupon.planId === planId) {
    const patch = { planId: "", statusCode: "pending", status: "待安排" };
    const updated = normalizer.normalizeCoupon(Object.assign({}, coupon, patch));
    return repository.saveCouponRecordWithOverride(updated, patch);
  }
  return coupon;
}

function markUsed(id, usedAt = "", options = {}) {
  return updateCouponStatus(id, "used", Object.assign({}, options, { usedAt }));
}

module.exports = {
  STATUS_LABELS,
  STATUS_ALIAS_MAP,
  VALID_COUPON_TRANSITIONS,
  normalizeDateText: normalizer.normalizeDateText,
  getExactDateTimestamp: normalizer.getExactDateTimestamp,
  daysBetween: normalizer.daysBetween,
  expireText: normalizer.expireText,
  normalizeStatus: normalizer.normalizeStatus,
  validateUsableTimeText: normalizer.validateUsableTimeText,
  parseTimeRange: normalizer.parseTimeRange,
  getDefaultDuration: normalizer.getDefaultDuration,
  parseDayRules: normalizer.parseDayRules,
  normalizePeopleCount: normalizer.normalizePeopleCount,
  buildUsageRules: normalizer.buildUsageRules,
  buildRefundInfo: normalizer.buildRefundInfo,
  computeCouponLifeState: normalizer.computeCouponLifeState,
  computeCouponLifeProgress: normalizer.computeCouponLifeProgress,
  computeDiscountText: normalizer.computeDiscountText,
  buildCouponNotices: normalizer.buildCouponNotices,
  normalizeCoupon: normalizer.normalizeCoupon,
  buildCoupon: normalizer.buildCoupon,
  getAllCoupons,
  findCoupon,
  getCouponById,
  saveCoupon,
  addCoupon,
  deleteCoupon,
  deleteCoupons,
  updateCouponStatus,
  updateCouponStatuses,
  linkPlans,
  linkPlan,
  rollbackPlanLinks,
  unlinkPlan,
  markUsed,
  extendCouponExpiry,
  validateCouponTransition,
  importCouponSnapshot,
  importCouponSnapshots,
  resetSampleCoupons,
  updateCouponRoute,
  updateCouponLocation,
};
