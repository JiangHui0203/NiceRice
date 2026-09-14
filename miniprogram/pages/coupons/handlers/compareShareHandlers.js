const TouchDismissHelper = require("../../../utils/touchDismissHelper.js");
const store = require("../../../utils/couponStore.js");
const { normalizeExactId } = require("../../../utils/idUtils.js");
const {
  buildCompareItemsList,
  isCouponSelected,
  isSafeCouponSelectionId,
  toggleSelectCompareItem,
} = require("../couponFilterHandler.js");
const {
  buildCouponsSharePayload,
  buildShareCandidateItems,
  buildShareCandidateText,
} = require("../couponShareHelper.js");

function getEventCouponId(event) {
  const id = normalizeExactId((event && event.currentTarget && event.currentTarget.dataset
    ? event.currentTarget.dataset.id
    : "") || "");
  return isSafeCouponSelectionId(id) ? id : "";
}

function getVisibleCoupons(page) {
  const fullList = Array.isArray(page.filteredCouponsFull) ? page.filteredCouponsFull : null;
  const visibleList = page.data && Array.isArray(page.data.filteredCoupons) ? page.data.filteredCoupons : [];
  return fullList && (fullList.length || !visibleList.length) ? fullList : visibleList;
}

function getCouponLookupList(page) {
  const fullList = Array.isArray(page.allCoupons) ? page.allCoupons : null;
  const visibleList = page.data && Array.isArray(page.data.filteredCoupons) ? page.data.filteredCoupons : [];
  return fullList && (fullList.length || !visibleList.length) ? fullList : visibleList;
}

function hasCoupon(page, id) {
  return Boolean(id) && getVisibleCoupons(page).some((coupon) => coupon && coupon.id === id);
}

module.exports = {
  toggleCompareMode() {
    this.compareDismissHelper = null;
    this.shareDismissHelper = null;
    this.setData(this.withCouponSelectionRender({
      compareMode: !this.data.compareMode,
      batchMode: false,
      selectedCompareMap: {},
      selectedCompareCount: 0,
      showCompareDrawer: false,
      compareItems: [],
      selectedBatchMap: {},
      selectedBatchCount: 0,
      showShareCandidateDrawer: false,
      shareCandidateItems: [],
      shareMode: false,
    }));
  },

  toggleSelectCompare(e) {
    const id = getEventCouponId(e);
    if (!hasCoupon(this, id)) return;
    const result = toggleSelectCompareItem(this.data.selectedCompareMap, this.data.selectedCompareCount, id, 3);
    if (!result.success) {
      wx.showToast({ title: result.error, icon: "none" });
      return;
    }
    this.setData(this.withCouponSelectionRender({
      selectedCompareMap: result.selectedCompareMap,
      selectedCompareCount: result.selectedCompareCount,
    }));
  },

  startCompare() {
    const result = buildCompareItemsList(
      getCouponLookupList(this),
      this.data.selectedCompareMap,
      this.data.selectedCompareCount
    );
    if (!result.success) {
      wx.showToast({ title: result.error, icon: "none" });
      return;
    }
    this.setData({ compareItems: result.compareItems, showCompareDrawer: true });
  },

  closeCompare() {
    this.compareDismissHelper = null;
    this.setData({ showCompareDrawer: false, compareItems: [], compareDragY: 0 });
  },

  compareSelectAction(e) {
    const id = getEventCouponId(e);
    if (!hasCoupon(this, id)) return;
    try {
      wx.navigateTo({
        url: `/pages/plan-confirm/index?id=${encodeURIComponent(id)}`,
        fail: () => {
          if (!this.hidden && !this.unloaded) {
            wx.showToast({ title: "计划确认页打开失败，请重试", icon: "none" });
          }
        },
      });
    } catch (error) {
      if (!this.hidden && !this.unloaded) {
        wx.showToast({ title: "计划确认页打开失败，请重试", icon: "none" });
      }
    }
  },

  saveSharedCouponsToMyList() {
    if (!this.sharedCouponsList || !this.sharedCouponsList.length) return;
    let count = 0;
    let failedCount = 0;
    this.sharedCouponsList.forEach((coupon) => {
      try {
        if (!store.findCoupon(coupon.id)) {
          if (store.addCoupon(coupon)) count += 1;
          else failedCount += 1;
        }
      } catch (error) {
        failedCount += 1;
      }
    });
    if (this.hidden || this.unloaded) return;
    if (failedCount) {
      wx.showModal({
        title: count ? "部分优惠券保存失败" : "优惠券保存失败",
        content: count
          ? `已保存 ${count} 张，另有 ${failedCount} 张未能写入，请清理存储后重试。`
          : "优惠券未能写入本地，请清理存储空间后重试。",
        showCancel: false,
      });
      if (count) this.loadCoupons();
      return;
    }
    try {
      this.setData({ isSharedView: false });
    } catch (error) {
      wx.showToast({ title: "券已保存，券包切换失败", icon: "none" });
      return;
    }
    this.isSharedView = false;
    this.sharedCouponsList = null;
    const refreshed = this.loadCoupons() !== false;
    wx.showToast({
      title: refreshed
        ? (count > 0 ? `已将 ${count} 张券存入券包` : "券已在你的券包中")
        : "券已保存，券包列表刷新失败",
      icon: refreshed ? "success" : "none",
    });
  },

  exitSharedView() {
    try {
      this.setData({ isSharedView: false });
    } catch (error) {
      wx.showToast({ title: "券包切换失败，请重试", icon: "none" });
      return;
    }
    this.isSharedView = false;
    this.sharedCouponsList = null;
    if (this.loadCoupons() === false) {
      wx.showToast({ title: "券包列表刷新失败，请重试", icon: "none" });
    }
  },

  openShareCandidateDrawer() {
    const { selectedBatchMap, selectedBatchCount } = this.data;
    const coupons = getCouponLookupList(this);
    const actualSelectedCount = coupons
      .filter((coupon) => coupon && isCouponSelected(selectedBatchMap, coupon.id)).length;
    const shareCandidateItems = buildShareCandidateItems(coupons, selectedBatchMap);
    if (selectedBatchCount < 1 || actualSelectedCount < 1 || !shareCandidateItems.length) {
      wx.showToast({ title: "请至少选择1张券", icon: "none" });
      return;
    }
    if (actualSelectedCount > 3) {
      wx.showToast({ title: "单次最多分享3张券", icon: "none" });
      return;
    }
    this.setData({
      shareCandidateItems,
      showShareCandidateDrawer: true,
      shareMode: true,
    });
  },

  openShareCandidateFromCompare() {
    const { selectedCompareMap, selectedCompareCount } = this.data;
    const coupons = getCouponLookupList(this);
    const shareCandidateItems = buildShareCandidateItems(coupons, selectedCompareMap);
    if (selectedCompareCount < 2 || shareCandidateItems.length < 2) {
      wx.showToast({ title: "请至少选择2张券", icon: "none" });
      return;
    }
    this.setData({
      shareCandidateItems,
      showShareCandidateDrawer: true,
      shareMode: true,
      showCompareDrawer: false,
      compareItems: [],
      compareDragY: 0,
    });
  },

  closeShareCandidateDrawer() {
    this.shareDismissHelper = null;
    this.setData({
      showShareCandidateDrawer: false,
      shareCandidateItems: [],
      shareMode: false,
      shareDragY: 0,
    });
  },

  copyShareCandidateText() {
    const text = buildShareCandidateText(this.data.shareCandidateItems);
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: () => {
        if (this.hidden || this.unloaded) return;
        wx.showToast({ title: "分享文案已复制", icon: "success" });
        this.closeShareCandidateDrawer();
        if (this.data.batchMode) this.toggleBatchMode();
      },
      fail: () => {
        if (!this.hidden && !this.unloaded) wx.showToast({ title: "分享文案复制失败", icon: "none" });
      },
    });
  },

  onCompareTouchStart(e) {
    if (!this.compareDismissHelper) this.compareDismissHelper = new TouchDismissHelper({ thresholdY: 80 });
    const result = this.compareDismissHelper.onTouchStart(e);
    if (result) this.setData({ compareDragY: result.dragOffsetY });
  },

  onCompareTouchMove(e) {
    if (!this.compareDismissHelper) return;
    const result = this.compareDismissHelper.onTouchMove(e);
    if (result) this.setData({ compareDragY: result.dragOffsetY });
  },

  onCompareTouchEnd(e) {
    if (!this.compareDismissHelper) return;
    this.compareDismissHelper.onTouchEnd(e, () => this.closeCompare());
    this.setData({ compareDragY: 0 });
  },

  onShareDrawerTouchStart(e) {
    if (!this.shareDismissHelper) this.shareDismissHelper = new TouchDismissHelper({ thresholdY: 80 });
    const result = this.shareDismissHelper.onTouchStart(e);
    if (result) this.setData({ shareDragY: result.dragOffsetY });
  },

  onShareDrawerTouchMove(e) {
    if (!this.shareDismissHelper) return;
    const result = this.shareDismissHelper.onTouchMove(e);
    if (result) this.setData({ shareDragY: result.dragOffsetY });
  },

  onShareDrawerTouchEnd(e) {
    if (!this.shareDismissHelper) return;
    this.shareDismissHelper.onTouchEnd(e, () => this.closeShareCandidateDrawer());
    this.setData({ shareDragY: 0 });
  },

  onShareAppMessage() {
    let items = [];
    const shareCandidateItems = Array.isArray(this.data.shareCandidateItems)
      ? this.data.shareCandidateItems
      : [];
    if (this.data.shareMode && shareCandidateItems.length > 0) {
      items = shareCandidateItems;
    } else if (this.data.batchMode && this.data.selectedBatchCount > 0) {
      items = getCouponLookupList(this)
        .filter((coupon) => coupon && isCouponSelected(this.data.selectedBatchMap, coupon.id));
    }
    return buildCouponsSharePayload(items);
  },
};
