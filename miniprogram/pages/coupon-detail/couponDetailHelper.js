/**
 * couponDetailHelper.js
 * 纯函数层：负责卡券详情视图模型组装、菜品拆解、位置解析、预约与退款规则映射（字典查表驱动）
 */

const routeService = require("../../utils/services/routeService.js");
const { hasCoordinates, normalizeCoordinate } = require("../../utils/locationUtils.js");
const { parseDishesList } = require("../../utils/coupon/dishParser.js");

const PLATFORM_THEMES = [
  { match: /美团/, platformClass: "meituan", platformIcon: "🟡" },
  { match: /点评/, platformClass: "dianping", platformIcon: "🟠" },
  { match: /抖音/, platformClass: "douyin", platformIcon: "🎵" },
];

const RESERVATION_TEXT_MAP = {
  not_required: "免预约",
  required: "需预约",
  pending: "待预约",
  confirmed: "已预约",
  failed: "预约失败",
};

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const SHARE_SNAPSHOT_MAX_ENCODED_LENGTH = 860;
const PLACEHOLDER_TITLES = new Set(["品质套餐", "标题待补充", "自定义计划", "生活活动"]);
const PLACEHOLDER_LOCATION_NAMES = new Set([
  "精选餐厅", "待补充店名", "店铺待补充", "商家待补充", "地点待补充", "地点待定", "待定",
]);
const PLACEHOLDER_ADDRESSES = new Set(["待补充地址", "地址待补充"]);

function withoutPlaceholder(value, placeholders) {
  const text = String(value || "").trim();
  return text && !placeholders.has(text) ? text : "";
}

function cropShareText(value, maxLength) {
  if (value === null || value === undefined) return "";
  return Array.from(String(value).slice(0, maxLength * 2).trim()).slice(0, maxLength).join("");
}

function encodedShareSnapshotLength(snapshot) {
  return encodeURIComponent(JSON.stringify({ coupon: snapshot })).length;
}

function buildShareCouponSnapshot(coupon = {}) {
  const nestedLocation = coupon.location || {};
  const latitude = normalizeCoordinate(coupon.latitude !== undefined ? coupon.latitude : nestedLocation.latitude);
  const longitude = normalizeCoordinate(coupon.longitude !== undefined ? coupon.longitude : nestedLocation.longitude);
  const coordinatesValid = hasCoordinates({ latitude, longitude });
  const snapshot = {
    id: cropShareText(coupon.id, 80),
    title: cropShareText(withoutPlaceholder(coupon.title, PLACEHOLDER_TITLES), 80),
    venue: cropShareText(withoutPlaceholder(
      coupon.venue || coupon.merchantName,
      PLACEHOLDER_LOCATION_NAMES
    ), 80),
    type: cropShareText(coupon.type, 32),
    category: cropShareText(coupon.category, 32),
    price: cropShareText(coupon.price, 24),
    originalPrice: cropShareText(coupon.originalPrice, 24),
    people: cropShareText(coupon.people, 24),
    address: cropShareText(
      withoutPlaceholder(coupon.address, PLACEHOLDER_ADDRESSES)
        || withoutPlaceholder(nestedLocation.address, PLACEHOLDER_ADDRESSES),
      160
    ),
    latitude: coordinatesValid ? latitude : null,
    longitude: coordinatesValid ? longitude : null,
    expireDate: cropShareText(coupon.expireDate, 24),
    platform: cropShareText(coupon.platform, 32),
    reservationRequired: Boolean(coupon.reservationRequired),
    reservationStatus: cropShareText(coupon.reservationStatus, 24),
  };

  const minimumLengths = { id: 1, title: 1 };
  const reducibleFields = [
    "address", "venue", "type", "category", "platform", "people",
    "originalPrice", "price", "expireDate", "title", "id",
  ];
  let guard = 0;
  while (encodedShareSnapshotLength(snapshot) > SHARE_SNAPSHOT_MAX_ENCODED_LENGTH && guard < 100) {
    guard += 1;
    const candidate = reducibleFields
      .map((field) => ({
        field,
        chars: Array.from(snapshot[field] || ""),
        minimum: minimumLengths[field] || 0,
      }))
      .filter((item) => item.chars.length > item.minimum)
      .sort((left, right) => (
        encodeURIComponent(right.chars.join("")).length - encodeURIComponent(left.chars.join("")).length
      ))[0];
    if (!candidate) break;
    const nextLength = Math.max(candidate.minimum, Math.floor(candidate.chars.length * 0.7));
    snapshot[candidate.field] = candidate.chars.slice(0, nextLength).join("");
  }

  return snapshot;
}

function buildLocationView(coupon = {}) {
  const location = coupon.location || {};
  const latitude = normalizeCoordinate(location.latitude !== undefined ? location.latitude : location.lat);
  const longitude = normalizeCoordinate(location.longitude !== undefined ? location.longitude : location.lng);
  const name = withoutPlaceholder(location.name, PLACEHOLDER_LOCATION_NAMES)
    || withoutPlaceholder(coupon.venue || coupon.merchantName, PLACEHOLDER_LOCATION_NAMES);
  const address = withoutPlaceholder(location.address, PLACEHOLDER_ADDRESSES)
    || withoutPlaceholder(coupon.address, PLACEHOLDER_ADDRESSES);
  const mapReady = hasCoordinates({ latitude, longitude });

  return {
    name: name || "地点待补充",
    address: address || "可在编辑页选择位置",
    distanceText: coupon.travelTime || (coupon.route && coupon.route.distanceText) || "待估算",
    mapReady,
    latitude,
    longitude,
  };
}

function formatReservationText(coupon = {}) {
  const status = coupon.reservationStatus || "";
  if (RESERVATION_TEXT_MAP[status]) return RESERVATION_TEXT_MAP[status];
  if (coupon.reservationRequired === true) return "需预约";
  return "预约要求待补充";
}

function formatRefundText(coupon = {}) {
  const refundInfo = coupon.refundInfo || {};
  const refundType = refundInfo.refundType || "unknown";
  const rawAmount = refundInfo.lossAmount !== undefined && refundInfo.lossAmount !== null
    && String(refundInfo.lossAmount).trim() !== ""
    ? refundInfo.lossAmount
    : coupon.price;
  const amount = Number(rawAmount);
  const amountText = rawAmount !== undefined && rawAmount !== null && String(rawAmount).trim() !== ""
    && Number.isFinite(amount) && amount >= 0
    ? `¥${amount}`
    : "损失金额待补充";

  if (refundType === "manual") return "随时可手动申请退款";
  if (refundType === "non_refundable") return `不可退款 · 预计损失 ${amountText}`;
  if (refundType === "partial") return `部分退款 · 预计损失 ${amountText}`;
  if (refundType === "auto") return "过期自动全额退";
  return "退款规则待补充";
}

function formatPeopleText(people) {
  if (!people) return "人数待补充";
  const str = String(people).trim();
  if (!str) return "人数待补充";
  if (/待补充|未知/.test(str)) return str;
  if (["不限", "通用", "人数不限"].includes(str)) return str;
  if (str.endsWith("人") || str.endsWith("人餐")) return str;
  return `${str}人`;
}

function getDistanceDisplay(coupon = {}, origin) {
  try {
    const dynamicDistance = routeService.getDynamicDistance(coupon, origin);
    if (dynamicDistance && dynamicDistance.distanceKmText) {
      return dynamicDistance.distanceKmText;
    }
  } catch (e) {
    // ignore
  }

  const travelStr = coupon.travelTime || (coupon.route && coupon.route.distanceText) || "";
  const match = String(travelStr).match(/(\d+)\s*分/);
  if (match) {
    const mins = Number(match[1]);
    const approxKm = (mins * 0.08).toFixed(1);
    return `${approxKm}km`;
  }
  return "";
}

function resolvePlatformTheme(platform = "") {
  const matched = PLATFORM_THEMES.find((p) => p.match.test(platform));
  return matched || { platformClass: "default", platformIcon: "🏷️" };
}

function buildDetailView(coupon = {}, origin) {
  const price = parseFloat(coupon.price) || 0;
  const originalPrice = parseFloat(coupon.originalPrice) || 0;
  const savedAmount = originalPrice > price ? (originalPrice - price).toFixed(0) : 0;
  const discountRate = originalPrice > price && originalPrice > 0 ? ((price / originalPrice) * 10).toFixed(1) : 0;

  const platform = coupon.platform || "平台待补充";
  const { platformClass, platformIcon } = resolvePlatformTheme(platform);
  const parsedDishes = parseDishesList(coupon.dishes);
  const peopleText = formatPeopleText(coupon.people);
  const distanceDisplay = getDistanceDisplay(coupon, origin);

  const conditions = [
    { label: "适用时段", value: coupon.usableTime || "时段待补充", icon: "📅" },
    { label: "适用人数", value: peopleText, icon: "👥" },
    { label: "预约要求", value: formatReservationText(coupon), icon: "📞", isHighlight: Boolean(coupon.reservationRequired) },
    { label: "售后保障", value: formatRefundText(coupon), icon: "🛡️", isSafe: true },
    { label: "单程路程", value: coupon.travelTime ? (String(coupon.travelTime).startsWith("约") ? String(coupon.travelTime) : `约 ${coupon.travelTime}`) : "待估算" },
  ];

  const storeLimit = coupon.storeLimit || (coupon.usageRules && coupon.usageRules.storeLimit) || "";
  if (storeLimit) {
    conditions.push({ label: "适用门店", value: storeLimit, icon: "🏪" });
  }

  const address = withoutPlaceholder(coupon.location && coupon.location.address, PLACEHOLDER_ADDRESSES)
    || withoutPlaceholder(coupon.address, PLACEHOLDER_ADDRESSES);
  if (address) {
    conditions.push({ label: "店铺地址", value: address, icon: "📍", isAddress: true });
  }



  if (coupon.cleanup && coupon.cleanup !== "无需清洁" && coupon.cleanup !== "无需额外清洁时间") {
    conditions.push({ label: "活动清洁", value: coupon.cleanup, icon: "🧹" });
  }

  // 系统智能履约提醒与补充规则归集
  const rawNotices = (Array.isArray(coupon.notices) ? coupon.notices : [])
    .slice(0, 20)
    .filter((item) => typeof item === "string")
    .map((item) => cropShareText(item, 240));
  const ruleNotes = cropShareText(coupon.ruleNotes || (coupon.usageRules && coupon.usageRules.notes) || "", 1000);
  if (ruleNotes && !rawNotices.includes(ruleNotes) && ruleNotes !== coupon.note) {
    rawNotices.push(ruleNotes);
  }
  const smartReminders = rawNotices
    .filter((item) => item && !item.startsWith("备注：") && item !== coupon.note)
    .slice(0, 20);

  return {
    reservationText: formatReservationText(coupon),
    refundText: formatRefundText(coupon),
    savedAmount,
    discountRate,
    platform,
    platformClass,
    platformIcon,
    parsedDishes,
    peopleText,
    distanceDisplay,
    conditions,
    smartReminders,
    hasDishes: parsedDishes.length > 0,
  };
}

function getWeekdayText(dateStr) {
  const matched = String(dateStr || "").trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!matched) return "日期待补充";
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return "日期待补充";
  }
  return WEEKDAYS[date.getDay()] || "日期待补充";
}

module.exports = {
  toNumber: normalizeCoordinate,
  buildLocationView,
  formatReservationText,
  formatRefundText,
  parseDishesList,
  formatPeopleText,
  getDistanceDisplay,
  buildDetailView,
  buildShareCouponSnapshot,
  getWeekdayText,
};
