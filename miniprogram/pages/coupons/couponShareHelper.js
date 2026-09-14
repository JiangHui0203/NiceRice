const SHARE_BADGES = ["A", "B", "C", "D", "E"];
const { hasCoordinates, normalizeCoordinate } = require("../../utils/locationUtils.js");
const { normalizeExactId } = require("../../utils/idUtils.js");
const MAX_SHARED_JSON_CHARS = 12 * 1024;
const MAX_SHARE_PATH_CHARS = 950;
const PLACEHOLDER_TITLES = new Set(["品质套餐", "标题待补充", "自定义计划", "生活活动"]);
const PLACEHOLDER_VENUES = new Set(["精选餐厅", "待补充店名", "店铺待补充", "商家待补充", "地点待补充", "地点待定", "待定"]);
const RESERVATION_STATUSES = new Set(["", "not_required", "required", "pending", "confirmed", "failed", "unknown"]);
const RESERVED_SELECTION_IDS = new Set(["__proto__", "constructor", "prototype"]);

function bounded(value, maxLength) {
  return Array.from(String(value === undefined || value === null ? "" : value).trim())
    .slice(0, maxLength)
    .join("");
}

function decodeSharedText(rawValue) {
  let value = String(rawValue || "");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    } catch (error) {
      break;
    }
  }
  return value;
}

function parseSharedJson(rawValue) {
  let value = String(rawValue || "");
  if (!value || value.length > MAX_SHARED_JSON_CHARS) return null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : (Array.isArray(parsed) && parsed.length <= 3 ? parsed : null);
    } catch (error) {
      const decoded = decodeSharedText(value);
      if (decoded === value) return null;
      value = decoded;
    }
  }
  return null;
}

function stripCouponForShare(coupon = {}) {
  const source = coupon && typeof coupon === "object" && !Array.isArray(coupon) ? coupon : {};
  const nestedLocation = source.location && typeof source.location === "object" ? source.location : {};
  const latitude = normalizeCoordinate(source.latitude !== undefined ? source.latitude : nestedLocation.latitude);
  const longitude = normalizeCoordinate(source.longitude !== undefined ? source.longitude : nestedLocation.longitude);
  const coordinatePair = hasCoordinates({ latitude, longitude });
  return {
    id: normalizeExactId(source.id, 80),
    title: bounded(source.title, 80),
    venue: bounded(source.venue || source.merchantName, 80),
    type: bounded(source.type, 32),
    category: bounded(source.category, 32),
    price: bounded(source.price, 24),
    originalPrice: bounded(source.originalPrice, 24),
    people: bounded(source.people, 24),
    address: bounded(source.address || nestedLocation.address, 160),
    latitude: coordinatePair ? latitude : null,
    longitude: coordinatePair ? longitude : null,
    expireDate: bounded(source.expireDate, 24),
    platform: bounded(source.platform, 32),
    reservationRequired: Boolean(source.reservationRequired),
    reservationStatus: bounded(source.reservationStatus, 24),
  };
}

function isExactDate(value) {
  if (!value) return true;
  const matched = String(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!matched) return false;
  const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  return date.getFullYear() === Number(matched[1])
    && date.getMonth() === Number(matched[2]) - 1
    && date.getDate() === Number(matched[3]);
}

function isOptionalAmount(value) {
  return value === "" || (/^\d+(?:\.\d{1,2})?$/.test(String(value)) && Number(value) >= 0);
}

function normalizeSharedCoupon(coupon = {}) {
  const snapshot = stripCouponForShare(coupon);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(snapshot.id)
    || RESERVED_SELECTION_IDS.has(snapshot.id)
    || !snapshot.title || PLACEHOLDER_TITLES.has(snapshot.title)
    || !snapshot.venue || PLACEHOLDER_VENUES.has(snapshot.venue)
    || !isExactDate(snapshot.expireDate)
    || !isOptionalAmount(snapshot.price)
    || !isOptionalAmount(snapshot.originalPrice)
    || !RESERVATION_STATUSES.has(snapshot.reservationStatus)) return null;
  return snapshot;
}

function buildSharePath(stripped = []) {
  return `/pages/coupons/index?sharedCoupons=${encodeURIComponent(JSON.stringify(stripped))}`;
}

function fitCouponsForShare(items = []) {
  const snapshots = items.slice(0, 3).map(normalizeSharedCoupon).filter(Boolean);
  const reducibleFields = ["address", "venue", "type", "category", "platform", "people", "reservationStatus", "originalPrice", "price", "expireDate", "title"];
  let guard = 0;
  while (buildSharePath(snapshots).length > MAX_SHARE_PATH_CHARS && guard < 160) {
    guard += 1;
    let candidate = null;
    snapshots.forEach((snapshot) => {
      reducibleFields.forEach((field) => {
        const chars = Array.from(snapshot[field] || "");
        const minimum = field === "title" ? 1 : 0;
        if (chars.length <= minimum) return;
        const encodedLength = encodeURIComponent(chars.join("")).length;
        if (!candidate || encodedLength > candidate.encodedLength) {
          candidate = { snapshot, field, chars, minimum, encodedLength };
        }
      });
    });
    if (!candidate) break;
    const nextLength = Math.max(candidate.minimum, Math.floor(candidate.chars.length * 0.7));
    candidate.snapshot[candidate.field] = candidate.chars.slice(0, nextLength).join("");
  }
  return snapshots;
}

function buildShareCandidateItems(coupons = [], selectedMap = {}, limit = 3) {
  const selection = selectedMap && typeof selectedMap === "object" ? selectedMap : {};
  return coupons
    .filter((coupon) => coupon
      && Object.prototype.hasOwnProperty.call(selection, coupon.id)
      && selection[coupon.id] === true)
    .slice(0, limit)
    .map((coupon, index) => Object.assign({}, coupon, {
      badge: SHARE_BADGES[index] || String(index + 1),
    }));
}

function buildShareCandidateText(items = []) {
  if (!items.length) return "";
  let text = items.length === 1
    ? `📢 【有时好饭】优惠券分享 —「${items[0].title}」\n`
    : "📢 【有时好饭】聚餐候选投票卡 — 今天/这周末我们吃哪个？\n";
  text += "================================\n";
  items.forEach((item) => {
    text += `\n选项 ${item.badge}：${item.title}\n`;
    text += `   📍 店铺：${item.venue || item.merchantName || "未知店铺"}\n`;
    if (item.price) {
      text += `   💰 实付 ¥${item.price}`;
      if (item.originalPrice) text += ` (原价¥${item.originalPrice})`;
      text += "\n";
    }
    const rawPeople = String(item.people || "").trim();
    const people = /待补充|未知/.test(rawPeople) ? "" : rawPeople.replace(/人+$/, "");
    text += `   👥 ${people ? `适合 ${people}人` : "适用人数待补充"}`;
    if (item.expiresIn) text += ` · ⏰ ${item.expiresIn}`;
    text += "\n";
    if (item.dishesSummary) text += `   🍽️ ${item.dishesSummary}\n`;
  });
  text += "\n================================\n";
  if (items.length > 1) {
    text += `请回复选项字母 (${items.map((item) => item.badge).join(" / ")}) 投票！\n`;
  }
  return `${text}来自小程序「有时好饭」🎯`;
}

function buildCouponsSharePayload(items = []) {
  if (!items.length) {
    return { title: "有时好饭 — 我的优惠券包", path: "/pages/coupons/index" };
  }
  const stripped = fitCouponsForShare(items);
  if (!stripped.length) return { title: "有时好饭 — 我的优惠券包", path: "/pages/coupons/index" };
  const titles = stripped.map((item) => item.title).slice(0, 3);
  const shareTitle = stripped.length === 1
    ? `🎟️ 分享一张券：${titles[0]}`
    : `🎯 来投票！${titles.join(" vs ")} — 选哪个？`;
  return {
    title: shareTitle,
    path: buildSharePath(stripped),
  };
}

module.exports = {
  buildCouponsSharePayload,
  buildShareCandidateItems,
  buildShareCandidateText,
  decodeSharedText,
  fitCouponsForShare,
  normalizeSharedCoupon,
  parseSharedJson,
  stripCouponForShare,
};
