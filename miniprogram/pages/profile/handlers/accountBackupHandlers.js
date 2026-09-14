const {
  buildPrivacyView,
  exportBackupToClipboard,
  importBackupFromClipboard,
  performWechatLogin,
  updateAvatar,
  updateNickname,
} = require("../profileHelper.js");

module.exports = {
  handleProfileCardTap() {
    if ((this.data.userInfo && this.data.userInfo.loggedIn) || this.loginPending) return;
    const loginToken = (this.loginToken || 0) + 1;
    this.loginToken = loginToken;
    this.loginPending = true;
    wx.showLoading({ title: "绑定微信中..." });
    performWechatLogin().then((userInfo) => {
      if (this.unloaded || this.hidden || loginToken !== this.loginToken) return;
      this.setData({ userInfo, privacy: buildPrivacyView() });
      wx.showToast({
        title: userInfo.isCloudBound ? "绑定微信成功" : "已启用本地身份",
        icon: userInfo.isCloudBound ? "success" : "none",
      });
    }).catch(() => {
      if (this.unloaded || this.hidden || loginToken !== this.loginToken) return;
      wx.showToast({ title: "微信登录失败", icon: "none" });
    }).finally(() => {
      if (loginToken !== this.loginToken) return;
      this.loginPending = false;
      wx.hideLoading();
    });
  },

  onChooseAvatar(e) {
    if (this.avatarSaving) return;
    this.avatarSaving = true;
    updateAvatar(this.data.userInfo, e.detail.avatarUrl).then((userInfo) => {
      if (this.unloaded || this.hidden) return;
      this.setData({ userInfo });
      wx.showToast({ title: "头像已更新", icon: "success" });
    }).catch(() => {
      if (this.unloaded || this.hidden) return;
      wx.showToast({ title: "头像保存失败，请重试", icon: "none" });
    }).finally(() => {
      this.avatarSaving = false;
    });
  },

  onNicknameBlur(e) {
    const userInfo = updateNickname(this.data.userInfo, e.detail.value);
    if (!userInfo) {
      wx.showToast({ title: "昵称保存失败，请重试", icon: "none" });
      return;
    }
    this.setData({ userInfo });
  },

  exportBackupData() {
    exportBackupToClipboard(() => !this.unloaded && !this.hidden);
  },

  importBackupData() {
    importBackupFromClipboard(() => {
      if (!this.unloaded && !this.hidden) this.onShow();
    }, () => !this.unloaded && !this.hidden);
  },
};
