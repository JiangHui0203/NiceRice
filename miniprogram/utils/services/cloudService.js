const { getWx } = require("../wechatRuntime.js");

function getGlobalData() {
  try {
    if (typeof getApp !== "function") return {};
    const app = getApp();
    return app && app.globalData || {};
  } catch (e) {
    return {};
  }
}

function buildError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getConfiguredCloudEnv() {
  const env = getGlobalData().env;
  if (typeof env !== "string") return "";
  const normalized = env.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(normalized)) return "";
  return normalized;
}

function isCloudReady() {
  const api = getWx();
  const globalData = getGlobalData();
  return Boolean(
    api
    && api.cloud
    && typeof api.cloud.callFunction === "function"
    && getConfiguredCloudEnv()
    && globalData.cloudReady === true
  );
}

function getCloudUnavailableError(actionName = "云端功能") {
  const api = getWx();
  if (!api || !api.cloud) {
    return buildError("cloud_unsupported", "当前环境不支持微信云能力。");
  }
  const action = String(actionName || "云端功能").trim().slice(0, 32) || "云端功能";
  if (!getConfiguredCloudEnv()) {
    return buildError(
      "cloud_not_configured",
      `${action}需要先在 app.js 配置云环境 ID，并部署 lifeServices 云函数。当前仅保留本地占位，不会伪装成云端成功。`,
    );
  }
  if (typeof api.cloud.callFunction !== "function") {
    return buildError("cloud_unsupported", "当前环境不支持调用微信云函数。");
  }
  if (!isCloudReady()) {
    return buildError("cloud_not_initialized", `${action}的云环境尚未初始化完成。`);
  }
  return null;
}

module.exports = {
  getConfiguredCloudEnv,
  getCloudUnavailableError,
  isCloudReady,
};
