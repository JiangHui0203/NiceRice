const haptics = require("../../../utils/haptics.js");
const {
  buildFilterSummary,
  filterCoupons,
  sortCoupons,
} = require("../couponFilterHandler.js");

const COUPON_RENDER_PAGE_SIZE = 40;

function getDatasetValue(event, key) {
  return event && event.currentTarget && event.currentTarget.dataset
    ? event.currentTarget.dataset[key]
    : "";
}

function hasOptionValue(options, value, extraValues = []) {
  return extraValues.includes(value) || (Array.isArray(options) ? options : [])
    .some((item) => item && item.value === value);
}

function showFilterToast(page, title) {
  if (page.hidden || page.unloaded) return;
  try {
    wx.showToast({ title, icon: "none" });
  } catch (error) {}
}

module.exports = {
  switchStatusTab(e) {
    haptics.light();
    const rawStatus = getDatasetValue(e, "status");
    const status = rawStatus === "todo" ? "pending" : rawStatus;
    if (!hasOptionValue(this.data.statuses, status, ["urgent", "draft"])) {
      showFilterToast(this, "优惠券状态筛选无效");
      return;
    }
    if (status === this.data.activeStatus) return;
    this.setData({ activeStatus: status }, () => this.applyFilters());
  },

  selectCategory(e) {
    haptics.light();
    const activeCategory = getDatasetValue(e, "value");
    if (!hasOptionValue(this.data.categories, activeCategory)) {
      showFilterToast(this, "优惠券分类筛选无效");
      return;
    }
    this.setData({ activeCategory }, () => this.applyFilters());
  },

  selectStatus(e) {
    haptics.light();
    const rawStatus = getDatasetValue(e, "value");
    const activeStatus = rawStatus === "todo" ? "pending" : rawStatus;
    if (!hasOptionValue(this.data.statuses, activeStatus, ["urgent", "draft"])) {
      showFilterToast(this, "优惠券状态筛选无效");
      return;
    }
    this.setData({ activeStatus }, () => this.applyFilters());
  },

  selectPlatform(e) {
    haptics.light();
    const activePlatform = getDatasetValue(e, "value");
    if (!hasOptionValue(this.data.platforms, activePlatform)) {
      showFilterToast(this, "优惠券平台筛选无效");
      return;
    }
    this.setData({ activePlatform }, () => this.applyFilters());
  },

  toggleFilters(e = {}) {
    haptics.light();
    if (e.type === "beforeleave") {
      if (this.data.showFilters) this.setData({ showFilters: false });
      return;
    }
    this.setData({ showFilters: !this.data.showFilters });
  },

  selectSort(e) {
    haptics.light();
    const selectedSort = getDatasetValue(e, "value");
    if (!hasOptionValue(this.data.sortOptions, selectedSort, ["discount"])) {
      showFilterToast(this, "优惠券排序方式无效");
      return;
    }
    if (selectedSort === "price" && this.data.activeSort === "price") {
      const priceAsc = !this.data.priceAsc;
      this.setData({ priceAsc, priceOrderText: priceAsc ? "低到高" : "高到低" }, () => this.applyFilters());
      return;
    }
    this.setData({ activeSort: selectedSort, priceAsc: true, priceOrderText: "低到高" }, () => this.applyFilters());
  },

  onSearchInput(e) {
    const searchQuery = Array.from(String((e && e.detail ? e.detail.value : "") || ""))
      .slice(0, 80)
      .join("");
    this.setData({ searchQuery });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      if (!this.hidden && !this.unloaded) this.applyFilters();
    }, 150);
  },

  clearSearch() {
    this.setData({ searchQuery: "" }, () => this.applyFilters());
  },

  resetFilters() {
    this.setData({
      activeCategory: "all",
      activeStatus: "all",
      activePlatform: "all",
      activeSort: "default",
      priceAsc: true,
      priceOrderText: "低到高",
      searchQuery: "",
    }, () => this.applyFilters());
  },

  applyFilters() {
    if (this.hidden || this.unloaded) return false;
    const {
      activeCategory,
      activeStatus,
      activePlatform,
      searchQuery,
      activeSort,
      priceAsc,
      categories,
      statuses,
      platforms,
    } = this.data;
    const coupons = Array.isArray(this.allCoupons) ? this.allCoupons : [];
    const matched = filterCoupons(coupons, { activeCategory, activeStatus, activePlatform, searchQuery });
    const sorted = sortCoupons(matched, { activeSort, priceAsc });
    const summary = buildFilterSummary({ activeCategory, activeStatus, activePlatform, categories, statuses, platforms });

    const visibleCount = Math.min(sorted.length, COUPON_RENDER_PAGE_SIZE);
    try {
      const selectionPatch = typeof this.getCouponSelectionPatch === "function"
        ? this.getCouponSelectionPatch(sorted)
        : {};
      const selectionRenderPatch = typeof this.withCouponSelectionRender === "function"
        ? this.withCouponSelectionRender(Object.assign({}, selectionPatch, {
          filteredCoupons: sorted.slice(0, visibleCount),
        }))
        : Object.assign({}, selectionPatch, { filteredCoupons: sorted.slice(0, visibleCount) });
      this.setData({
        ...selectionRenderPatch,
        filteredCouponTotal: sorted.length,
        couponDataReady: true,
        filterSummary: summary,
        hasActiveFilter: activeCategory !== "all" || activeStatus !== "all" || activePlatform !== "all"
          || Boolean(String(searchQuery || "").trim()),
      });
      this.filteredCouponsFull = sorted;
      this.couponVisibleCount = visibleCount;
      this.couponPageLoading = false;
      return true;
    } catch (error) {
      this.couponPageLoading = false;
      console.warn("coupon filter result render failed:", error);
      showFilterToast(this, "筛选结果刷新失败，请重试");
      return false;
    }
  },
};
