const { normalizeExactId } = require("../../utils/idUtils.js");
const { timestampValue } = require("./planSnapshotSelector.js");

function boundedText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function buildSharedPlanSnapshot(plan = {}) {
  const snapshot = {};
  [
    "id", "couponId", "category", "statusCode", "travelTime", "durationMinutes",
    "needReservation", "reservationStatus", "revision", "updatedAt", "createdAt",
  ].forEach((key) => {
    if (plan[key] !== undefined && plan[key] !== null) snapshot[key] = plan[key];
  });
  snapshot.id = normalizeSharedEntityId(plan.id);
  snapshot.couponId = plan.couponId ? normalizeSharedEntityId(plan.couponId) : "";
  snapshot.category = boundedText(plan.category, 24);
  snapshot.statusCode = boundedText(plan.statusCode, 24);
  snapshot.travelTime = boundedText(plan.travelTime, 32);
  if (snapshot.durationMinutes !== undefined) {
    const duration = Number(snapshot.durationMinutes);
    snapshot.durationMinutes = Number.isFinite(duration)
      ? Math.max(0, Math.min(24 * 60, Math.round(duration)))
      : undefined;
  }
  if (typeof snapshot.needReservation !== "boolean") delete snapshot.needReservation;
  snapshot.reservationStatus = boundedText(plan.reservationStatus, 24);
  snapshot.updatedAt = boundedText(plan.updatedAt, 40);
  snapshot.createdAt = boundedText(plan.createdAt, 40);
  if (snapshot.revision !== undefined) {
    const revision = Number(snapshot.revision);
    snapshot.revision = Number.isFinite(revision) ? revision : undefined;
  }
  snapshot.title = boundedText(plan.title, 48);
  snapshot.venue = boundedText(plan.venue || (plan.location && plan.location.name), 48);
  snapshot.address = boundedText(plan.address || (plan.location && plan.location.address), 96);
  const selectedTime = plan.selectedTime || {};
  snapshot.selectedTime = {};
  ["date", "weekday", "startTime", "endTime", "scene", "label"].forEach((key) => {
    if (selectedTime[key] !== undefined && selectedTime[key] !== null) {
      snapshot.selectedTime[key] = boundedText(selectedTime[key], key === "label" ? 48 : 24);
    }
  });
  if (snapshot.venue || snapshot.address) {
    snapshot.location = { name: snapshot.venue, address: snapshot.address };
  }
  return snapshot;
}

function buildSharedCouponSnapshot(coupon = {}) {
  const couponId = coupon && normalizeSharedEntityId(coupon.id);
  if (!couponId) return null;
  const rawPrice = coupon.price;
  const numericPrice = rawPrice === undefined || rawPrice === null || rawPrice === "" ? null : Number(rawPrice);
  return {
    id: couponId,
    title: boundedText(coupon.title, 48),
    venue: boundedText(coupon.venue || coupon.merchantName, 48),
    address: boundedText(coupon.address, 96),
    price: numericPrice !== null && Number.isFinite(numericPrice) ? numericPrice : undefined,
    category: boundedText(coupon.category || coupon.type, 24),
    statusCode: boundedText(coupon.statusCode, 24),
  };
}

function buildSharedInviteSnapshot(invite = {}, inviteId = "") {
  const safeInviteId = normalizeSharedInviteId(inviteId || invite.inviteId || invite.id);
  return {
    id: safeInviteId,
    inviteId: safeInviteId,
    planId: invite.planId ? normalizeSharedEntityId(invite.planId) : "",
    friendName: boundedText(invite.friendName, 24),
    status: ["pending", "confirmed", "rejected"].includes(invite.status) ? invite.status : "pending",
    syncStatus: invite.syncStatus === "cloud" ? "cloud" : "local",
    planUpdatedAt: boundedText(invite.planUpdatedAt, 40),
  };
}

const SHARED_PLAN_STATUSES = new Set(["pending", "confirmed", "rescheduled", "risky"]);
const SHARED_RESERVATION_STATUSES = new Set(["", "unknown", "required", "pending", "confirmed", "failed", "not_required"]);

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSharedEntityId(value, maxLength = 96) {
  const text = normalizeExactId(value, maxLength);
  if (!text || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(text)) return "";
  return text;
}

function normalizeSharedInviteId(value) {
  const text = normalizeExactId(value, 96);
  return text.length >= 6 && text.length <= 96 && /^[A-Za-z0-9_-]+$/.test(text) ? text : "";
}

function normalizeSharedText(value, maxLength, required = false) {
  if (value === undefined || value === null) return required ? null : "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  if ((required && !text) || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function normalizeSharedDate(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return "";
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? text : "";
}

function normalizeSharedClock(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : "";
}

function normalizeSharedTimestamp(value) {
  if (value === undefined || value === null || value === "") return "";
  const text = normalizeSharedText(value, 40);
  return text && timestampValue(text) !== null ? text : null;
}

function validateSharedPlanSnapshot(plan, expectedPlanId = "") {
  if (!isPlainRecord(plan)) return null;
  const id = normalizeSharedEntityId(plan.id);
  const expectedId = expectedPlanId ? normalizeSharedEntityId(expectedPlanId) : "";
  const title = normalizeSharedText(plan.title, 48, true);
  const statusCode = normalizeSharedText(plan.statusCode, 24, true);
  if (!id || (expectedPlanId && !expectedId) || (expectedId && id !== expectedId)
    || !title || !SHARED_PLAN_STATUSES.has(statusCode)) return null;

  if (!isPlainRecord(plan.selectedTime)) return null;
  const date = normalizeSharedDate(plan.selectedTime.date);
  const startTime = normalizeSharedClock(plan.selectedTime.startTime);
  if (!date || !startTime) return null;
  const rawEndTime = plan.selectedTime.endTime;
  const endTime = rawEndTime === undefined || rawEndTime === null || rawEndTime === ""
    ? ""
    : normalizeSharedClock(rawEndTime);
  if (rawEndTime !== undefined && rawEndTime !== null && rawEndTime !== "" && !endTime) return null;
  const weekday = normalizeSharedText(plan.selectedTime.weekday, 24);
  const scene = normalizeSharedText(plan.selectedTime.scene, 24);
  const label = normalizeSharedText(plan.selectedTime.label, 48);
  if (weekday === null || scene === null || label === null) return null;
  if (weekday) {
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const dateParts = date.split("-").map(Number);
    const dateWeekday = weekdays[new Date(dateParts[0], dateParts[1] - 1, dateParts[2]).getDay()];
    if (!weekdays.includes(weekday) || weekday !== dateWeekday) return null;
  }

  const couponId = plan.couponId === undefined || plan.couponId === null || plan.couponId === ""
    ? ""
    : normalizeSharedEntityId(plan.couponId);
  if (plan.couponId && !couponId) return null;
  const category = normalizeSharedText(plan.category, 24);
  const travelTime = normalizeSharedText(plan.travelTime, 32);
  const venue = normalizeSharedText(plan.venue, 48);
  const address = normalizeSharedText(plan.address, 96);
  const reservationStatus = normalizeSharedText(plan.reservationStatus, 24);
  if ([category, travelTime, venue, address, reservationStatus].some((value) => value === null)
    || !SHARED_RESERVATION_STATUSES.has(reservationStatus)) return null;
  if (plan.needReservation !== undefined && typeof plan.needReservation !== "boolean") return null;
  if (plan.needReservation === true && !["required", "confirmed", "failed"].includes(reservationStatus)) return null;
  if (plan.needReservation === false && !["", "not_required"].includes(reservationStatus)) return null;

  let durationMinutes;
  if (plan.durationMinutes !== undefined && plan.durationMinutes !== null && plan.durationMinutes !== "") {
    durationMinutes = Number(plan.durationMinutes);
    if (!Number.isSafeInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > 24 * 60) return null;
  }
  let revision;
  if (plan.revision !== undefined && plan.revision !== null && plan.revision !== "") {
    revision = Number(plan.revision);
    if (!Number.isSafeInteger(revision) || revision < 0) return null;
  }
  const updatedAt = normalizeSharedTimestamp(plan.updatedAt);
  const createdAt = normalizeSharedTimestamp(plan.createdAt);
  if (updatedAt === null || createdAt === null) return null;

  let location;
  if (plan.location !== undefined && plan.location !== null) {
    if (!isPlainRecord(plan.location)) return null;
    const locationName = normalizeSharedText(plan.location.name, 48);
    const locationAddress = normalizeSharedText(plan.location.address, 96);
    if (locationName === null || locationAddress === null) return null;
    location = { name: locationName, address: locationAddress };
  }

  return {
    id,
    couponId,
    title,
    category,
    statusCode,
    travelTime,
    durationMinutes,
    needReservation: plan.needReservation,
    reservationStatus,
    revision,
    updatedAt,
    createdAt,
    venue,
    address,
    location,
    selectedTime: { date, weekday, startTime, endTime, scene, label },
  };
}

function validateSharedCouponSnapshot(coupon, planCouponId) {
  if (!isPlainRecord(coupon)) return null;
  const id = normalizeSharedEntityId(coupon.id);
  const title = normalizeSharedText(coupon.title, 48, true);
  if (!id || !title || !planCouponId || id !== planCouponId) return null;
  const venue = normalizeSharedText(coupon.venue, 48);
  const address = normalizeSharedText(coupon.address, 96);
  const category = normalizeSharedText(coupon.category, 24);
  const statusCode = normalizeSharedText(coupon.statusCode, 24);
  if ([venue, address, category, statusCode].some((value) => value === null)
    || statusCode !== "planned") return null;
  let price;
  if (coupon.price !== undefined && coupon.price !== null && coupon.price !== "") {
    price = Number(coupon.price);
    if (!Number.isFinite(price) || price < 0 || price > 10000000) return null;
  }
  return { id, title, venue, address, category, statusCode, price };
}

function validateSharedInviteSnapshot(invite, planId, expectedInviteId = "") {
  if (!isPlainRecord(invite)) return null;
  const idFromInvite = normalizeSharedInviteId(invite.inviteId || "");
  const idFromId = normalizeSharedInviteId(invite.id || "");
  const inviteId = idFromInvite || idFromId;
  const expectedId = expectedInviteId ? normalizeSharedInviteId(expectedInviteId) : "";
  if (!inviteId || (invite.inviteId && !idFromInvite) || (invite.id && !idFromId)
    || (idFromInvite && idFromId && idFromInvite !== idFromId)
    || (expectedInviteId && !expectedId) || (expectedId && inviteId !== expectedId)) return null;
  const linkedPlanId = invite.planId === undefined || invite.planId === null || invite.planId === ""
    ? planId
    : normalizeSharedEntityId(invite.planId);
  if (!linkedPlanId || linkedPlanId !== planId) return null;
  const status = invite.status === undefined || invite.status === null || invite.status === ""
    ? "pending"
    : normalizeSharedText(invite.status, 24, true);
  if (status !== "pending") return null;
  const friendName = normalizeSharedText(invite.friendName, 24);
  const syncStatus = invite.syncStatus === undefined || invite.syncStatus === null || invite.syncStatus === ""
    ? "local"
    : normalizeSharedText(invite.syncStatus, 24, true);
  const planUpdatedAt = normalizeSharedTimestamp(invite.planUpdatedAt);
  if (friendName === null || !["local", "cloud"].includes(syncStatus) || planUpdatedAt === null) return null;
  return { id: inviteId, inviteId, planId, friendName, status, syncStatus, planUpdatedAt };
}

function buildShareDataPackage(plan = {}, coupon = {}, invite = {}, planId = "") {
  const selectedTime = plan.selectedTime || {};
  const timeParts = [selectedTime.weekday, selectedTime.startTime].filter(Boolean).join(" ");
  const time = selectedTime.label || timeParts || plan.date || "待定";
  const venue = plan.locationText || (coupon && coupon.venue) || "";
  const title = boundedText(`🍽️ 约你【${time}】去 ${plan.title || "聚餐"}${venue ? ` @${venue}` : ""}！`, 88);
  const inviteId = invite.inviteId || invite.id || "";
  const payload = {
    plan: buildSharedPlanSnapshot(plan),
    coupon: buildSharedCouponSnapshot(coupon),
    invite: buildSharedInviteSnapshot(invite, inviteId),
  };
  const safePlanId = normalizeSharedEntityId(planId || plan.id);
  const safeInviteId = normalizeSharedInviteId(inviteId);
  if (!safePlanId || !safeInviteId) throw new Error("邀请标识无效，请重新生成邀请");
  const basePath = `/pages/plan-detail/index?id=${encodeURIComponent(safePlanId)}${safeInviteId ? `&inviteId=${encodeURIComponent(safeInviteId)}` : ""}&role=recipient&planData=`;
  let encodedData = encodeURIComponent(JSON.stringify(payload));
  if ((basePath + encodedData).length >= 1000) {
    delete payload.plan.address;
    delete payload.plan.location;
    if (payload.coupon) {
      delete payload.coupon.address;
      delete payload.coupon.venue;
    }
    encodedData = encodeURIComponent(JSON.stringify(payload));
  }
  if ((basePath + encodedData).length >= 1000) {
    payload.plan = {
      id: payload.plan.id,
      title: boundedText(payload.plan.title, 20),
      statusCode: payload.plan.statusCode,
      selectedTime: payload.plan.selectedTime,
      revision: payload.plan.revision,
      updatedAt: payload.plan.updatedAt,
    };
    payload.coupon = null;
    payload.invite = {
      id: safeInviteId,
      inviteId: safeInviteId,
      planUpdatedAt: payload.invite.planUpdatedAt,
    };
    encodedData = encodeURIComponent(JSON.stringify(payload));
  }
  if ((basePath + encodedData).length >= 1000) {
    payload.plan.title = boundedText(payload.plan.title, 20);
    delete payload.plan.venue;
    payload.coupon = payload.coupon ? { id: payload.coupon.id, title: boundedText(payload.coupon.title, 20) } : null;
    encodedData = encodeURIComponent(JSON.stringify(payload));
  }

  return {
    title,
    path: `${basePath}${encodedData}`,
  };
}

function parseSharedPlanData(rawValue, expected = {}) {
  let value = String(rawValue || "");
  if (!value || value.length > 8192) return null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const parsed = JSON.parse(value);
      if (!isPlainRecord(parsed)) return null;
      const expectedPlanId = expected && expected.planId || "";
      const expectedInviteId = expected && expected.inviteId || "";
      const validatedPlan = validateSharedPlanSnapshot(parsed.plan, expectedPlanId);
      if (!validatedPlan) return null;
      const plan = buildSharedPlanSnapshot(validatedPlan);
      let coupon = null;
      if (parsed.coupon !== undefined && parsed.coupon !== null) {
        const validatedCoupon = validateSharedCouponSnapshot(parsed.coupon, plan.couponId);
        if (!validatedCoupon) return null;
        coupon = buildSharedCouponSnapshot(validatedCoupon);
      }
      if (!parsed.invite) return null;
      const validatedInvite = validateSharedInviteSnapshot(parsed.invite, plan.id, expectedInviteId);
      if (!validatedInvite) return null;
      const invite = buildSharedInviteSnapshot(validatedInvite, validatedInvite.inviteId);
      invite.planId = plan.id;
      return { plan, coupon, invite };
    } catch (error) {
      try {
        const decoded = decodeURIComponent(value);
        if (decoded === value) return null;
        value = decoded;
      } catch (decodeError) {
        return null;
      }
    }
  }
  return null;
}

module.exports = {
  boundedText,
  buildSharedPlanSnapshot,
  buildSharedCouponSnapshot,
  buildSharedInviteSnapshot,
  isPlainRecord,
  normalizeSharedEntityId,
  normalizeSharedInviteId,
  normalizeSharedText,
  normalizeSharedDate,
  normalizeSharedClock,
  normalizeSharedTimestamp,
  validateSharedPlanSnapshot,
  validateSharedCouponSnapshot,
  validateSharedInviteSnapshot,
  buildShareDataPackage,
  parseSharedPlanData,
};
