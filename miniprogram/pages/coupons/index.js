const store = require("../../utils/couponStore.js");
const planStore = require("../../utils/planStore.js");
const recommendation = require("../../utils/recommendation.js");
const routeService = require("../../utils/services/routeService.js");
const haptics = require("../../utils/haptics.js");
const { hasCoordinates, normalizeCoordinate } = require("../../utils/locationUtils.js");
const { normalizeExactId } = require("../../utils/idUtils.js");
const {
  filterCoupons,
  sortCoupons,
  buildFilterSummary,
  formatDishesSummary,
  isCouponSelected,
  isSafeCouponSelectionId,
} = require("./couponFilterHandler.js");
const { decodeSharedText, normalizeSharedCoupon, parseSharedJson } = require("./couponShareHelper.js");
const batchHandlers = require("./handlers/batchHandlers.js");
const compareShareHandlers = require("./handlers/compareShareHandlers.js");
const filterHandlers = require("./handlers/filterHandlers.js");

const PLATFORM_CLASS_MAP = {
  美团: "meituan",
  大众点评: "dianping",
  点评: "dianping",
  抖音: "douyin",
};
const COUPON_RENDER_PAGE_SIZE = 40;
const DETAIL_SECTION_TARGETS = new Set([
  "dishes", "rules", "screenshots", "recommendation", "warnings", "note", "reminders",
]);

function getEventValue(event, key) {
  const currentValue = event && event.currentTarget && event.currentTarget.dataset
    ? event.currentTarget.dataset[key]
    : undefined;
  if (currentValue !== undefined && currentValue !== null && currentValue !== "") return currentValue;
  return event && event.target && event.target.dataset ? event.target.dataset[key] : undefined;
}

function getCouponEventId(event) {
  const id = normalizeExactId(getEventValue(event, "id"));
  return isSafeCouponSelectionId(id) ? id : "";
}

function decorateCouponSelections(coupons, selectedBatchMap, selectedCompareMap) {
  return (Array.isArray(coupons) ? coupons : []).map((coupon) => Object.assign({}, coupon, {
    batchSelected: Boolean(coupon && isCouponSelected(selectedBatchMap, coupon.id)),
    compareSelected: Boolean(coupon && isCouponSelected(selectedCompareMap, coupon.id)),
  }));
}

const pageConfig = {
  data: {
    categories: [
      { label: "全部", value: "all" },
      { label: "吃饭", value: "food" },
      { label: "饮品", value: "drink" },
      { label: "娱乐", value: "play" },
      { label: "户外", value: "outdoor" },
      { label: "生活", value: "life" },
    ],
    statuses: [
      { label: "全部", value: "all" },
      { label: "待安排", value: "pending" },
      { label: "已安排", value: "planned" },
      { label: "已使用", value: "used" },
      { label: "已过期", value: "expired" },
    ],
    platforms: [
      { label: "全部", value: "all" },
      { label: "美团", value: "美团" },
      { label: "大众点评", value: "大众点评" },
      { label: "抖音", value: "抖音" },
      { label: "其他", value: "其他" },
    ],
    sortOptions: [
      { label: "推荐", value: "default" },
      { label: "临期", value: "expire" },
      { label: "距离", value: "distance" },
      { label: "价格", value: "price" },
    ],
    showFilters: false,
    priceOrderText: "低到高",
    activeCategory: "all",
    activeStatus: "all",
    activePlatform: "all",
    activeSort: "default",
    priceAsc: true,
    searchQuery: "",
    coupons: [],
    filteredCoupons: [],
    filteredCouponTotal: 0,
    couponDataReady: false,
    filterSummary: "全部",
    hasActiveFilter: false,
    expandedCouponId: null,
    selectTodayMode: false,
    batchMode: false,
    selectedBatchMap: {},
    selectedBatchCount: 0,
    compareMode: false,
    selectedCompareMap: {},
    selectedCompareCount: 0,
    showCompareDrawer: false,
    compareItems: [],
    showShareCandidateDrawer: false,
    shareCandidateItems: [],
    shareMode: false,
    isSharedView: false,
    sharedBannerTitle: "",
    sharedCouponsCount: 0,
    todayDateText: "",
  },

  onLoad(options) {
    this.hidden = false;
    this.unloaded = false;
    this.allCoupons = [];
    this.filteredCouponsFull = [];
    this.couponVisibleCount = 0;
    this.couponPageLoading = false;
    this.setData({ todayDateText: recommendation.dateText(new Date()) });
    if (options && options.sharedCoupons) {
      const parsed = parseSharedJson(options.sharedCoupons);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const sharedCoupons = parsed.map(normalizeSharedCoupon);
        if (sharedCoupons.every(Boolean)) {
          this.isSharedView = true;
          this.sharedCouponsList = sharedCoupons;
          this.setData({
            isSharedView: true,
            sharedBannerTitle: Array.from(decodeSharedText(options.shareTitle || "好友向你分享了优惠方案")).slice(0, 80).join(""),
            sharedCouponsCount: sharedCoupons.length,
          });
        } else {
          wx.showToast({ title: "分享内容不完整，已停止载入", icon: "none" });
        }
      }
    }
    if (options && options.filter) {
      const requestedStatus = options.filter === "todo" ? "pending" : options.filter;
      const validStatuses = ["all", "pending", "planned", "used", "expired", "urgent", "draft"];
      this.setData({ activeStatus: validStatuses.includes(requestedStatus) ? requestedStatus : "all" });
    }
    if (options && options.action === "add_today") {
      this.setData({ selectTodayMode: true, activeStatus: "pending" });
      wx.showToast({ title: "请点击要安排在今天的券", icon: "none", duration: 2500 });
    }
  },

  onShow() {
    if (this.unloaded) return;
    this.hidden = false;
    this.setData({ couponDataReady: false });
    this.loadCoupons();
  },

  onHide() {
    this.hidden = true;
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.allCoupons = [];
    this.filteredCouponsFull = [];
    this.couponVisibleCount = 0;
    this.couponPageLoading = false;
    this.compareDismissHelper = null;
    this.shareDismissHelper = null;
    try {
      this.setData({
        coupons: [],
        filteredCoupons: [],
        filteredCouponTotal: 0,
        couponDataReady: false,
        expandedCouponId: null,
        showFilters: false,
        batchMode: false,
        selectedBatchMap: {},
        selectedBatchCount: 0,
        compareMode: false,
        selectedCompareMap: {},
        selectedCompareCount: 0,
        showCompareDrawer: false,
        compareItems: [],
        showShareCandidateDrawer: false,
        shareCandidateItems: [],
        shareMode: false,
        compareDragY: 0,
        shareDragY: 0,
      });
    } catch (error) {
      console.warn("coupon render state release failed:", error);
    }
  },

  onUnload() {
    this.unloaded = true;
    this.hidden = true;
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.allCoupons = [];
    this.filteredCouponsFull = [];
    this.couponVisibleCount = 0;
    this.couponPageLoading = false;
    this.compareDismissHelper = null;
    this.shareDismissHelper = null;
  },

  setFilteredCouponWindow(coupons = [], reset = true) {
    const nextFullList = Array.isArray(coupons) ? coupons : [];
    const requestedVisibleCount = reset
      ? COUPON_RENDER_PAGE_SIZE
      : Math.max(COUPON_RENDER_PAGE_SIZE, Number(this.couponVisibleCount) || 0);
    const visibleCount = Math.min(
      nextFullList.length,
      requestedVisibleCount,
    );
    try {
      const selectionPatch = typeof this.getCouponSelectionPatch === "function"
        ? this.getCouponSelectionPatch(nextFullList)
        : {};
      this.setData({
        filteredCoupons: decorateCouponSelections(
          nextFullList.slice(0, visibleCount),
          selectionPatch.selectedBatchMap || this.data.selectedBatchMap,
          selectionPatch.selectedCompareMap || this.data.selectedCompareMap,
        ),
        filteredCouponTotal: nextFullList.length,
        couponDataReady: true,
        ...selectionPatch,
      });
      this.filteredCouponsFull = nextFullList;
      this.couponVisibleCount = visibleCount;
      this.couponPageLoading = false;
      return true;
    } catch (error) {
      this.couponPageLoading = false;
      console.warn("coupon filtered window render failed:", error);
      return false;
    }
  },

  getCouponSelectionPatch(coupons = []) {
    const visibleIds = new Set((Array.isArray(coupons) ? coupons : [])
      .map((coupon) => coupon && coupon.id)
      .filter(isSafeCouponSelectionId));
    const pruneMap = (source, limit) => {
      const result = {};
      let count = 0;
      Object.keys(source || {}).some((id) => {
        if (isCouponSelected(source, id) && visibleIds.has(id)) {
          result[id] = true;
          count += 1;
        }
        return count >= limit;
      });
      return result;
    };
    const selectedBatchMap = pruneMap(this.data.selectedBatchMap, 500);
    const selectedCompareMap = pruneMap(this.data.selectedCompareMap, 3);
    return {
      selectedBatchMap,
      selectedBatchCount: Object.keys(selectedBatchMap).length,
      selectedCompareMap,
      selectedCompareCount: Object.keys(selectedCompareMap).length,
      expandedCouponId: visibleIds.has(this.data.expandedCouponId) ? this.data.expandedCouponId : null,
      showCompareDrawer: false,
      compareItems: [],
      compareDragY: 0,
      showShareCandidateDrawer: false,
      shareCandidateItems: [],
      shareMode: false,
      shareDragY: 0,
    };
  },

  withCouponSelectionRender(patch = {}) {
    const source = patch && typeof patch === "object" ? patch : {};
    const selectedBatchMap = Object.prototype.hasOwnProperty.call(source, "selectedBatchMap")
      ? source.selectedBatchMap
      : this.data.selectedBatchMap;
    const selectedCompareMap = Object.prototype.hasOwnProperty.call(source, "selectedCompareMap")
      ? source.selectedCompareMap
      : this.data.selectedCompareMap;
    const visibleCoupons = Object.prototype.hasOwnProperty.call(source, "filteredCoupons")
      ? source.filteredCoupons
      : this.data.filteredCoupons;
    return Object.assign({}, source, {
      filteredCoupons: decorateCouponSelections(
        visibleCoupons,
        selectedBatchMap,
        selectedCompareMap,
      ),
    });
  },

  onReachBottom() {
    if (this.hidden || this.unloaded || !Array.isArray(this.filteredCouponsFull)
      || this.couponPageLoading || this.couponVisibleCount >= this.filteredCouponsFull.length) return;
    const previousVisibleCount = Math.min(
      this.filteredCouponsFull.length,
      Math.max(0, Number(this.couponVisibleCount) || 0),
    );
    const nextVisibleCount = Math.min(
      this.filteredCouponsFull.length,
      previousVisibleCount + COUPON_RENDER_PAGE_SIZE,
    );
    const patch = {};
    this.filteredCouponsFull
      .slice(previousVisibleCount, nextVisibleCount)
      .forEach((coupon, index) => {
        patch[`filteredCoupons[${previousVisibleCount + index}]`] = decorateCouponSelections(
          [coupon],
          this.data.selectedBatchMap,
          this.data.selectedCompareMap,
        )[0];
      });
    this.couponPageLoading = true;
    try {
      this.setData(patch, () => {
        this.couponPageLoading = false;
      });
      this.couponVisibleCount = nextVisibleCount;
    } catch (error) {
      this.couponPageLoading = false;
      console.warn("coupon next page render failed:", error);
      if (!this.hidden && !this.unloaded) {
        wx.showToast({ title: "更多优惠券加载失败，请重试", icon: "none" });
      }
    }
  },

  loadCoupons() {
    if (this.hidden || this.unloaded) return false;
    let coupons = [];
    try {
      if (this.isSharedView && Array.isArray(this.sharedCouponsList) && this.sharedCouponsList.length > 0) {
        coupons = this.sharedCouponsList.map((coupon) => store.normalizeCoupon(coupon)).filter(Boolean);
      } else {
        coupons = store.getAllCoupons() || [];
      }
      if (!Array.isArray(coupons)) throw new Error("coupon source is not an array");
    } catch (error) {
      console.warn("coupon source read failed:", error);
      if (!this.hidden && !this.unloaded) {
        wx.showToast({ title: "优惠券读取失败，请重试", icon: "none" });
      }
      return false;
    }

    let enriched = coupons;
    try {
      const activeOrigin = routeService.getActiveRouteOrigin();
      const plans = planStore.getPlans() || [];
      const context = recommendation.buildRecommendationContext({
        existingPlans: plans,
        allCoupons: coupons,
        routeOrigin: activeOrigin,
      });
      const topRecs = recommendation.getTopRecommendations(coupons, context) || [];
      const recMap = new Map();
      topRecs.forEach((r) => { if (r && r.couponId) recMap.set(r.couponId, r); });

      enriched = coupons.map((c) => {
        let merged = c;
        const rec = recMap.get(c.id);
        if (rec) merged = recommendation.mergeCouponRecommendation(c, rec, context);

        let platformClass = "default";
        const p = merged.platform || "";
        for (const [key, cls] of Object.entries(PLATFORM_CLASS_MAP)) {
          if (p.includes(key)) { platformClass = cls; break; }
        }

        const dynamicDistance = routeService.getDynamicDistance(merged, activeOrigin);
        return Object.assign({}, merged, {
          dishesSummary: formatDishesSummary(merged.dishes),
          platformClass,
          distanceKmText: dynamicDistance.distanceKmText,
          travelTime: dynamicDistance.travelTimeText || merged.travelTime,
        });
      });
    } catch (e) {
      enriched = coupons;
    }

    const counts = this.computeStatusCounts(enriched);
    const { activeCategory, activeStatus, activePlatform, searchQuery, activeSort, priceAsc, categories, statuses, platforms } = this.data;
    const matched = filterCoupons(enriched, { activeCategory, activeStatus, activePlatform, searchQuery });
    const sorted = sortCoupons(matched, { activeSort, priceAsc });
    const summary = buildFilterSummary({ activeCategory, activeStatus, activePlatform, categories, statuses, platforms });

    const visibleCount = Math.min(sorted.length, COUPON_RENDER_PAGE_SIZE);
    try {
      const selectionPatch = this.getCouponSelectionPatch(sorted);
      this.setData({
        coupons: [],
        filteredCoupons: decorateCouponSelections(
          sorted.slice(0, visibleCount),
          selectionPatch.selectedBatchMap,
          selectionPatch.selectedCompareMap,
        ),
        filteredCouponTotal: sorted.length,
        couponDataReady: true,
        statusCounts: counts,
        filterSummary: summary,
        hasActiveFilter: activeCategory !== "all" || activeStatus !== "all" || activePlatform !== "all"
          || Boolean(String(searchQuery || "").trim()),
        ...selectionPatch,
      });
      this.allCoupons = enriched;
      this.filteredCouponsFull = sorted;
      this.couponVisibleCount = visibleCount;
      this.couponPageLoading = false;
      return true;
    } catch (error) {
      this.couponPageLoading = false;
      console.warn("coupon list render failed:", error);
      if (!this.hidden && !this.unloaded) {
        wx.showToast({ title: "优惠券列表刷新失败，请重试", icon: "none" });
      }
      return false;
    }
  },

  restoreSampleData() {
    haptics.medium();
    wx.showModal({
      title: "恢复全量示例券",
      content: "将重置并加载全套丰富示例优惠券（包含待安排、已安排、已过期、已使用），确定恢复吗？",
      confirmText: "确定恢复",
      confirmColor: "#3AAFA9",
      success: (res) => {
        if (this.hidden || this.unloaded) return;
        if (res.confirm) {
          let restored = false;
          try {
            restored = Boolean(store.resetSampleCoupons());
          } catch (error) {
            console.warn("coupon sample reset failed:", error);
          }
          if (!restored) {
            wx.showToast({ title: "示例数据恢复失败，请重试", icon: "none" });
            return;
          }
          const refreshed = this.loadCoupons() !== false;
          wx.showToast({
            title: refreshed ? "示例数据已恢复" : "示例已恢复，列表刷新失败",
            icon: refreshed ? "success" : "none",
          });
        }
      }
    });
  },

  computeStatusCounts(coupons = []) {
    const counts = { all: 0, pending: 0, planned: 0, expired: 0, used: 0 };
    coupons.forEach((c) => {
      if (c.statusCode === "used") {
        counts.used += 1;
        return;
      }
      counts.all += 1;
      if (c.statusCode === "expired" || c.stateClass === "expired") counts.expired += 1;
      else if (c.statusCode === "planned") counts.planned += 1;
      else if (["pending", "unplanned", "recommended"].includes(c.statusCode)) counts.pending += 1;
    });
    return counts;
  },

  openExtendDialog(e) {
    haptics.light();
    const id = getCouponEventId(e);
    const coupon = (this.allCoupons || []).find((c) => c.id === id);
    if (!coupon) return;

    const now = new Date();
    const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const d7 = new Date(now.getTime() + 7 * 86400000);
    const d14 = new Date(now.getTime() + 14 * 86400000);
    const d30 = new Date(now.getTime() + 30 * 86400000);

    wx.showActionSheet({
      itemList: [
        `⏱️ 快捷延期 7 天（至 ${fmtDate(d7)}）`,
        `⏱️ 快捷延期 14 天（至 ${fmtDate(d14)}）`,
        `⏱️ 快捷延期 30 天（至 ${fmtDate(d30)}）`,
      ],
      success: (res) => {
        if (this.hidden || this.unloaded) return;
        let targetDate = "";
        if (res.tapIndex === 0) targetDate = fmtDate(d7);
        else if (res.tapIndex === 1) targetDate = fmtDate(d14);
        else if (res.tapIndex === 2) targetDate = fmtDate(d30);

        if (targetDate) {
          let extended = false;
          try {
            extended = Boolean(store.extendCouponExpiry(coupon.id, targetDate));
          } catch (error) {
            console.warn("coupon expiry extension failed:", error);
          }
          if (!extended) {
            wx.showToast({ title: "延期保存失败，请重试", icon: "none" });
            return;
          }
          haptics.medium();
          const refreshed = this.loadCoupons() !== false;
          wx.showToast({
            title: refreshed ? `已延期至 ${targetDate}` : "延期已保存，列表刷新失败",
            icon: refreshed ? "success" : "none",
          });
        }
      },
    });
  },

  goAdd() {
    wx.navigateTo({ url: "/pages/coupon-edit/index" });
  },

  goFoodWheel() {
    wx.navigateTo({ url: "/pages/food-wheel/index" });
  },

  onCardTap(e) {
    const id = getCouponEventId(e);
    if (!id) return;
    if (this.data.batchMode) {
      this.toggleSelectBatch(e);
      return;
    }
    if (this.data.compareMode) {
      this.toggleSelectCompare(e);
      return;
    }
    if (this.data.selectTodayMode) {
      const todayStr = recommendation.dateText(new Date());
      this.navigateToPlanConfirm(id, todayStr);
      return;
    }
    haptics.light();
    this.setData({
      expandedCouponId: this.data.expandedCouponId === id ? null : id,
    });
  },

  toggleExpand(e) {
    this.onCardTap(e);
  },

  goDetail(e) {
    const id = getCouponEventId(e);
    if (!id) return;
    haptics.light();
    wx.navigateTo({ url: `/pages/coupon-detail/index?id=${encodeURIComponent(id)}` });
  },

  goDetailSection(e) {
    const id = getCouponEventId(e);
    const rawTarget = String(getEventValue(e, "target") || "rules").trim().slice(0, 32);
    const target = DETAIL_SECTION_TARGETS.has(rawTarget) ? rawTarget : "rules";
    if (!id) return;
    if (this.data.batchMode) return this.toggleSelectBatch(e);
    if (this.data.compareMode) return this.toggleSelectCompare(e);
    haptics.light();
    wx.navigateTo({ url: `/pages/coupon-detail/index?id=${encodeURIComponent(id)}&targetSection=${encodeURIComponent(target)}` });
  },

  addToPlan(e) {
    const id = getCouponEventId(e);
    if (!id) return;
    if (this.data.selectTodayMode) {
      const todayStr = recommendation.dateText(new Date());
      this.navigateToPlanConfirm(id, todayStr);
      return;
    }
    this.navigateToPlanConfirm(id);
  },

  navigateToPlanConfirm(id, selectedDate = "") {
    const couponId = normalizeExactId(id);
    if (!isSafeCouponSelectionId(couponId) || this.hidden || this.unloaded) return;
    const wasSelectTodayMode = Boolean(selectedDate && this.data.selectTodayMode);
    if (wasSelectTodayMode) this.setData({ selectTodayMode: false });
    const query = [
      `id=${encodeURIComponent(couponId)}`,
      selectedDate ? `date=${encodeURIComponent(selectedDate)}` : "",
    ].filter(Boolean).join("&");
    const handleFailure = () => {
      if (this.hidden || this.unloaded) return;
      if (wasSelectTodayMode) this.setData({ selectTodayMode: true });
      wx.showToast({ title: "计划确认页打开失败，请重试", icon: "none" });
    };
    try {
      wx.navigateTo({ url: `/pages/plan-confirm/index?${query}`, fail: handleFailure });
    } catch (error) {
      handleFailure();
    }
  },

  openStoreMap(e) {
    const venue = String(getEventValue(e, "venue") || "").trim().slice(0, 80);
    const address = String(getEventValue(e, "address") || "").trim().slice(0, 160);
    const lat = normalizeCoordinate(getEventValue(e, "lat"));
    const lng = normalizeCoordinate(getEventValue(e, "lng"));

    if (!hasCoordinates({ latitude: lat, longitude: lng })) {
      if (!address || /待补充|待选择|待定|可在编辑页/.test(address)) {
        wx.showToast({ title: "暂无店铺坐标或地址", icon: "none" });
        return;
      }
      wx.setClipboardData({
        data: address,
        success: () => {
          if (!this.hidden && !this.unloaded) wx.showToast({ title: "暂无精确坐标，地址已复制", icon: "none" });
        },
        fail: () => {
          if (!this.hidden && !this.unloaded) wx.showToast({ title: "地址复制失败", icon: "none" });
        },
      });
      return;
    }

    haptics.light();
    wx.openLocation({
      latitude: lat,
      longitude: lng,
      name: venue || "店铺位置",
      address,
      scale: 16,
      fail: () => {
        if (!this.hidden && !this.unloaded) wx.showToast({ title: "打开地图失败", icon: "none" });
      },
    });
  },

  copyAddress(e) {
    const address = String(getEventValue(e, "address") || "").trim().slice(0, 160);
    if (!address || /待补充|待选择|待定|可在编辑页/.test(String(address))) {
      wx.showToast({ title: "暂无可复制的地址", icon: "none" });
      return;
    }
    haptics.light();
    wx.setClipboardData({
      data: address,
      success: () => {
        if (!this.hidden && !this.unloaded) wx.showToast({ title: "地址已复制", icon: "success", duration: 1500 });
      },
      fail: () => {
        if (!this.hidden && !this.unloaded) wx.showToast({ title: "地址复制失败", icon: "none" });
      },
    });
  },

  stopPropagation() {},

};

Object.assign(pageConfig, filterHandlers, batchHandlers, compareShareHandlers);

Page(pageConfig);
