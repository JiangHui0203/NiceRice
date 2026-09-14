const haptics = require("../../../utils/haptics.js");
const friendStore = require("../../../utils/friendStore.js");
const { normalizeExactId } = require("../../../utils/idUtils.js");
const {
  WEEKDAYS,
  addFriend,
  addFriendSlot,
  addSelfSlot,
  createCustomScene,
  deleteFriendSlot,
  deleteSelfSlot,
  importFriendInvite,
  removeFriend,
  removeSceneById,
  saveCustomScenes,
  saveSelectedFriendIds,
  switchScenePreset,
  updateSelfName,
} = require("../heatmapHelper.js");

function findCurrentFriend(page, rawId) {
  const id = normalizeExactId(rawId);
  if (!id) return null;
  return (page.data.friends || []).find((friend) => friend && !friend.isSelf && friend.id === id) || null;
}

function findCurrentScene(page, rawId) {
  const id = normalizeExactId(rawId);
  if (!id) return null;
  return (page.data.scenes || []).find((scene) => scene && scene.id === id) || null;
}

module.exports = {
  openSettingsDrawer() {
    this.setData({ showSettingsDrawer: true });
  },

  closeSettingsDrawer() {
    this.setData({ showSettingsDrawer: false });
  },

  selectPreset(e) {
    haptics.light();
    const presetKey = e.currentTarget.dataset.key;
    const targetScenes = switchScenePreset(presetKey);
    if (!targetScenes) {
      wx.showToast({ title: "场景保存失败，请重试", icon: "none" });
      return;
    }

    this.setData({
      scenes: targetScenes,
      currentPresetKey: presetKey,
      activeDayIdx: null,
      activeSceneIdx: null,
    }, this.calculateHeatmap);
  },

  openFriendDrawer() {
    this.setData({ showFriendDrawer: true });
  },

  closeFriendDrawer() {
    this.setData({ showFriendDrawer: false });
  },

  onCustomSceneNameInput(e) {
    this.setData({ newCustomSceneName: String((e && e.detail && e.detail.value) || "").slice(0, 24) });
  },

  onCustomSceneStartChange(e) {
    this.setData({ newCustomSceneStart: e.detail.value });
  },

  onCustomSceneEndChange(e) {
    this.setData({ newCustomSceneEnd: e.detail.value });
  },

  onCustomSceneIconSelect(e) {
    const icon = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.icon
      : "";
    if (!(this.data.iconOptions || []).some((item) => item && item.name === icon)) return;
    this.setData({ newCustomSceneIcon: icon });
  },

  addCustomScene() {
    if ((this.data.scenes || []).length >= 12) {
      wx.showToast({ title: "最多添加 12 个时段", icon: "none" });
      return;
    }
    const result = createCustomScene({
      name: this.data.newCustomSceneName,
      icon: this.data.newCustomSceneIcon,
      start: this.data.newCustomSceneStart,
      end: this.data.newCustomSceneEnd,
    });
    if (!result.success) {
      wx.showToast({ title: result.error, icon: "none" });
      return;
    }
    if ((this.data.scenes || []).some((scene) => scene.name === result.scene.name)) {
      wx.showToast({ title: "该时段名称已存在", icon: "none" });
      return;
    }
    const scenes = this.data.scenes.concat(result.scene);
    if (!saveCustomScenes(scenes)) {
      wx.showToast({ title: "时段保存失败，请重试", icon: "none" });
      return;
    }
    this.setData({
      scenes,
      currentPresetKey: "custom",
      newCustomSceneName: "",
      newCustomSceneStart: "18:00",
      newCustomSceneEnd: "21:00",
      newCustomSceneIcon: "social",
      activeDayIdx: null,
      activeSceneIdx: null,
    }, this.calculateHeatmap);
    wx.showToast({ title: "成功添加时段", icon: "success" });
  },

  deleteScene(e) {
    if ((this.data.scenes || []).length <= 1) {
      wx.showToast({ title: "至少保留一个时段", icon: "none" });
      return;
    }
    const scene = findCurrentScene(this, e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "");
    if (!scene) return;
    const scenes = removeSceneById(this.data.scenes, scene.id);
    if (!scenes) {
      wx.showToast({ title: "时段删除失败，请重试", icon: "none" });
      return;
    }
    this.setData({ scenes, currentPresetKey: "custom", activeDayIdx: null, activeSceneIdx: null }, this.calculateHeatmap);
    wx.showToast({ title: "已删除该时段", icon: "none" });
  },

  onNewFriendNameInput(e) {
    this.setData({ newFriendName: String((e && e.detail && e.detail.value) || "").slice(0, 24) });
  },

  addLocalFriend() {
    const result = addFriend(this.data.newFriendName);
    if (!result.success) {
      wx.showToast({ title: result.error || "请输入姓名", icon: "none" });
      return;
    }
    this.setData({ newFriendName: "" });
    this.loadData();
    wx.showToast({ title: "成功添加好友", icon: "success" });
  },

  deleteFriend(e) {
    const friend = findCurrentFriend(this, e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "");
    if (!friend) return;
    const id = friend.id;
    wx.showModal({
      title: "确认删除好友",
      content: "删除后该好友的空档将不再显示，确定吗？",
      success: (result) => {
        if (this.hidden || this.unloaded) return;
        if (result.confirm) {
          if (!removeFriend(id)) {
            wx.showToast({ title: "好友删除失败，请重试", icon: "none" });
            return;
          }
          this.loadData();
          wx.showToast({ title: "已删除好友", icon: "none" });
        }
      },
    });
  },

  onNewSlotDayChange(e) {
    this.setData({ newSlotDay: WEEKDAYS[e.detail.value] });
  },

  onNewSlotStartChange(e) {
    this.setData({ newSlotStart: e.detail.value });
  },

  onNewSlotEndChange(e) {
    this.setData({ newSlotEnd: e.detail.value });
  },

  addFriendSlotInline(e) {
    const friend = findCurrentFriend(this, e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "");
    if (!friend) return;
    if (!addFriendSlot(friend.id, this.data.newSlotDay, this.data.newSlotStart, this.data.newSlotEnd)) {
      wx.showToast({ title: "空档保存失败，请重试", icon: "none" });
      return;
    }
    this.loadData();
    wx.showToast({ title: "已添加空档", icon: "success" });
  },

  deleteFriendSlotInline(e) {
    const dataset = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset : {};
    const friend = findCurrentFriend(this, dataset.id);
    const slot = typeof dataset.slot === "string" ? dataset.slot : "";
    if (!friend || !(friend.slots || []).includes(slot)) return;
    if (!deleteFriendSlot(friend.id, slot)) {
      wx.showToast({ title: "空档删除失败，请重试", icon: "none" });
      return;
    }
    this.loadData();
    wx.showToast({ title: "已删除空档", icon: "none" });
  },

  onSelfNameInput(e) {
    const selfName = updateSelfName(e.detail.value);
    if (!selfName) {
      wx.showToast({ title: "昵称保存失败，请重试", icon: "none" });
      return;
    }
    this.setData({ selfName });
    this.loadData();
  },

  addSelfSlotInline() {
    const selfSlots = addSelfSlot(this.data.selfSlots, this.data.newSlotDay, this.data.newSlotStart, this.data.newSlotEnd);
    if (!selfSlots) {
      wx.showToast({ title: "我的空档保存失败，请重试", icon: "none" });
      return;
    }
    this.setData({ selfSlots });
    this.loadData();
    wx.showToast({ title: "已添加我的空档", icon: "success" });
  },

  deleteSelfSlotInline(e) {
    const selfSlots = deleteSelfSlot(this.data.selfSlots, e.currentTarget.dataset.slot);
    if (!selfSlots) {
      wx.showToast({ title: "我的空档删除失败，请重试", icon: "none" });
      return;
    }
    this.setData({ selfSlots });
    this.loadData();
    wx.showToast({ title: "已删除我的空档", icon: "none" });
  },

  confirmImportInvite() {
    if (!this.data.inviteData) return;
    const name = this.data.inviteData.name;
    const success = importFriendInvite(this.data.inviteData, this.data.isInviteUpdate, this.data.existingFriendId);
    if (success) {
      let selectionSaved = true;
      const inviterId = this.data.inviteData.inviterId;
      const importedFriend = (friendStore.readFriends() || []).find((friend = {}) => (
        (inviterId && friend.inviterId === inviterId)
        || (this.data.existingFriendId && friend.id === this.data.existingFriendId)
        || (!this.data.isInviteUpdate && friend.name === name)
      ));
      if (importedFriend && importedFriend.id) {
        if (!saveSelectedFriendIds((this.data.selectedFriendIds || []).concat(importedFriend.id))) {
          selectionSaved = false;
        }
      }
      this.setData({
        showInviteModal: false,
        showInviteSuccessTip: true,
        inviteSuccessTip: selectionSaved
          ? `已成功${this.data.isInviteUpdate ? "更新" : "导入"}【${name}】的空档！现已在好友列表为您勾选并即时比对。`
          : `已成功${this.data.isInviteUpdate ? "更新" : "导入"}【${name}】的空档，但自动勾选未保存，请手动勾选后比对。`,
      });
      this.loadData();
      wx.showToast({
        title: selectionSaved
          ? (this.data.isInviteUpdate ? "空档已更新" : "导入成功")
          : "好友已导入，自动勾选失败",
        icon: selectionSaved ? "success" : "none",
      });
    } else {
      this.setData({ showInviteModal: false });
      wx.showToast({ title: "好友空档导入失败，请重试", icon: "none" });
    }
  },

  closeInviteModal() {
    this.setData({ showInviteModal: false });
  },

  closeInviteSuccessTip() {
    this.setData({ showInviteSuccessTip: false });
  },
};
