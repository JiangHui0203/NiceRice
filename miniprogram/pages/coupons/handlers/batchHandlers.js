const haptics = require("../../../utils/haptics.js");
const screenshotService = require("../../../utils/services/screenshotService.js");
const couponStore = require("../../../utils/couponStore.js");
const { normalizeExactId } = require("../../../utils/idUtils.js");
const {
  executeBatchDelete,
  executeBatchMarkUsed,
  isCouponSelected,
  isSafeCouponSelectionId,
  selectAllBatchItems,
  toggleSelectBatchItem,
} = require("../couponFilterHandler.js");

const ATTACHMENT_CLEANUP_CONCURRENCY = 3;

function getScreenshotStorageKeys(screenshot) {
  if (typeof screenshot === "string") return screenshot ? [screenshot] : [];
  if (!screenshot || typeof screenshot !== "object" || Array.isArray(screenshot)) return [];
  return [
    screenshot.encryptedPath,
    screenshot.savedFilePath,
    screenshot.path,
    screenshot.fileID,
    screenshot.url,
  ].filter((value, index, list) => value && list.indexOf(value) === index);
}

function collectScreenshotStorageKeys(coupons = []) {
  const keys = new Set();
  (Array.isArray(coupons) ? coupons : []).forEach((coupon) => {
    (Array.isArray(coupon && coupon.screenshots) ? coupon.screenshots : [])
      .slice(0, 6)
      .forEach((screenshot) => getScreenshotStorageKeys(screenshot).forEach((key) => keys.add(key)));
  });
  return keys;
}

function cleanupDeletedCouponAttachments(coupons = [], retainedCoupons = null) {
  // Fail closed when the post-transaction record set cannot be read. Deleting
  // metadata is recoverable only from backup; deleting a shared file is not.
  if (!Array.isArray(retainedCoupons)) return Promise.resolve([false]);
  const retainedKeys = collectScreenshotStorageKeys(retainedCoupons);
  const scheduledKeys = new Set();
  const screenshots = [];
  (Array.isArray(coupons) ? coupons : []).forEach((coupon) => {
    (Array.isArray(coupon && coupon.screenshots) ? coupon.screenshots : [])
      .slice(0, 6)
      .forEach((screenshot) => {
        const keys = getScreenshotStorageKeys(screenshot);
        if (keys.some((key) => retainedKeys.has(key))) return;
        if (keys.length && keys.some((key) => scheduledKeys.has(key))) return;
        keys.forEach((key) => scheduledKeys.add(key));
        screenshots.push(screenshot);
      });
  });
  if (!screenshots.length) return Promise.resolve([]);
  const results = new Array(screenshots.length);
  let cursor = 0;
  const consume = () => {
    const index = cursor;
    cursor += 1;
    if (index >= screenshots.length) return Promise.resolve();
    let task;
    try {
      // retainedCoupons was read after the record transaction and every path
      // in this queue has already passed the shared-reference check above.
      task = screenshotService.deleteScreenshot(screenshots[index], { knownUnreferenced: true });
    } catch (error) {
      task = false;
    }
    return Promise.resolve(task)
      .then((value) => { results[index] = value === true; })
      .catch(() => { results[index] = false; })
      .then(consume);
  };
  return Promise.all(Array.from(
    { length: Math.min(ATTACHMENT_CLEANUP_CONCURRENCY, screenshots.length) },
    consume,
  )).then(() => results);
}

function keepFailedSelection(page, failedIds = []) {
  const selectedBatchMap = {};
  failedIds.forEach((id) => {
    if (isSafeCouponSelectionId(id)) selectedBatchMap[id] = true;
  });
  const patch = { selectedBatchMap, selectedBatchCount: Object.keys(selectedBatchMap).length };
  page.setData(typeof page.withCouponSelectionRender === "function"
    ? page.withCouponSelectionRender(patch)
    : patch);
}

function getFilteredCoupons(page) {
  const fullList = Array.isArray(page.filteredCouponsFull) ? page.filteredCouponsFull : null;
  const visibleList = Array.isArray(page.data.filteredCoupons) ? page.data.filteredCoupons : [];
  return fullList && (fullList.length || !visibleList.length) ? fullList : visibleList;
}

function getEventCouponId(event) {
  const id = normalizeExactId((event && event.currentTarget && event.currentTarget.dataset
    ? event.currentTarget.dataset.id
    : "") || "");
  return isSafeCouponSelectionId(id) ? id : "";
}

function isFilteredCouponId(page, id) {
  return Boolean(id) && getFilteredCoupons(page).some((coupon) => coupon && coupon.id === id);
}

function finishBatchOperation(page, outcome, labels = {}) {
  if (!page || page.hidden || page.unloaded) return false;
  const successCount = (outcome.successIds || []).length;
  const failedCount = (outcome.failedIds || []).length;
  if (!successCount) {
    wx.showToast({ title: outcome.error || labels.failure || "操作失败，请重试", icon: "none" });
    return false;
  }

  if (failedCount) {
    keepFailedSelection(page, outcome.failedIds);
    const refreshed = page.loadCoupons() !== false;
    wx.showModal({
      title: labels.partialTitle || "部分操作失败",
      content: `${labels.successVerb || "已处理"} ${successCount} 张，失败 ${failedCount} 张。失败项已保留勾选，可稍后重试。${!refreshed ? "\n列表刷新失败，请重新进入本页查看最新结果。" : ""}${labels.warningContent ? `\n${labels.warningContent}` : ""}`,
      showCancel: false,
    });
    return false;
  }

  page.toggleBatchMode();
  const refreshed = page.loadCoupons() !== false;
  const warningContent = [
    labels.warningContent,
    !refreshed ? "列表刷新失败，请重新进入本页查看最新结果。" : "",
  ].filter(Boolean).join("\n");
  if (warningContent) {
    wx.showModal({
      title: labels.warningTitle || "操作已完成",
      content: warningContent,
      showCancel: false,
    });
  } else {
    wx.showToast({ title: labels.success || "操作完成", icon: "success" });
  }
  return true;
}

module.exports = {
  exitSelectTodayMode() {
    this.setData({ selectTodayMode: false });
  },

  onLongPressCoupon(e) {
    haptics.medium();
    const id = getEventCouponId(e);
    if (!isFilteredCouponId(this, id)) return;
    if (!this.data.batchMode) {
      const selectedBatchMap = id ? { [id]: true } : {};
      this.compareDismissHelper = null;
      this.shareDismissHelper = null;
      this.setData(this.withCouponSelectionRender({
        batchMode: true,
        selectedBatchMap,
        selectedBatchCount: id ? 1 : 0,
        compareMode: false,
        selectedCompareMap: {},
        selectedCompareCount: 0,
        showCompareDrawer: false,
        compareItems: [],
      }));
    }
  },

  invertSelectBatch() {
    haptics.light();
    const currentMap = this.data.selectedBatchMap || {};
    const selectedBatchMap = {};
    let selectedBatchCount = 0;
    getFilteredCoupons(this).forEach((coupon) => {
      if (coupon && isSafeCouponSelectionId(coupon.id) && !isCouponSelected(currentMap, coupon.id)) {
        selectedBatchMap[coupon.id] = true;
        selectedBatchCount += 1;
      }
    });
    this.setData(this.withCouponSelectionRender({ selectedBatchMap, selectedBatchCount }));
  },

  toggleBatchMode() {
    this.compareDismissHelper = null;
    this.shareDismissHelper = null;
    this.setData(this.withCouponSelectionRender({
      batchMode: !this.data.batchMode,
      compareMode: false,
      selectedBatchMap: {},
      selectedBatchCount: 0,
      selectedCompareMap: {},
      selectedCompareCount: 0,
      showCompareDrawer: false,
      compareItems: [],
      showShareCandidateDrawer: false,
      shareCandidateItems: [],
      shareMode: false,
    }));
  },

  toggleSelectBatch(e) {
    const id = getEventCouponId(e);
    if (!isFilteredCouponId(this, id)) return;
    this.setData(this.withCouponSelectionRender(
      toggleSelectBatchItem(this.data.selectedBatchMap, this.data.selectedBatchCount, id),
    ));
  },

  selectAllBatch() {
    const coupons = getFilteredCoupons(this);
    const selectedMap = this.data.selectedBatchMap || {};
    const selectableCoupons = coupons.filter((coupon) => coupon && isSafeCouponSelectionId(coupon.id));
    const allSelected = selectableCoupons.length > 0
      && selectableCoupons.every((coupon) => isCouponSelected(selectedMap, coupon.id));
    this.setData(this.withCouponSelectionRender(selectAllBatchItems(selectableCoupons, !allSelected)));
  },

  batchMarkUsed() {
    const { selectedBatchMap, selectedBatchCount } = this.data;
    if (!selectedBatchCount) {
      wx.showToast({ title: "请先勾选优惠券", icon: "none" });
      return;
    }
    wx.showModal({
      title: "批量标记已使用",
      content: `确定将选中的 ${selectedBatchCount} 张优惠券标记为已使用吗？`,
      confirmText: "确定",
      confirmColor: "#34c759",
      success: (result) => {
        if (this.hidden || this.unloaded) return;
        if (result.confirm) {
          const outcome = executeBatchMarkUsed(selectedBatchMap, selectedBatchCount, { usedAt: new Date().toISOString() });
          finishBatchOperation(this, outcome, {
            success: "已标记完成",
            failure: "标记失败，请重试",
            partialTitle: "部分标记失败",
            successVerb: "已标记",
          });
        }
      },
    });
  },

  batchDelete() {
    const { selectedBatchMap, selectedBatchCount } = this.data;
    if (!selectedBatchCount) {
      wx.showToast({ title: "请先勾选优惠券", icon: "none" });
      return;
    }
    wx.showModal({
      title: "批量删除确认",
      content: `确定要彻底删除选中的 ${selectedBatchCount} 张优惠券吗？删除后将无法恢复。`,
      confirmText: "删除",
      confirmColor: "#dc2626",
      success: (result) => {
        if (this.hidden || this.unloaded) return;
        if (result.confirm) {
          const outcome = executeBatchDelete(selectedBatchMap, selectedBatchCount);
          if (!(outcome.successIds || []).length) {
            finishBatchOperation(this, outcome, { failure: "删除失败，请重试" });
            return;
          }

          // Take attachment snapshots before deletion and only clean files for
          // coupons whose record deletion actually succeeded.
          let retainedCoupons = null;
          try {
            retainedCoupons = couponStore.getAllCoupons();
          } catch (error) {
            retainedCoupons = null;
          }
          cleanupDeletedCouponAttachments(outcome.deletedCoupons, retainedCoupons).then((results) => {
            if (this.hidden || this.unloaded) return;
            const cleanupFailed = results.some((value) => value !== true);
            finishBatchOperation(this, outcome, {
              success: "已批量删除",
              failure: "删除失败，请重试",
              partialTitle: "部分删除失败",
              successVerb: "已删除",
              warningTitle: "优惠券已删除",
              warningContent: cleanupFailed ? "部分本地附件未能清理，可稍后在存储管理中再次清理。" : "",
            });
          }).catch((error) => {
            console.warn("batch attachment cleanup failed", error);
            if (!this.hidden && !this.unloaded) {
              finishBatchOperation(this, outcome, {
                success: "已批量删除",
                failure: "删除失败，请重试",
                warningTitle: "优惠券已删除",
                warningContent: "部分本地附件未能清理，可稍后在存储管理中再次清理。",
              });
            }
          });
        }
      },
    });
  },
};
