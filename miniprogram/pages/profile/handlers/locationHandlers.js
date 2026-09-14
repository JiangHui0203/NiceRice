const locationService = require("../../../utils/services/locationService.js");
const {
  editLocationDraft,
  chooseLocationDraftPoint,
  saveLocationDraft,
  resetAllLocations,
} = require("../profileHelper.js");

module.exports = {
  editLocation(e) {
    const rawId = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "";
    const location = (Array.isArray(this.data.locations) ? this.data.locations : [])
      .find((item) => item && item.id === rawId);
    if (!location) return;
    const result = editLocationDraft(this.data.locations, location.id);
    if (result) this.setData(result);
  },

  cancelLocationEdit() {
    this.setData({ editingLocationId: "", locationDraft: {} });
  },

  onLocationDraftInput(e) {
    const field = e.currentTarget.dataset.field;
    const limits = { name: 48, address: 160, desc: 160 };
    if (!Object.prototype.hasOwnProperty.call(limits, field)) return;
    const value = String(e.detail.value || "").slice(0, limits[field]);
    this.setData({ [`locationDraft.${field}`]: value });
  },

  chooseLocationPoint() {
    chooseLocationDraftPoint(this.data.locationDraft).then((draft) => {
      if (this.unloaded || this.hidden) return;
      this.setData({ locationDraft: draft });
    }).catch((error) => {
      if (this.unloaded || this.hidden) return;
      if (locationService.isCancelError(error)) return;
      if (locationService.isPermissionError(error)) {
        wx.showModal({
          title: "需要位置权限",
          content: "选择地图点需要允许位置相关权限。也可以先手动填写地址。",
          showCancel: false,
        });
        return;
      }
      wx.showToast({ title: "选点失败，可手动填写", icon: "none" });
    });
  },

  saveLocation() {
    const result = saveLocationDraft(this.data.editingLocationId, this.data.locationDraft);
    if (!result.success) {
      wx.showToast({ title: result.error || "地点保存失败", icon: "none" });
      return;
    }
    this.setData({ locations: result.locations, editingLocationId: "", locationDraft: {} }, () => {
      if (this.unloaded || this.hidden) return;
      this.updateSummaries();
      wx.showToast({ title: "地点已保存", icon: "success" });
    });
  },

  resetLocations() {
    wx.showModal({
      title: "恢复默认地点",
      content: "会清空已填写的常用地点地址。",
      confirmText: "恢复",
      confirmColor: "#0f766e",
      success: (res) => {
        if (!res.confirm || this.unloaded || this.hidden) return;
        const result = resetAllLocations();
        if (!result.success) {
          wx.showToast({ title: result.error || "恢复默认地点失败", icon: "none" });
          return;
        }
        this.setData({ locations: result.locations, editingLocationId: "", locationDraft: {} }, () => {
          if (this.unloaded || this.hidden) return;
          this.updateSummaries();
          wx.showToast({ title: "已恢复默认地点", icon: "success" });
        });
      },
    });
  },
};
