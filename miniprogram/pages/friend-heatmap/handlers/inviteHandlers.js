const friendStore = require("../../../utils/friendStore.js");
const haptics = require("../../../utils/haptics.js");
const privacyService = require("../../../utils/privacyService.js");
const {
  buildExportableSlots,
  buildSharePayload,
  formatBulkInviteText,
  getStoredVotes,
  saveBulkSlotsToPlans,
} = require("../heatmapHelper.js");
const { buildCandidateShareData } = require("../candidateHelper.js");
const {
  buildInviteShareText,
  buildSimulatedFriendDraft,
} = require("../collaborationShareHelper.js");

module.exports = {
  openInviteShareDrawer() {
    haptics.light();
    this.setData({ showInviteShareDrawer: true });
  },

  closeInviteShareDrawer() {
    this.setData({ showInviteShareDrawer: false });
  },

  copyInviteShareText() {
    haptics.light();
    const text = buildInviteShareText(this.data.selfName || "我", this.data.selfSlots || []);
    wx.setClipboardData({
      data: text,
      success: () => {
        if (this.hidden || this.unloaded) return;
        wx.showToast({ title: "邀请文案已复制", icon: "success" });
        this.closeInviteShareDrawer();
      },
      fail: () => {
        if (!this.hidden && !this.unloaded) wx.showToast({ title: "邀请文案复制失败", icon: "none" });
      },
    });
  },

  simulateFriendCollaboration() {
    haptics.medium();
    const draft = buildSimulatedFriendDraft(friendStore.readFriends() || []);
    const friend = friendStore.addFriend(draft.name);
    if (!friend || !friendStore.updateFriend(friend.id, { slots: draft.slots })) {
      if (friend) friendStore.removeFriend(friend.id);
      wx.showToast({ title: "测试好友保存失败，请重试", icon: "none" });
      return;
    }
    this.loadData();
    wx.showToast({ title: `已生成测试好友【${draft.name}】`, icon: "success" });
    this.closeInviteShareDrawer();
  },

  onShareAppMessage() {
    if (this.data.showCandidateDrawer) {
      return buildCandidateShareData(this.data.heatmapCandidates, this.data.customCandidates);
    }
    let storedSelfId = "";
    try { storedSelfId = privacyService.readLocalData("life_helper_self_id", "") || ""; } catch (error) {}
    return buildSharePayload(
      this.data.selfName || "我",
      this.data.selfSlots || [],
      this.data.selfId || storedSelfId
    );
  },

  openBulkExportDrawer() {
    const allVotes = getStoredVotes();
    const heatmapRows = Array.isArray(this.heatmapRowsFull) ? this.heatmapRowsFull : this.data.heatmapRows;
    const exportableSlots = buildExportableSlots(this.data.scenes, heatmapRows, allVotes);
    this.setData({ showBulkExportDrawer: true, exportableSlots });
  },

  closeBulkExportDrawer() {
    this.setData({ showBulkExportDrawer: false, exportableSlots: [] });
  },

  toggleBulkExportSlot(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.key
      : "";
    if (typeof key !== "string" || !(this.data.exportableSlots || []).some((slot) => slot && slot.key === key)) return;
    const exportableSlots = this.data.exportableSlots.map((slot) => (
      slot.key === key ? Object.assign({}, slot, { checked: !slot.checked }) : slot
    ));
    this.setData({ exportableSlots });
  },

  toggleBulkExportOption(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.key
      : "";
    if (!Object.prototype.hasOwnProperty.call(this.data.bulkExportOptions || {}, key)) return;
    this.setData({
      bulkExportOptions: Object.assign({}, this.data.bulkExportOptions, {
        [key]: !this.data.bulkExportOptions[key],
      }),
    });
  },

  copyBulkInviteText() {
    const selectedSlots = this.data.exportableSlots.filter((slot) => slot.checked);
    if (!selectedSlots.length) {
      wx.showToast({ title: "请选择要导出的时段", icon: "none" });
      return;
    }
    const text = formatBulkInviteText(
      selectedSlots,
      this.data.scenes,
      Array.isArray(this.heatmapRowsFull) ? this.heatmapRowsFull : this.data.heatmapRows,
      this.data.bulkExportOptions.includeFriends
    );
    wx.setClipboardData({
      data: text,
      success: () => {
        if (this.hidden || this.unloaded) return;
        wx.showToast({ title: "本周日程已复制", icon: "success" });
        this.closeBulkExportDrawer();
      },
      fail: () => {
        if (!this.hidden && !this.unloaded) wx.showToast({ title: "本周日程复制失败", icon: "none" });
      },
    });
  },

  saveBulkToMyPlans() {
    const selectedSlots = this.data.exportableSlots.filter((slot) => slot.checked);
    if (!selectedSlots.length) {
      wx.showToast({ title: "请选择要导出的时段", icon: "none" });
      return;
    }
    const result = saveBulkSlotsToPlans(
      selectedSlots,
      this.data.scenes,
      Array.isArray(this.heatmapRowsFull) ? this.heatmapRowsFull : this.data.heatmapRows,
      this.data.bulkExportOptions.includeFriends
    );
    if (!result.success && !result.partial) {
      wx.showToast({ title: "批量日程保存失败，请重试", icon: "none" });
      return;
    }
    wx.showModal({
      title: result.partial ? "部分日程导入成功" : "批量导入成功",
      content: result.partial
        ? `已写入 ${result.successIds.length} 项，另有 ${result.failedKeys.length} 项保存失败。`
        : `已成功将 ${result.successIds.length} 项日程计划写入您的日程表中！`,
      showCancel: false,
      success: () => {
        if (!this.hidden && !this.unloaded) this.closeBulkExportDrawer();
      },
    });
  },
};
