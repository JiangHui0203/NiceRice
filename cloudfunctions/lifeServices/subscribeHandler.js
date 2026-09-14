const {
  cloud,
  https,
  db,
  INVITE_TTL_MS,
  INVITE_RECORD_ACTIVE,
  INVITE_RECORD_REVOKED,
  MAX_PROVIDER_RESPONSE_BYTES,
  MAX_OCR_TEXT_LENGTH,
  MAX_EVENT_DATA_BYTES,
  INVITE_STATUSES,
  SHAREABLE_PLAN_STATUSES,
  RESERVATION_STATUSES,
  rateLimitBuckets,
  serviceErrors,
  ACTION_DATA_FIELDS,
  ROUTE_MODES,
  normalizeRouteMode,
  createError,
  isRecord,
  mergeRecords,
  normalizeEvent,
  boundedText,
} = require("./serviceContext.js");
const {
  isAllowedOcrFileId,
  enforceRateLimit,
  enforceEventRateLimit,
} = require("./serviceSecurity.js");

async function sendSubscribeMessage(event = {}) {
  const data = event.data || {};
  if (data.templateId !== undefined && data.templateId !== null && typeof data.templateId !== "string") {
    throw createError("invalid_template", "订阅消息模板 ID 无效");
  }
  const rawTemplateId = String(data.templateId === undefined || data.templateId === null ? "" : data.templateId).trim();
  if (rawTemplateId.length > 128 || /[\u0000-\u001F\u007F]/.test(rawTemplateId)) {
    throw createError("invalid_template", "订阅消息模板 ID 无效");
  }
  const templateId = rawTemplateId;
  if (!templateId) {
    throw createError("missing_template", "缺少订阅消息模板 ID");
  }
  const wxContext = enforceEventRateLimit("sendSubscribeMessage", 10);
  const currentOpenid = wxContext.OPENID || "";
  if (!currentOpenid) {
    throw createError("missing_openid", "无法识别当前用户");
  }
  if (data.openid && data.openid !== currentOpenid) {
    throw createError("unauthorized_recipient", "只能向当前用户发送订阅消息");
  }
  if (data.page !== undefined && data.page !== null && typeof data.page !== "string") {
    throw createError("invalid_page", "订阅消息页面路径无效");
  }
  const rawPage = String(data.page || "pages/plan/index").trim();
  if (rawPage.length > 512) throw createError("invalid_page", "订阅消息页面路径无效");
  const page = rawPage;
  if (!/^pages\/[A-Za-z0-9_/-]+(?:\?[A-Za-z0-9_%=&.-]*)?$/.test(page) || page.indexOf("..") > -1) {
    throw createError("invalid_page", "订阅消息页面路径无效");
  }
  const messageData = data.messageData;
  if (!messageData || typeof messageData !== "object" || Array.isArray(messageData)) {
    throw createError("invalid_message", "订阅消息内容无效");
  }
  const messageKeys = Object.keys(messageData);
  if (!messageKeys.length || messageKeys.length > 20) {
    throw createError("invalid_message", "订阅消息字段数量无效");
  }
  const normalizedMessageData = {};
  messageKeys.forEach((key) => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(key)) {
      throw createError("invalid_message", "订阅消息字段名无效");
    }
    const item = messageData[key];
    if (!isRecord(item) || Object.keys(item).some((itemKey) => itemKey !== "value")) {
      throw createError("invalid_message", "订阅消息字段格式无效");
    }
    if (typeof item.value !== "string" && typeof item.value !== "number") {
      throw createError("invalid_message", "订阅消息字段内容无效");
    }
    const value = String(item.value).trim();
    if (!value || value.length > 128 || /[\u0000-\u001F\u007F]/.test(value)) {
      throw createError("invalid_message", "订阅消息字段内容无效");
    }
    normalizedMessageData[key] = { value };
  });
  let serializedMessage = "";
  try {
    serializedMessage = JSON.stringify(normalizedMessageData);
  } catch (error) {
    throw createError("invalid_message", "订阅消息内容无法解析");
  }
  if (serializedMessage.length > 16 * 1024) {
    throw createError("message_too_large", "订阅消息内容过大");
  }
  if (data.miniprogramState !== undefined && data.miniprogramState !== null && data.miniprogramState !== ""
    && !["developer", "trial", "formal"].includes(data.miniprogramState)) {
    throw createError("invalid_miniprogram_state", "小程序发布状态无效");
  }
  const configuredState = process.env.MINIPROGRAM_STATE || "formal";
  if (!["developer", "trial", "formal"].includes(configuredState)) {
    throw createError("invalid_cloud_config", "云函数订阅消息发布状态配置无效");
  }
  const miniprogramState = data.miniprogramState || configuredState;
  if (!cloud.openapi || !cloud.openapi.subscribeMessage
    || typeof cloud.openapi.subscribeMessage.send !== "function") {
    throw createError("subscribe_unsupported", "当前云环境未开通订阅消息能力");
  }
  const result = await cloud.openapi.subscribeMessage.send({
    touser: currentOpenid,
    templateId,
    page,
    data: normalizedMessageData,
    miniprogramState,
  });
  if (!isRecord(result)) throw createError("invalid_response", "订阅消息服务返回内容无效");
  const resultCode = result.errCode !== undefined ? result.errCode : result.errcode;
  if (resultCode === undefined) throw createError("invalid_response", "订阅消息服务返回内容无效");
  if (Number(resultCode) !== 0) {
    throw createError("provider_error", "订阅消息发送失败");
  }
  return {
    provider: "wechat_subscribe_message",
    errCode: 0,
    errMsg: boundedText(result.errMsg || result.errmsg, 128),
  };
}

module.exports = {
  sendSubscribeMessage,
};
