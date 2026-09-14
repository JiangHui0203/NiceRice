const storageManager = require("./utils/storageManager.js");
const inviteService = require("./utils/services/inviteService.js");
const screenshotService = require("./utils/services/screenshotService.js");

const CLOUD_ENV_ID = "";

// app.js
App({
  globalData: {
    env: CLOUD_ENV_ID,
    cloudReady: false,
    version: "v0.7.4",
    userLocation: null,
    activeRouteOrigin: null,
  },

  onLaunch: function () {
    let storageReady = false;
    try {
      const migration = storageManager.migrateStorage();
      storageReady = Boolean(migration && migration.success);
    } catch (e) {
      console.error("Storage migration failed on startup:", e);
    }
    // Attachment references may still live in legacy plaintext storage until
    // migration finishes. Never run orphan cleanup against a partial view of
    // those references, otherwise a valid saved screenshot can be deleted.
    if (storageReady) screenshotService.cleanupOrphanedPreviews().catch(() => false);

    if (!CLOUD_ENV_ID) {
      console.info("云环境未配置，OCR、路线、邀请同步和订阅发送保持本地占位。");
    } else if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      const cloudConfig = {
        env: CLOUD_ENV_ID,
        traceUser: false,
      };
      wx.cloud.init(cloudConfig);
      this.globalData.cloudReady = true;
    }
  },

  onShow: function () {
    inviteService.flushInviteTombstones().catch(() => false);
    this.checkClipboardInvite();
  },

  checkClipboardInvite: function () {
    if (this._clipboardInvitePrompting || typeof wx === "undefined" || !wx.getClipboardData) return;
    wx.getClipboardData({
      success: (res) => {
        const text = String(res.data || "").trim();
        if (!text || text.length > 16384
          || (!text.includes("YS_INVITE_") && !text.includes("#YS_INVITE#") && !text.includes("有时好饭·聚餐邀约"))) return;

        // 匹配新格式 #YS_INVITE#inviteId#encodedData# 或兼容格式
        let inviteId = "";
        let planData = "";

        const matchNew = text.match(/#YS_INVITE#([^#]+)#([^#]+)#/);
        if (matchNew) {
          inviteId = matchNew[1];
          planData = matchNew[2];
        } else {
          // 兼容历史下划线分隔格式
          const matchLegacy = text.match(/#YS_INVITE_([A-Za-z0-9_-]+?)_(%7B.+|%5B.+|\{.+|\[.+)#/i);
          if (matchLegacy) {
            inviteId = matchLegacy[1];
            planData = matchLegacy[2];
          }
        }

        const validInviteId = typeof inviteId === "string"
          && /^[A-Za-z0-9_-]{6,96}$/.test(inviteId);
        if (validInviteId && planData && planData.length <= 4096) {
          this._clipboardInvitePrompting = true;
          wx.showModal({
            title: "📬 收到好友聚餐邀请",
            content: "检测到好友通过微信发送的聚餐邀约口令，是否立即查看并确认日程？",
            confirmText: "立即查看",
            cancelText: "稍后再看",
            success: (modalRes) => {
              if (modalRes.confirm) {
                wx.navigateTo({
                  url: `/pages/plan-detail/index?inviteId=${encodeURIComponent(inviteId)}&role=recipient&planData=${encodeURIComponent(planData)}`,
                  success: () => {
                    wx.setClipboardData({ data: "", fail: () => {} });
                  },
                  fail: () => {
                    wx.showToast({ title: "邀请页面打开失败，请重试", icon: "none" });
                  },
                });
              }
            },
            complete: () => {
              this._clipboardInvitePrompting = false;
            },
          });
        }
      },
      fail: () => {},
    });
  },
});
