const friendStore = require("../../../utils/friendStore.js");
const {
  addFriendService,
  addFriendSlotService,
  addFriendRestrictionService,
  removeFriendSlotService,
  removeFriendRestrictionService,
  updateFriendTravelService,
  removeFriendService,
  formatFriendsForView,
} = require("../profileHelper.js");

function resolveFriendIdentity(page, rawIdentity) {
  if (typeof rawIdentity !== "string" || rawIdentity !== rawIdentity.trim()) return "";
  const friends = Array.isArray(page.allFriends) ? page.allFriends : [];
  const matched = friends.find((friend) => friend && friend.id && friend.id === rawIdentity)
    || friends.find((friend) => friend && !friend.id && friend.name === rawIdentity);
  return matched ? (matched.id || matched.name) : "";
}

module.exports = {
  onFriendDraftInput(e) {
    const field = e.currentTarget.dataset.field;
    const limits = {
      friendDraftName: 24,
      friendDraftRegion: 64,
      friendDraftRestrictions: 256,
    };
    if (!Object.prototype.hasOwnProperty.call(limits, field)) return;
    this.setData({ [field]: String(e.detail.value || "").slice(0, limits[field]) });
  },

  addFriend() {
    const { friendDraftName, friendDraftRegion, friendDraftRestrictions } = this.data;
    const name = String(friendDraftName || "").trim();
    if (!name) {
      wx.showToast({ title: "请先输入朋友名字", icon: "none" });
      return;
    }
    const result = addFriendService(name);
    if (!result.success) {
      wx.showToast({ title: result.error || "好友保存失败", icon: "none" });
      return;
    }

    const friendId = result.friend && result.friend.id ? result.friend.id : name;
    const failedSupplementalFields = [];
    if (friendDraftRegion && String(friendDraftRegion).trim()) {
      const regionResult = updateFriendTravelService(friendId, `常驻: ${String(friendDraftRegion).trim()}`);
      if (!regionResult.success) failedSupplementalFields.push("常驻地区");
    }
    if (friendDraftRestrictions && String(friendDraftRestrictions).trim()) {
      const restrictions = String(friendDraftRestrictions).split(/[,，、 ]+/).filter(Boolean);
      let restrictionFailed = false;
      restrictions.forEach((restriction) => {
        if (!addFriendRestrictionService(friendId, restriction).success) restrictionFailed = true;
      });
      if (restrictionFailed) failedSupplementalFields.push("饮食忌口");
    }

    this.applyFriendCollection(formatFriendsForView(friendStore.readFriends()), {
      friendDraftName: "",
      friendDraftRegion: "",
      friendDraftRestrictions: "",
    }, () => {
      if (this.unloaded || this.hidden) return;
      this.updateSummaries();
      if (failedSupplementalFields.length) {
        const failedLabel = failedSupplementalFields.length === 1
          ? failedSupplementalFields[0]
          : "部分资料";
        wx.showToast({ title: `好友已添加，${failedLabel}保存失败`, icon: "none" });
        return;
      }
      wx.showToast({ title: "好友已添加", icon: "success" });
    });
  },

  addFriendSlot(e) {
    const id = resolveFriendIdentity(this, e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "");
    if (!id) return;
    wx.showModal({
      title: "添加可约时段",
      editable: true,
      placeholderText: "例如：周五 18:30-22:00",
      success: (res) => {
        if (!res.confirm || !res.content || this.unloaded || this.hidden) return;
        const result = addFriendSlotService(id, res.content);
        if (!result.success) {
          wx.showToast({ title: result.error || "时段保存失败", icon: "none" });
          return;
        }
        this.applyFriendCollection(result.friends, {}, () => {
          if (!this.unloaded && !this.hidden) this.updateSummaries();
        });
      },
    });
  },

  addFriendRestriction(e) {
    const id = resolveFriendIdentity(this, e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "");
    if (!id) return;
    wx.showModal({
      title: "添加饮食忌口",
      editable: true,
      placeholderText: "例如：不吃辣、不吃羊肉",
      success: (res) => {
        if (!res.confirm || !res.content || this.unloaded || this.hidden) return;
        const result = addFriendRestrictionService(id, res.content);
        if (!result.success) {
          wx.showToast({ title: result.error || "忌口保存失败", icon: "none" });
          return;
        }
        this.applyFriendCollection(result.friends, {}, () => {
          if (!this.unloaded && !this.hidden) this.updateSummaries();
        });
      },
    });
  },

  removeFriendSlot(e) {
    const { friendId, slot } = e.currentTarget.dataset;
    const exactFriendId = resolveFriendIdentity(this, friendId);
    if (!exactFriendId) return;
    wx.showModal({
      title: "确认删除时段",
      content: `是否删除「${slot}」？`,
      success: (res) => {
        if (!res.confirm || this.unloaded || this.hidden) return;
        const result = removeFriendSlotService(this.data.friends, exactFriendId, slot);
        if (!result.success) {
          wx.showToast({ title: result.error || "删除时段失败", icon: "none" });
          return;
        }
        this.applyFriendCollection(result.friends, {}, () => {
          if (!this.unloaded && !this.hidden) this.updateSummaries();
        });
      },
    });
  },

  removeFriendRestriction(e) {
    const { friendId, restriction } = e.currentTarget.dataset;
    const exactFriendId = resolveFriendIdentity(this, friendId);
    if (!exactFriendId) return;
    wx.showModal({
      title: "确认删除忌口",
      content: `是否删除「${restriction}」？`,
      success: (res) => {
        if (!res.confirm || this.unloaded || this.hidden) return;
        const result = removeFriendRestrictionService(this.data.friends, exactFriendId, restriction);
        if (!result.success) {
          wx.showToast({ title: result.error || "删除忌口失败", icon: "none" });
          return;
        }
        this.applyFriendCollection(result.friends, {}, () => {
          if (!this.unloaded && !this.hidden) this.updateSummaries();
        });
      },
    });
  },

  editFriendTravel(e) {
    const friendId = resolveFriendIdentity(this, e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "");
    if (!friendId) return;
    const options = ["单程不超过 15 分钟", "单程不超过 30 分钟", "单程不超过 45 分钟", "单程不超过 60 分钟", "无限制"];
    wx.showActionSheet({
      itemList: options,
      success: (res) => {
        if (this.unloaded || this.hidden || !options[res.tapIndex]) return;
        const result = updateFriendTravelService(friendId, options[res.tapIndex]);
        if (!result.success) {
          wx.showToast({ title: result.error || "出行偏好保存失败", icon: "none" });
          return;
        }
        this.applyFriendCollection(result.friends, {}, () => {
          if (this.unloaded || this.hidden) return;
          this.updateSummaries();
          wx.showToast({ title: "已更新出行偏好", icon: "success" });
        });
      },
    });
  },

  removeFriend(e) {
    const friendId = resolveFriendIdentity(this, e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "");
    if (!friendId) return;
    const friendName = e.currentTarget.dataset.name || friendId;
    wx.showModal({
      title: "移除好友档案",
      content: `确定要移除好友「${friendName}」吗？`,
      confirmColor: "#dc2626",
      confirmText: "确定移除",
      cancelText: "取消",
      success: (res) => {
        if (!res.confirm || this.unloaded || this.hidden) return;
        const result = removeFriendService(friendId);
        if (!result.success) {
          wx.showToast({ title: result.error || "好友移除失败", icon: "none" });
          return;
        }
        this.applyFriendCollection(result.friends, {}, () => {
          if (this.unloaded || this.hidden) return;
          this.updateSummaries();
          wx.showToast({ title: "已移除", icon: "none" });
        });
      },
    });
  },
};
