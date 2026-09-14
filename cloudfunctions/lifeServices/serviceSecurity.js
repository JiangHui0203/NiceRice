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

function isAllowedOcrFileId(fileID) {
  const value = String(fileID || "");
  return value.length <= 512
    && /^cloud:\/\/[A-Za-z0-9._-]{3,256}\/ocr\/coupon_[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(value);
}

function enforceRateLimit(action, openid, limit, windowMs = 60 * 1000, now = Date.now()) {
  const identity = String(openid || "anonymous");
  const key = `${action}:${identity}`;
  const previous = rateLimitBuckets.get(key);
  const bucket = !previous || now - previous.startedAt >= windowMs
    ? { startedAt: now, count: 0 }
    : previous;
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  if (bucket.count > limit) {
    throw createError("rate_limited", "请求过于频繁，请稍后再试");
  }
  // Cloud function instances are reused. Bound the in-memory fallback so a
  // long-lived instance cannot accumulate identities forever.
  if (rateLimitBuckets.size > 1000) {
    for (const [bucketKey, value] of rateLimitBuckets) {
      if (now - value.startedAt >= windowMs) rateLimitBuckets.delete(bucketKey);
    }
    while (rateLimitBuckets.size > 1000) {
      rateLimitBuckets.delete(rateLimitBuckets.keys().next().value);
    }
  }
}

function enforceEventRateLimit(action, limit) {
  const context = cloud.getWXContext();
  if (!context || !context.OPENID) {
    throw createError("missing_openid", "无法识别当前用户");
  }
  enforceRateLimit(action, context.OPENID, limit);
  return context;
}

module.exports = {
  isAllowedOcrFileId,
  enforceRateLimit,
  enforceEventRateLimit,
};
