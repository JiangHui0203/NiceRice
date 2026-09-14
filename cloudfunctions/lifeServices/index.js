const part1 = require("./serviceContext.js");
const part2 = require("./inviteProtocol.js");
const part3 = require("./inviteRepository.js");
const part4 = require("./serviceSecurity.js");
const part5 = require("./providerHttp.js");
const part6 = require("./routeHandlers.js");
const part7 = require("./ocrHandler.js");
const part8 = require("./inviteCreateRead.js");
const part9 = require("./inviteMutationHandlers.js");
const part10 = require("./subscribeHandler.js");

const parts = Object.assign({}, part1, part2, part3, part4, part5, part6, part7, part8, part9, part10);
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
  dateValue,
  getInviteExpiry,
  isInviteExpired,
  isInviteRevoked,
  buildRevokedInvitePatch,
  normalizeInviteStatus,
  normalizeInviteId,
  normalizeRequestedInviteId,
  normalizePlanId,
  normalizePlanUpdatedAt,
  normalizeRecordTimestamp,
  normalizeInviteDate,
  normalizeInviteClock,
  normalizeInviteSelectedTime,
  normalizePlanText,
  normalizePlanTimestamp,
  normalizeFriendName,
  normalizeInvitePlanSnapshot,
  validateInvitePlanSnapshot,
  validateInviteSelectedTime,
  comparePlanUpdatedAt,
  getUpdatedCount,
  addPlanVersionCondition,
  addActiveInviteCondition,
  addUnexpiredInviteCondition,
  buildInviteRefreshPatch,
  normalizeProposalTime,
  buildInviteContentFingerprint,
  sameJson,
  sameSelectedTime,
  sameInviteRevisionContent,
  findInviteById,
  refreshOwnedInvite,
  revokeInviteIfUnchanged,
  insertRevokedInviteTombstone,
  getMutableInviteOrThrow,
  isAllowedOcrFileId,
  enforceRateLimit,
  enforceEventRateLimit,
  toNumber,
  normalizePoint,
  buildQuery,
  requestJson,
  durationToMinutes,
  formatDistance,
  formatRouteText,
  getProviderKey,
  getTencentKey,
  getAmapKey,
  normalizeRouteText,
  buildReverseGeocodeLocation,
  reverseGeocodeTencent,
  estimateTencentRoute,
  getAmapRouteUrl,
  estimateAmapRoute,
  estimateRoute,
  extractOcrText,
  recognizeCouponImage,
  createPlanInvite,
  toPublicInvite,
  getPlanInvite,
  updatePlanInvite,
  proposePlanInviteTime,
  deletePlanInvite,
  sendSubscribeMessage,
} = parts;

exports.main = async (rawEvent = {}) => {
  let event = rawEvent;
  try {
    event = normalizeEvent(rawEvent);
    if (event.type === "getOpenId") {
      const wxContext = enforceEventRateLimit("getOpenId", 120);
      return {
        success: true,
        openid: wxContext.OPENID,
      };
    }
    if (event.type === "estimateRoute") {
      enforceEventRateLimit("estimateRoute", 30);
      const route = await estimateRoute(event);
      return {
        success: true,
        route,
      };
    }
    if (event.type === "reverseGeocode") {
      enforceEventRateLimit("reverseGeocode", 30);
      return {
        success: true,
        location: await reverseGeocodeTencent(event.data || {}),
      };
    }
    if (event.type === "recognizeCouponImage") {
      return Object.assign({ success: true }, await recognizeCouponImage(event));
    }
    if (event.type === "createPlanInvite") {
      return Object.assign({ success: true }, await createPlanInvite(event));
    }
    if (event.type === "updatePlanInvite") {
      return Object.assign({ success: true }, await updatePlanInvite(event));
    }
    if (event.type === "proposePlanInviteTime") {
      return Object.assign({ success: true }, await proposePlanInviteTime(event));
    }
    if (event.type === "getPlanInvite") {
      return {
        success: true,
        invite: await getPlanInvite(event),
      };
    }
    if (event.type === "deletePlanInvite") {
      return Object.assign({ success: true }, await deletePlanInvite(event));
    }
    if (event.type === "sendSubscribeMessage") {
      return Object.assign({ success: true }, await sendSubscribeMessage(event));
    }
    return {
      success: false,
      code: "unknown_type",
      message: "未知服务类型",
    };
  } catch (error) {
    const isServiceError = Boolean(error && typeof error === "object" && serviceErrors.has(error));
    if (!isServiceError) {
      console.error(
        "lifeServices call failed",
        boundedText(event && event.type, 64),
        boundedText(error && error.code, 64) || "unknown",
      );
    }
    return {
      success: false,
      code: isServiceError ? boundedText(error.code, 64) : "service_failed",
      message: isServiceError ? boundedText(error.message, 256) : "公共服务调用失败，请稍后重试",
    };
  }
};

exports.__test__ = {
  INVITE_TTL_MS,
  INVITE_RECORD_ACTIVE,
  INVITE_RECORD_REVOKED,
  MAX_EVENT_DATA_BYTES,
  boundedText,
  dateValue,
  getInviteExpiry,
  isInviteExpired,
  isInviteRevoked,
  buildRevokedInvitePatch,
  normalizeInviteStatus,
  normalizeInviteId,
  normalizeRequestedInviteId,
  normalizeInviteDate,
  normalizeInviteClock,
  normalizeInvitePlanSnapshot,
  normalizeInviteSelectedTime,
  validateInviteSelectedTime,
  validateInvitePlanSnapshot,
  normalizeRouteMode,
  normalizeEvent,
  normalizePlanId,
  normalizePlanUpdatedAt,
  comparePlanUpdatedAt,
  getUpdatedCount,
  buildInviteRefreshPatch,
  buildInviteContentFingerprint,
  sameInviteRevisionContent,
  normalizeProposalTime,
  isAllowedOcrFileId,
  enforceRateLimit,
  rateLimitBuckets,
};
