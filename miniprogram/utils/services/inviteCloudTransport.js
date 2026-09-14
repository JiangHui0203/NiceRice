const privacyService = require("../privacyService.js");
const cloudService = require("./cloudService.js");
const { getWx } = require("../wechatRuntime.js");

function callCloud(type, data) {
  return new Promise((resolve, reject) => {
    if (!privacyService.isCloudUploadAllowed()) {
      reject(privacyService.buildPrivacyBlockedError("隐私模式下不会把计划邀请同步到云端。"));
      return;
    }
    const cloudError = cloudService.getCloudUnavailableError("邀请同步");
    if (cloudError) {
      reject(cloudError);
      return;
    }
    const api = getWx();
    if (!api || !api.cloud || typeof api.cloud.callFunction !== "function") {
      reject(new Error("当前环境不支持云函数"));
      return;
    }
    api.cloud.callFunction({
      name: "lifeServices",
      data: { type, data },
      success(res) {
        const result = res && res.result || {};
        if (!result.success) {
          const error = new Error(result.message || "邀请同步失败");
          error.code = result.code || "invite_failed";
          reject(error);
          return;
        }
        resolve(result);
      },
      fail: reject,
    });
  });
}

module.exports = {
  callCloud,
};
