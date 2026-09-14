const mock = require("../../utils/mock.js");
const locationService = require("../../utils/services/locationService.js");
const { dateAfter, pad } = require("../../utils/dateUtils.js");
const routeService = require("../../utils/services/routeService.js");
const ocrService = require("../../utils/services/ocrService.js");
const screenshotService = require("../../utils/services/screenshotService.js");
const couponNormalizer = require("../../utils/coupon/couponNormalizer.js");
const { parseDishesList } = require("../../utils/coupon/dishParser.js");

const ALL_LIFE_TAGS = [
  "需提前预约", "适合周末", "适合工作日前夜", "不适合工作日前夜", "适合雨天", "不适合雨天",
  "室内", "户外", "味道大", "需要洗澡洗头", "需要简单整理", "顺路优先", "需空腹", "适合聚餐", "单人友好"
];

function buildLifeTags(tags = []) {
  const normalizedTags = [...new Set((Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag || "").trim().slice(0, 48))
    .filter(Boolean))].slice(0, 30);
  const visibleTags = ALL_LIFE_TAGS.concat(
    normalizedTags.filter((tag) => !ALL_LIFE_TAGS.includes(tag)),
  ).slice(0, ALL_LIFE_TAGS.length + 30);
  return visibleTags.map((tag) => ({ name: tag, label: tag, selected: normalizedTags.includes(tag) }));
}

function findIndex(options = [], value, fallback = 0) {
  const index = options.indexOf(value);
  return index > -1 ? index : fallback;
}

function calculateDiscount(price, originalPrice) {
  const p = parseFloat(price);
  const op = parseFloat(originalPrice);
  if (!p || !op || op <= p) return null;
  const rate = (p / op) * 10;
  const rateText = rate % 1 === 0 ? rate.toFixed(0) : rate.toFixed(1);
  const saved = (op - p).toFixed(p % 1 === 0 && op % 1 === 0 ? 0 : 2);
  return { rateText: `${rateText}折`, savedText: `省¥${saved}`, text: `${rateText}折 · 省¥${saved}` };
}

function validateCouponForm(form) {
  const source = form || {};
  const title = String(source.title || "").trim();
  const venue = String(source.venue || "").trim();
  if (!title) return { isValid: false, errorTitle: "请填写优惠内容" };
  if (title.length > 120) return { isValid: false, errorTitle: "优惠内容不能超过120字" };
  if (!venue) return { isValid: false, errorTitle: "请填写适用门店/品牌" };
  if (venue.length > 120) return { isValid: false, errorTitle: "门店名称不能超过120字" };
  const expireDate = String(source.expireDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expireDate)) {
    return { isValid: false, errorTitle: "请选择有效的到期日期" };
  }
  const normalizedExpireDate = couponNormalizer.normalizeDateText(expireDate);
  const expiryTimestamp = couponNormalizer.getExactDateTimestamp(expireDate, true);
  if (!normalizedExpireDate || normalizedExpireDate !== expireDate || expiryTimestamp === null) {
    return { isValid: false, errorTitle: "到期日期格式不正确" };
  }
  const moneyFields = [
    ["price", "实付金额"],
    ["originalPrice", "原价"],
    ["lossAmount", "预计损失"],
  ];
  for (const [key, label] of moneyFields) {
    const value = String(source[key] === undefined || source[key] === null ? "" : source[key]).trim();
    if (value && !/^\d+(?:\.\d{1,2})?$/.test(value)) {
      return { isValid: false, errorTitle: `${label}格式不正确` };
    }
  }
  const duration = String(source.durationMinutes === undefined || source.durationMinutes === null ? "" : source.durationMinutes).trim();
  if (duration && (!/^\d+$/.test(duration) || Number(duration) <= 0)) {
    return { isValid: false, errorTitle: "预计用时必须是正整数分钟" };
  }
  const usableTime = String(source.usableTime || "").trim();
  if (!couponNormalizer.validateUsableTimeText(usableTime)) {
    return { isValid: false, errorTitle: "适用时段格式不正确，请使用 17:00-22:00" };
  }
  const leadHours = String(source.reservationLeadTimeHours === undefined || source.reservationLeadTimeHours === null
    ? ""
    : source.reservationLeadTimeHours).trim();
  if (leadHours && (!/^\d+$/.test(leadHours) || Number(leadHours) > 720)) {
    return { isValid: false, errorTitle: "预约提前时间必须是 0-720 小时的整数" };
  }
  const hasLatitude = source.latitude !== "" && source.latitude !== null && source.latitude !== undefined;
  const hasLongitude = source.longitude !== "" && source.longitude !== null && source.longitude !== undefined;
  if (hasLatitude !== hasLongitude) return { isValid: false, errorTitle: "地点经纬度不完整，请重新选点" };
  if (hasLatitude) {
    const latitude = Number(source.latitude);
    const longitude = Number(source.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return { isValid: false, errorTitle: "地点经纬度无效，请重新选点" };
    }
  }
  const isPastDate = expiryTimestamp < Date.now();
  return { isValid: true, isPastDate };
}

function chooseCouponLocation(currentForm) {
  return locationService.chooseCouponLocation({
    latitude: currentForm.latitude, longitude: currentForm.longitude, fallbackAddress: currentForm.address,
  }).then((picked) => Object.assign({}, currentForm, {
    locationName: picked.name || currentForm.locationName || currentForm.venue,
    locationAddress: picked.address || currentForm.locationAddress || currentForm.address,
    latitude: picked.latitude !== null && picked.latitude !== undefined ? picked.latitude : "",
    longitude: picked.longitude !== null && picked.longitude !== undefined ? picked.longitude : "",
    locationSource: picked.source || "wx.chooseLocation",
    locationSelectedAt: picked.selectedAt || new Date().toISOString(),
    address: picked.address || currentForm.address,
    venue: currentForm.venue || picked.name || "",
  }));
}

function estimateCouponRoute(currentForm) {
  const destination = {
    name: currentForm.locationName || currentForm.venue,
    address: currentForm.locationAddress || currentForm.address,
    latitude: currentForm.latitude, longitude: currentForm.longitude,
  };
  return routeService.estimateTravelPlan({ destination }).then((routePlan) => ({
    form: Object.assign({}, currentForm, {
      travelTime: (routePlan.route && routePlan.route.distanceText) || currentForm.travelTime || "",
      route: routePlan.route || null,
    }),
    origin: routePlan.origin,
  }));
}

function buildInitialCouponForm() {
  return {
    id: "", title: "", venue: "", type: "火锅", platform: "美团",
    reservationRequired: false, reservationStatus: "not_required", reservationLeadTimeHours: "0",
    expireDate: dateAfter(14), usableTime: "11:00-22:00", people: "2人",
    price: "", originalPrice: "", lossAmount: "", dishes: "", address: "",
    locationName: "", locationAddress: "", latitude: "", longitude: "",
    locationSource: "", locationSelectedAt: "", travelTime: "", refundType: "auto",
    storeLimit: "", ruleNotes: "", durationMinutes: "90", note: "", screenshots: [],
  };
}

function buildSampleCouponForm() {
  const defaults = mock.typeDefaults["烧烤"];
  return {
    defaultTags: defaults.tags,
    selectedTags: defaults.tags,
    lifeTagOptions: buildLifeTags(defaults.tags),
    form: {
      id: "", title: "双人品质烤肉套餐（含牛五花+厚切五花）", venue: "安又雪朝鲜族烤肉（万象天地店）",
      type: "烧烤", platform: "大众点评", reservationRequired: true, reservationStatus: "required", reservationLeadTimeHours: "2",
      expireDate: dateAfter(5), usableTime: "17:00-23:00", people: "2人", price: "168", originalPrice: "298",
      lossAmount: "168", dishes: "安格斯牛五花、厚切黑猪五花、芝士口蘑、冷面",
      address: "华润万象天地里巷NL120号", locationName: "安又雪朝鲜族烤肉（万象天地店）",
      locationAddress: "广东省深圳市南山区粤海街道大冲社区深南大道9668号华润万象天地里巷NL120号",
      latitude: 22.5401, longitude: 113.9547, locationSource: "wx.chooseLocation",
      locationSelectedAt: new Date().toISOString(), travelTime: "25分钟", refundType: "auto",
      storeLimit: "全国通用（除特殊景区店）", ruleNotes: "需提前2小时通过大众点评预约；周五晚市及周末通用；不与其他优惠同享",
      durationMinutes: "120", note: "朋友推荐，肉质极佳，赠送南瓜粥无限续", screenshots: [],
    },
  };
}

function applyParsedOcrResult(text, currentForm, typeOptions, peopleOptions, platformOptions) {
  const parsed = ocrService.parseCouponText(text);
  if (!parsed || !parsed.success) return { success: false };
  const currentTags = currentForm.tags || [];
  const type = parsed.type || currentForm.type;
  const defaults = mock.typeDefaults[type] || mock.typeDefaults["其他"];
  const selectedTags = [...new Set([...defaults.tags, ...currentTags])];

  return {
    success: true,
    form: Object.assign({}, currentForm, {
      title: parsed.title || currentForm.title, venue: parsed.venue || currentForm.venue,
      type, platform: parsed.platform || currentForm.platform, price: parsed.price || currentForm.price,
      originalPrice: parsed.originalPrice || currentForm.originalPrice, lossAmount: parsed.price || currentForm.lossAmount,
      expireDate: parsed.expireDate || currentForm.expireDate, usableTime: parsed.usableTime || currentForm.usableTime,
      people: parsed.people || currentForm.people,
      reservationRequired: parsed.reservationRequired !== undefined ? parsed.reservationRequired : currentForm.reservationRequired,
      reservationStatus: parsed.reservationRequired !== undefined
        ? (parsed.reservationRequired ? "required" : "not_required")
        : (currentForm.reservationStatus || (currentForm.reservationRequired ? "required" : "not_required")),
      reservationLeadTimeHours: parsed.reservationLeadTimeHours ? String(parsed.reservationLeadTimeHours) : currentForm.reservationLeadTimeHours,
      refundType: parsed.refundType || currentForm.refundType, storeLimit: parsed.storeLimit || currentForm.storeLimit,
      ruleNotes: parsed.ruleNotes || currentForm.ruleNotes, dishes: parsed.dishes || currentForm.dishes,
      address: parsed.address || currentForm.address, locationName: currentForm.locationName || parsed.venue || "",
      locationAddress: currentForm.locationAddress || parsed.address || "",
    }),
    defaultTags: defaults.tags,
    selectedTags,
    lifeTagOptions: buildLifeTags(selectedTags),
    reservationIndex: parsed.reservationRequired !== undefined
      ? (parsed.reservationRequired ? 1 : 0)
      : (currentForm.reservationStatus === "unknown" ? 2 : (currentForm.reservationRequired ? 1 : 0)),
    refundIndex: parsed.refundType === "non_refundable" ? 2 : parsed.refundType === "manual" ? 1 : parsed.refundType === "partial" ? 3 : 0,
    typeIndex: parsed.type ? findIndex(typeOptions, parsed.type, 0) : undefined,
    platformIndex: parsed.platform ? findIndex(platformOptions, parsed.platform, 0) : undefined,
    peopleIndex: parsed.people ? findIndex(peopleOptions, parsed.people, 1) : undefined,
  };
}

function handleAddScreenshot(currentScreenshots = [], max = 6) {
  return screenshotService.addScreenshots(currentScreenshots, max);
}

function handleRemoveScreenshot(currentScreenshots = [], index) {
  return (currentScreenshots || []).filter((_, i) => i !== index);
}

function resolveScreenshotPreviews(screenshots = []) {
  return screenshotService.resolveScreenshotPreviews(screenshots);
}

function handleTypeChange(typeIndex, typeOptions, currentTags = []) {
  const type = typeOptions[typeIndex] || "火锅";
  const defaults = mock.typeDefaults[type] || mock.typeDefaults["其他"];
  const selectedTags = [...new Set([...defaults.tags, ...(currentTags || [])])].slice(0, 30);
  return { typeIndex, type, defaultTags: defaults.tags, selectedTags, lifeTagOptions: buildLifeTags(selectedTags) };
}

function handlePlatformChange(platformIndex, platformOptions) {
  return { platformIndex, platform: platformOptions[platformIndex] || "美团" };
}

function handleReservationChange(reservationIndex) {
  const normalizedIndex = [0, 1, 2].includes(reservationIndex) ? reservationIndex : 2;
  return {
    reservationIndex: normalizedIndex,
    reservationRequired: normalizedIndex === 1,
    reservationStatus: normalizedIndex === 1 ? "required" : (normalizedIndex === 0 ? "not_required" : "unknown"),
  };
}

function handleRefundChange(refundIndex) {
  const REFUND_MAP = { 1: "manual", 2: "non_refundable", 3: "partial" };
  return { refundIndex, refundType: REFUND_MAP[refundIndex] || "auto" };
}

function handlePeopleChange(peopleIndex, peopleOptions) {
  return { peopleIndex, people: peopleOptions[peopleIndex] || "2人" };
}

function toggleFormTag(tag, currentSelectedTags = []) {
  const normalizedTag = String(tag || "").trim().slice(0, 48);
  if (!normalizedTag) return { selectedTags: currentSelectedTags, lifeTagOptions: buildLifeTags(currentSelectedTags) };
  const next = currentSelectedTags.includes(normalizedTag)
    ? currentSelectedTags.filter((t) => t !== normalizedTag)
    : [...currentSelectedTags, normalizedTag].slice(0, 30);
  return { selectedTags: next, lifeTagOptions: buildLifeTags(next) };
}

function addCustomTagToForm(tag, currentSelectedTags = []) {
  const trimmed = String(tag || "").trim();
  if (!trimmed || trimmed.length > 48 || currentSelectedTags.length >= 30) return null;
  const next = [...new Set([...currentSelectedTags, trimmed])].slice(0, 30);
  return { selectedTags: next, lifeTagOptions: buildLifeTags(next) };
}

const DISH_PRESET_PILLS = [
  { label: "招牌主菜", text: "招牌主菜 1份" }, { label: "特色肉类", text: "特色肉类 1盘" },
  { label: "时蔬拼盘", text: "时蔬拼盘 1份" }, { label: "精选小吃", text: "精选小吃 1份" },
  { label: "主食/面点", text: "手工主食 1份" }, { label: "特调饮品", text: "特调饮品 2杯" },
  { label: "特色蘸料", text: "自助小料 2位" },
];

const RULE_PRESET_PILLS = [
  "随时退", "过期自动退", "免预约", "需提前预约", "周末节假日通用", "限堂食使用", "不可与其他优惠同享",
];

module.exports = {
  buildLifeTags, findIndex, calculateDiscount, validateCouponForm, chooseCouponLocation, estimateCouponRoute,
  pad, dateAfter, buildInitialCouponForm, buildSampleCouponForm, applyParsedOcrResult, handleAddScreenshot,
  handleRemoveScreenshot, resolveScreenshotPreviews, handleTypeChange, handlePlatformChange,
  handleReservationChange, handleRefundChange, handlePeopleChange, toggleFormTag, addCustomTagToForm, parseDishesList,
  DISH_PRESET_PILLS, RULE_PRESET_PILLS,
};
