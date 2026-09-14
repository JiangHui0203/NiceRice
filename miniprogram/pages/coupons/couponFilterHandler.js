const store = require("../../utils/couponStore.js");
const { normalizeExactId } = require("../../utils/idUtils.js");

const CATEGORY_TYPE_MAP = {
  food: ["火锅", "烧烤", "烤肉", "粉面"],
  drink: ["咖啡甜品"],
  play: ["电影", "展览", "博物馆", "清吧", "Livehouse", "桌游", "密室", "剧本杀", "轰趴"],
  outdoor: ["露营", "徒步", "公园", "户外"],
  life: ["按摩SPA", "推拿理疗", "洗浴汗蒸", "采耳头疗", "健身私教", "瑜伽普拉提", "洗车养护", "宠物洗护", "家政保洁"],
};

const STATUS_FILTER_RULES = {
  pending: (item) => item.statusCode === "pending" || item.statusCode === "unplanned" || item.statusCode === "recommended",
  // 兼容旧页面与旧分享入口使用的 todo 筛选值。
  todo: (item) => item.statusCode === "pending" || item.statusCode === "unplanned" || item.statusCode === "recommended",
  planned: (item) => item.statusCode === "planned",
  used: (item) => item.statusCode === "used",
  expired: (item) => item.statusCode === "expired" || item.stateClass === "expired" || (typeof item.days === "number" && item.days < 0),
  draft: (item) => item.statusCode === "draft",
  urgent: (item) => item.stateClass === "urgent",
};

function isSafeCouponSelectionId(value) {
  return Boolean(normalizeExactId(value));
}

function isCouponSelected(selectedMap, id) {
  return isSafeCouponSelectionId(id)
    && Boolean(selectedMap)
    && Object.prototype.hasOwnProperty.call(selectedMap, id)
    && selectedMap[id] === true;
}

function matchesCategory(item, activeCategory) {
  if (activeCategory === "all") return true;
  if (item.category === activeCategory) return true;
  const allowedTypes = CATEGORY_TYPE_MAP[activeCategory] || [];
  return allowedTypes.includes(item.type);
}

function matchesStatus(item, activeStatus) {
  // “全部”表示仍可处理的券；已使用券进入独立历史状态，避免混入待用列表。
  if (activeStatus === "all") return item.statusCode !== "used";
  const rule = STATUS_FILTER_RULES[activeStatus];
  return rule ? rule(item) : true;
}

function matchesSearchQuery(item, query) {
  if (!query) return true;
  const fields = [item.title, item.venue, item.type, item.address, item.dishes, item.note];
  return fields.some((f) => String(f || "").toLowerCase().includes(query));
}

// 1. Filtering & Sorting
function filterCoupons(coupons = [], { activeCategory, activeStatus, activePlatform, searchQuery }) {
  const query = (searchQuery || "").trim().toLowerCase();
  return coupons.filter((item) => {
    if (!matchesCategory(item, activeCategory)) return false;
    if (!matchesStatus(item, activeStatus)) return false;
    if (activePlatform !== "all" && (item.platform || "其他") !== activePlatform) return false;
    if (!matchesSearchQuery(item, query)) return false;
    return true;
  });
}

function compareExpireDates(a, b, ascending = true) {
  const timestampA = store.getExactDateTimestamp(a && a.expireDate);
  const timestampB = store.getExactDateTimestamp(b && b.expireDate);
  const missingA = timestampA === null || !Number.isFinite(timestampA);
  const missingB = timestampB === null || !Number.isFinite(timestampB);
  if (missingA !== missingB) return missingA ? 1 : -1;
  if (missingA) return 0;
  return ascending ? timestampA - timestampB : timestampB - timestampA;
}

function sortCoupons(list = [], { activeSort, priceAsc }) {
  const isExpired = (item) => item.statusCode === "expired" || item.stateClass === "expired";

  const compareItems = (a, b) => {
    // 1. Expired coupons always sink to the bottom of the list
    const expA = isExpired(a);
    const expB = isExpired(b);
    if (expA !== expB) return expA ? 1 : -1;

    // 2. If both items are expired, sort by expiration date descending (most recently expired first)
    if (expA && expB) {
      return compareExpireDates(a, b, false);
    }

    // 3. For active items, sort by user-selected criteria
    if (activeSort === "expire") {
      return compareExpireDates(a, b, true);
    } else if (activeSort === "distance") {
      const getDist = (item) => {
        const match = String(item.travelTime || "").match(/(\d+)/);
        return match ? parseInt(match[1], 10) : 999;
      };
      return getDist(a) - getDist(b);
    } else if (activeSort === "price") {
      const rawPriceA = parseFloat(a.price);
      const rawPriceB = parseFloat(b.price);
      const missingA = !Number.isFinite(rawPriceA);
      const missingB = !Number.isFinite(rawPriceB);
      if (missingA !== missingB) return missingA ? 1 : -1;
      if (missingA) return 0;
      const pa = rawPriceA;
      const pb = rawPriceB;
      return priceAsc ? pa - pb : pb - pa;
    } else if (activeSort === "discount") {
      const getRate = (item) => {
        const p = parseFloat(item.price);
        const op = parseFloat(item.originalPrice);
        if (p > 0 && op > p) return p / op;
        return 1.0;
      };
      return getRate(a) - getRate(b);
    }
    return (Number(b.recommendationScore) || 0) - (Number(a.recommendationScore) || 0);
  };

  return list.slice().sort(compareItems);
}

function buildFilterSummary({ activeCategory, activeStatus, activePlatform, categories, statuses, platforms }) {
  const parts = [];
  if (activeCategory !== "all") {
    const c = (categories || []).find((item) => item.value === activeCategory);
    if (c) parts.push(c.label);
  }
  if (activeStatus !== "all") {
    const s = (statuses || []).find((item) => item.value === activeStatus);
    if (s) parts.push(s.label);
  }
  if (activePlatform !== "all") {
    const p = (platforms || []).find((item) => item.value === activePlatform);
    if (p) parts.push(p.label);
  }
  return parts.length ? parts.join(" · ") : "全 部";
}

// 2. Batch Operations
function executeBatchMarkUsed(selectedBatchMap, selectedBatchCount, metadata = {}) {
  if (!selectedBatchCount) {
    return { success: false, error: "请先勾选优惠券" };
  }
  const selectedIds = Object.keys(selectedBatchMap || {})
    .filter((id) => isCouponSelected(selectedBatchMap, id));
  let batchResult = { successIds: [], failedIds: selectedIds };
  try {
    batchResult = store.updateCouponStatuses(selectedIds, "used", metadata);
  } catch (error) {}
  const successIds = batchResult.successIds || [];
  const failedIds = batchResult.failedIds || [];
  return {
    success: successIds.length > 0 && failedIds.length === 0,
    partial: successIds.length > 0 && failedIds.length > 0,
    successIds,
    failedIds,
    requestedCount: selectedIds.length,
    error: successIds.length ? "" : "标记失败，请重试",
  };
}

function executeBatchDelete(selectedBatchMap, selectedBatchCount) {
  if (!selectedBatchCount) {
    return { success: false, error: "请先勾选优惠券" };
  }
  const selectedIds = Object.keys(selectedBatchMap || {})
    .filter((id) => isCouponSelected(selectedBatchMap, id));
  let batchResult = { successIds: [], failedIds: selectedIds, deletedCoupons: [] };
  try {
    batchResult = store.deleteCoupons(selectedIds);
  } catch (error) {}
  const successIds = batchResult.successIds || [];
  const failedIds = batchResult.failedIds || [];
  const deletedCoupons = batchResult.deletedCoupons || [];
  return {
    success: successIds.length > 0 && failedIds.length === 0,
    partial: successIds.length > 0 && failedIds.length > 0,
    successIds,
    failedIds,
    deletedCoupons,
    requestedCount: selectedIds.length,
    error: successIds.length ? "" : "删除失败，请重试",
  };
}

function toggleSelectBatchItem(selectedBatchMap = {}, currentCount = 0, id) {
  if (!isSafeCouponSelectionId(id)) {
    const unchangedMap = Object.assign({}, selectedBatchMap);
    return {
      selectedBatchMap: unchangedMap,
      selectedBatchCount: Object.keys(unchangedMap).filter((key) => isCouponSelected(unchangedMap, key)).length,
    };
  }
  const map = Object.assign({}, selectedBatchMap);
  if (isCouponSelected(map, id)) {
    delete map[id];
  } else {
    map[id] = true;
  }
  return {
    selectedBatchMap: map,
    selectedBatchCount: Object.keys(map).filter((key) => isCouponSelected(map, key)).length,
  };
}

function selectAllBatchItems(coupons = [], shouldSelectAll = true) {
  const map = {};
  if (shouldSelectAll) {
    (coupons || []).forEach((coupon) => {
      const id = coupon && coupon.id;
      if (isSafeCouponSelectionId(id)) map[id] = true;
    });
    return { selectedBatchMap: map, selectedBatchCount: Object.keys(map).length };
  }
  return { selectedBatchMap: map, selectedBatchCount: 0 };
}

// 3. Comparison Drawer
function toggleSelectCompareItem(selectedCompareMap = {}, currentCount = 0, id, max = 3) {
  const map = Object.assign({}, selectedCompareMap);
  let count = Object.keys(map).filter((key) => isCouponSelected(map, key)).length;
  if (!isSafeCouponSelectionId(id)) {
    return { success: false, error: "优惠券标识无效", selectedCompareMap: map, selectedCompareCount: count };
  }
  if (isCouponSelected(map, id)) {
    delete map[id];
    count--;
    return { success: true, selectedCompareMap: map, selectedCompareCount: count };
  }
  if (count >= max) {
    return { success: false, error: `最多对比${max}张券` };
  }
  map[id] = true;
  count++;
  return { success: true, selectedCompareMap: map, selectedCompareCount: count };
}

function buildCompareItemsList(coupons = [], selectedCompareMap = {}, selectedCompareCount = 0) {
  if (selectedCompareCount < 2) {
    return { success: false, error: "请选择至少2张券" };
  }
  const compareItems = (coupons || []).filter((item) => item && isCouponSelected(selectedCompareMap, item.id));
  if (compareItems.length < 2) {
    return { success: false, error: "所选优惠券已变化，请重新选择" };
  }
  return { success: true, compareItems };
}

function formatDishesSummary(dishesStr) {
  if (!dishesStr || typeof dishesStr !== "string") return "";
  const text = dishesStr.trim();
  if (!text) return "";
  const items = text.split(/[\n、,，;；+]+/).map(s => s.trim()).filter(Boolean);
  if (!items.length) return "";
  const firstFew = items.slice(0, 3).map(item => item.replace(/\s*\d+.*$/, "")).join("、");
  return `${items.length}项明细: ${firstFew}${items.length > 3 ? '等' : ''}`;
}

module.exports = {
  filterCoupons,
  sortCoupons,
  buildFilterSummary,
  executeBatchMarkUsed,
  executeBatchDelete,
  toggleSelectBatchItem,
  selectAllBatchItems,
  toggleSelectCompareItem,
  buildCompareItemsList,
  formatDishesSummary,
  isCouponSelected,
  isSafeCouponSelectionId,
};
