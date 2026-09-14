const assert = require("assert");

const storage = new Map();
let modal = null;
let toast = null;
let savedAvatarTempPath = "";
let removedAvatarPath = "";

global.getApp = () => ({ globalData: { cloudReady: false } });
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  getStorageInfoSync() { return { keys: [], currentSize: 0 }; },
  showModal(options) { modal = options; },
  showToast(options) { toast = options; },
  saveFile(options) {
    savedAvatarTempPath = options.tempFilePath;
    options.success({ savedFilePath: "wxfile://usr/avatar-current.jpg" });
  },
  removeSavedFile(options) {
    removedAvatarPath = options.filePath;
    if (options.success) options.success();
  },
};

const cloudService = require("../../utils/services/cloudService.js");
const privacyService = require("../../utils/privacyService.js");
const profileHelper = require("./profileHelper.js");
const privacyHandlers = require("./handlers/privacyHandlers.js");

const originalIsCloudReady = cloudService.isCloudReady;
const originalSaveSettings = privacyService.saveSettings;

async function run() {
  let savedSettings = null;
  cloudService.isCloudReady = () => false;
  privacyService.saveSettings = (settings) => {
    savedSettings = settings;
    return true;
  };

  const page = Object.assign({}, privacyHandlers, {
    data: { privacy: {} },
    setData(patch, callback) {
      Object.assign(this.data, patch);
      if (callback) callback();
    },
    updateSummaries() {},
  });

  privacyHandlers.toggleCloudUpload.call(page, { detail: { value: true } });
  assert.strictEqual(savedSettings, null, "an unavailable cloud environment must not be persisted as enabled");
  assert.ok(modal && /未配置|不可用/.test(`${modal.title}${modal.content}`));

  cloudService.isCloudReady = () => true;
  privacyHandlers.toggleCloudUpload.call(page, { detail: { value: true } });
  assert.deepStrictEqual(savedSettings, { localOnly: false, cloudUploadEnabled: true });
  assert.ok(toast && /云端增强/.test(toast.title));

  storage.set("life_helper_privacy_settings", { localOnly: false, cloudUploadEnabled: true, encryptAttachments: true });
  const privacyView = profileHelper.buildPrivacyView();
  assert.strictEqual(privacyView.cloudEnabled, true, "the WXML cloud switch needs an explicit bound view field");

  const updatedUser = await profileHelper.updateAvatar({
    loggedIn: true,
    avatarUrl: "wxfile://usr/avatar-old.jpg",
  }, "/tmp/chosen-avatar.jpg");
  assert.strictEqual(savedAvatarTempPath, "/tmp/chosen-avatar.jpg");
  assert.strictEqual(updatedUser.avatarUrl, "wxfile://usr/avatar-current.jpg");
  assert.strictEqual(
    privacyService.readLocalData("life_helper_user_info", null).avatarUrl,
    "wxfile://usr/avatar-current.jpg",
  );
  assert.strictEqual(
    privacyService.isEncryptedRecord(storage.get("life_helper_user_info")),
    true,
    "avatar metadata must remain encrypted at rest",
  );
  assert.strictEqual(removedAvatarPath, "wxfile://usr/avatar-old.jpg");
}

run().finally(() => {
  cloudService.isCloudReady = originalIsCloudReady;
  privacyService.saveSettings = originalSaveSettings;
}).then(() => {
  console.log("profile privacy and media tests ok");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
