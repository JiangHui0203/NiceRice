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

function extractOcrText(result = {}) {
  const items = result.items || result.words_result || result.words || [];
  if (Array.isArray(items) && items.length) {
    const lines = [];
    let length = 0;
    items.slice(0, 2000).some((item) => {
      const value = item && (item.text || item.words || item.word);
      const line = typeof value === "string" || typeof value === "number"
        ? String(value).slice(0, 1000)
        : "";
      if (!line) return false;
      const remaining = MAX_OCR_TEXT_LENGTH - length - (lines.length ? 1 : 0);
      if (remaining <= 0) return true;
      lines.push(line.slice(0, remaining));
      length += Math.min(line.length, remaining) + (lines.length > 1 ? 1 : 0);
      return length >= MAX_OCR_TEXT_LENGTH;
    });
    return lines.join("\n");
  }
  const value = result.text || result.result || "";
  return (typeof value === "string" || typeof value === "number" ? String(value) : "")
    .slice(0, MAX_OCR_TEXT_LENGTH);
}

async function recognizeCouponImage(event = {}) {
  const fileID = event.data && event.data.fileID;
  if (!fileID) throw createError("missing_file", "缺少截图文件");
  if (!isAllowedOcrFileId(fileID)) {
    throw createError("invalid_file", "只能识别当前小程序 OCR 目录中的截图");
  }
  enforceEventRateLimit("recognizeCouponImage", 10);
  if (!cloud.openapi || !cloud.openapi.ocr || !cloud.openapi.ocr.printedText) {
    throw createError("ocr_unsupported", "当前云环境未开通微信 OCR 能力，可先使用粘贴识别");
  }
  let response = null;
  let temporaryFileDeleted = false;
  try {
    const temp = await cloud.getTempFileURL({
      fileList: [fileID],
    });
    const file = temp.fileList && temp.fileList[0];
    const imgUrl = file && file.tempFileURL;
    if (!imgUrl) throw createError("missing_file_url", "截图临时链接生成失败");
    const result = await cloud.openapi.ocr.printedText({
      imgUrl,
    });
    const text = extractOcrText(result);
    if (!text.trim()) throw createError("ocr_empty", "截图中没有识别到可用文字");
    response = {
      source: "wechat_ocr_printed_text",
      text,
    };
  } finally {
    if (cloud.deleteFile && typeof cloud.deleteFile === "function") {
      try {
        await cloud.deleteFile({ fileList: [fileID] });
        temporaryFileDeleted = true;
      } catch (error) {
        console.warn("OCR temporary file cleanup failed", boundedText(error && error.code, 64) || "unknown");
      }
    }
  }
  return Object.assign({}, response, { temporaryFileDeleted });
}

module.exports = {
  extractOcrText,
  recognizeCouponImage,
};
