const privacyService = require("../../../utils/privacyService.js");
const cloudService = require("../../../utils/services/cloudService.js");
const { buildPrivacyView } = require("../profileHelper.js");

module.exports = {
  refreshPrivacySettings() {
    this.setData({ privacy: buildPrivacyView() }, () => {
      if (!this.unloaded && !this.hidden) this.updateSummaries();
    });
  },

  toggleCloudUpload(e) {
    const enabled = Boolean(e.detail.value);
    if (enabled && !cloudService.isCloudReady()) {
      this.refreshPrivacySettings();
      wx.showModal({
        title: "云端增强未配置",
        content: "当前版本尚未配置云环境，已继续保持本地保护模式。",
        showCancel: false,
      });
      return;
    }
    const saved = privacyService.saveSettings({ localOnly: !enabled, cloudUploadEnabled: enabled });
    this.refreshPrivacySettings();
    wx.showToast({
      title: saved ? (enabled ? "已开启云端增强" : "已切回本地保护") : "设置保存失败",
      icon: "none",
    });
  },

  toggleAttachmentEncryption(e) {
    const enabled = Boolean(e.detail.value);
    const saved = privacyService.saveSettings({ encryptAttachments: enabled });
    this.refreshPrivacySettings();
    wx.showToast({ title: saved ? (enabled ? "截图加密已开" : "截图加密已关") : "设置保存失败", icon: "none" });
  },
};
