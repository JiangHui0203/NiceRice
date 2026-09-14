const couponStore = require("../../../utils/couponStore.js");
const haptics = require("../../../utils/haptics.js");
const privacyService = require("../../../utils/privacyService.js");
const { normalizeExactId } = require("../../../utils/idUtils.js");
const {
  CANDIDATE_STORAGE_KEY,
  appendCustomCandidate,
  buildCandidateDrawerState,
  buildCandidateVoteText,
  countSelectedCandidates,
  getCandidateVoteItems,
  removeCustomCandidate,
  toggleCandidateSelection,
} = require("../candidateHelper.js");

function readCustomCandidates() {
  try {
    return privacyService.readLocalData(CANDIDATE_STORAGE_KEY, []) || [];
  } catch (error) {
    return [];
  }
}

function resolveCandidateId(candidates, rawId) {
  const id = normalizeExactId(rawId);
  return id && (Array.isArray(candidates) ? candidates : []).some((item) => item && item.id === id)
    ? id
    : "";
}

module.exports = {
  openCandidateDrawer() {
    haptics.light();
    let allCoupons = [];
    try {
      allCoupons = couponStore.getAllCoupons() || [];
    } catch (error) {
      allCoupons = [];
    }
    this.setData(Object.assign(
      { showCandidateDrawer: true, isSharedCandidateMode: false },
      buildCandidateDrawerState(allCoupons, readCustomCandidates())
    ));
  },

  openSharedCandidateDrawer(sharedCandidates) {
    if (!sharedCandidates) return;
    this.setData(Object.assign(
      { showCandidateDrawer: true, isSharedCandidateMode: true },
      buildCandidateDrawerState(
        sharedCandidates.couponCandidates,
        sharedCandidates.customCandidates
      )
    ));
  },

  closeCandidateDrawer() {
    this.setData({ showCandidateDrawer: false });
  },

  onCustomCandidateInput(e) {
    this.setData({ newCustomCandidateText: String((e && e.detail && e.detail.value) || "").slice(0, 40) });
  },

  selectQuickTag(e) {
    const tag = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.tag) || "")
      .trim()
      .slice(0, 40);
    if (!tag) return;
    this.setData({ newCustomCandidateText: tag }, () => this.addCustomCandidate());
  },

  addCustomCandidate() {
    haptics.light();
    const result = appendCustomCandidate(readCustomCandidates(), this.data.newCustomCandidateText);
    if (!result.success) {
      wx.showToast({ title: result.error, icon: "none" });
      return;
    }
    if (!privacyService.writeLocalData(CANDIDATE_STORAGE_KEY, result.candidates)) {
      wx.showToast({ title: "候选保存失败，请重试", icon: "none" });
      return;
    }
    this.setData({ newCustomCandidateText: "" });
    this.openCandidateDrawer();
    wx.showToast({ title: "已添加候选", icon: "success" });
  },

  deleteCustomCandidate(e) {
    const storedCandidates = readCustomCandidates();
    const id = resolveCandidateId(
      storedCandidates,
      e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : "",
    );
    if (!id) return;
    haptics.light();
    if (!privacyService.writeLocalData(CANDIDATE_STORAGE_KEY, removeCustomCandidate(storedCandidates, id))) {
      wx.showToast({ title: "候选删除失败，请重试", icon: "none" });
      return;
    }
    this.openCandidateDrawer();
    wx.showToast({ title: "已移除候选", icon: "none" });
  },

  toggleCandidateSelect(e) {
    haptics.light();
    const id = resolveCandidateId(
      this.data.heatmapCandidates,
      e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : "",
    );
    if (!id) return;
    const candidates = toggleCandidateSelection(this.data.heatmapCandidates, id);
    this.setData({
      heatmapCandidates: candidates,
      selectedCandidateCount: countSelectedCandidates(candidates, this.data.customCandidates),
    });
  },

  toggleCustomCandidateSelect(e) {
    haptics.light();
    const id = resolveCandidateId(
      this.data.customCandidates,
      e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : "",
    );
    if (!id) return;
    const customCandidates = toggleCandidateSelection(this.data.customCandidates, id);
    this.setData({
      customCandidates,
      selectedCandidateCount: countSelectedCandidates(this.data.heatmapCandidates, customCandidates),
    });
  },

  goToCouponsForCandidates() {
    this.closeCandidateDrawer();
    wx.switchTab({ url: "/pages/coupons/index" });
  },

  copyHeatmapCandidateVoteText() {
    const items = getCandidateVoteItems(this.data.heatmapCandidates, this.data.customCandidates);
    if (!items.length) {
      wx.showToast({ title: "请先添加或勾选候选", icon: "none" });
      return;
    }
    const text = buildCandidateVoteText(items);
    if (!text) {
      wx.showToast({ title: "候选内容无效，请重新添加", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => {
        if (this.hidden || this.unloaded) return;
        wx.showToast({ title: "投票文案已复制", icon: "success" });
        this.closeCandidateDrawer();
      },
      fail: () => {
        if (!this.hidden && !this.unloaded) wx.showToast({ title: "投票文案复制失败", icon: "none" });
      },
    });
  },
};
