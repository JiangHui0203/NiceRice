/**
 * completedHistoryHelper.js
 * 纯函数计算层：负责完成历史数据的合并清洗、统计汇总、勋章计算与按月分组
 */

function formatStars(rating = 0) {
  const normalized = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return "★".repeat(normalized) + "☆".repeat(5 - normalized);
}

const PLACEHOLDER_TITLES = new Set(["品质套餐", "标题待补充", "自定义计划", "生活活动"]);
const PLACEHOLDER_VENUES = new Set([
  "精选餐厅", "待补充店名", "店铺待补充", "商家待补充", "地点待补充", "地点待定", "待定",
]);
const PLACEHOLDER_ADDRESSES = new Set(["待补充地址", "地址待补充"]);

function withoutPlaceholder(value, placeholders) {
  const text = String(value || "").trim();
  return text && !placeholders.has(text) ? text : "";
}

function historyTitle(value) {
  return withoutPlaceholder(value, PLACEHOLDER_TITLES) || "标题待补充";
}

function toAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatParticipants(value) {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item : item && item.name)).filter(Boolean).join("、");
  }
  return typeof value === "string" ? value : "";
}

function formatFeedbackComment(feedback = {}) {
  if (typeof feedback.comment === "string" && feedback.comment.trim()) {
    return feedback.comment;
  }
  if (Array.isArray(feedback.tags)) {
    return feedback.tags.filter((tag) => typeof tag === "string" && tag.trim()).join(" · ");
  }
  // 兼容早期版本直接保存字符串标签的记录，避免一条旧记录让整页聚合失败。
  return typeof feedback.tags === "string" ? feedback.tags : "";
}

function getPlanLogCouponId(log = {}, planById = new Map()) {
  if (log.entityType !== "plan") return "";
  const snapshot = log.executionSnapshot || {};
  const planSnapshot = snapshot.planSnapshot || {};
  const couponSnapshot = snapshot.couponSnapshot || {};
  const storedPlan = planById.get(log.entityId) || {};
  return String(
    log.couponId
      || snapshot.couponId
      || planSnapshot.couponId
      || couponSnapshot.id
      || storedPlan.couponId
      || ""
  );
}

function getCouponLogCouponId(log = {}) {
  if (log.entityType !== "coupon") return "";
  const snapshot = log.executionSnapshot || {};
  const couponSnapshot = snapshot.couponSnapshot || {};
  return String(log.entityId || snapshot.couponId || couponSnapshot.id || "");
}

function aggregateCompletedRecords(completedLogs = [], allPlans = [], allCoupons = []) {
  const logPlanIds = new Set();
  const logCouponIds = new Set();
  const planLogCouponIds = new Set();
  const planById = new Map();
  const couponById = new Map();

  allPlans.forEach((plan) => {
    if (plan && plan.id) planById.set(plan.id, plan);
  });
  allCoupons.forEach((coupon) => {
    if (coupon && coupon.id) couponById.set(coupon.id, coupon);
  });

  completedLogs.forEach((l) => {
    if (l.entityType === "plan") logPlanIds.add(l.entityId);
    const planCouponId = getPlanLogCouponId(l, planById);
    const couponLogId = getCouponLogCouponId(l);
    if (planCouponId) planLogCouponIds.add(planCouponId);
    if (couponLogId) logCouponIds.add(couponLogId);
  });

  // Older versions wrote both a plan-completed log and a coupon-completed log
  // for the same fulfilment. Prefer the richer plan snapshot in that case.
  const visibleCompletedLogs = completedLogs.filter((log) => {
    const couponLogId = getCouponLogCouponId(log);
    return !couponLogId || !planLogCouponIds.has(couponLogId);
  });

  const completedPlans = allPlans.filter(
    (p) => ["completed", "used", "completed_used"].includes(p.statusCode)
      && !logPlanIds.has(p.id)
      && !(p.couponId && logCouponIds.has(p.couponId))
  );

  const planCouponIds = new Set();
  completedPlans.forEach((p) => { if (p.couponId) planCouponIds.add(p.couponId); });
  planLogCouponIds.forEach((id) => planCouponIds.add(id));

  const standaloneUsedCoupons = allCoupons.filter(
    (c) => c.statusCode === "used" && !planCouponIds.has(c.id) && !logCouponIds.has(c.id)
  );

  const combinedRecords = [];

  visibleCompletedLogs.forEach((log) => {
    const snap = log.executionSnapshot || {};
    const fin = log.finance || {};
    const fb = log.feedback || {};
    const couponId = getCouponLogCouponId(log) || getPlanLogCouponId(log, planById);
    combinedRecords.push({
      id: log.entityId || log.logId,
      couponId,
      isPlan: log.entityType === "plan",
      title: historyTitle(log.title),
      price: toAmount(fin.actualPaid),
      originalPrice: toAmount(fin.originalPrice),
      saved: toAmount(fin.savedAmount),
      category: log.category || "",
      type: snap.type || log.category || "",
      date: snap.scheduledDate || (log.timestamp ? String(log.timestamp).split(" ")[0] : ""),
      time: snap.scheduledTime || "已完成",
      venue: withoutPlaceholder(snap.venue, PLACEHOLDER_VENUES),
      address: withoutPlaceholder(snap.address, PLACEHOLDER_ADDRESSES),
      latitude: snap.latitude,
      longitude: snap.longitude,
      dishes: snap.dishes || "",
      people: snap.people || "",
      participants: formatParticipants(snap.participants),
      hasFeedback: Boolean(fb.rating),
      feedbackRating: fb.rating || 0,
      feedbackRatingStars: formatStars(fb.rating || 0),
      feedbackComment: formatFeedbackComment(fb),
      note: snap.note || "",
      platform: log.platform || "",
    });
  });

  completedPlans.forEach((plan) => {
    const coupon = couponById.get(plan.couponId);
    const price = coupon && Number(coupon.price) > 0 ? Number(coupon.price) : Number(plan.price || 0);
    const originalPrice = coupon && Number(coupon.originalPrice) > 0 ? Number(coupon.originalPrice) : 0;
    const saved = originalPrice > price ? (originalPrice - price) : 0;
    const cat = (coupon && (coupon.type || coupon.category)) || plan.category || "";
    const rawDate = (plan.selectedTime && plan.selectedTime.date) || plan.date || "";
    const fb = plan.feedback || {};
    const loc = plan.location || (coupon && coupon.location) || {};

    combinedRecords.push({
      id: plan.id,
      isPlan: true,
      title: historyTitle(plan.title),
      price,
      originalPrice,
      saved,
      category: cat,
      type: (coupon && coupon.type) || cat,
      date: rawDate,
      time: (plan.selectedTime && plan.selectedTime.startTime) || plan.time || "",
      venue: withoutPlaceholder(loc.name, PLACEHOLDER_VENUES)
        || withoutPlaceholder(plan.venue, PLACEHOLDER_VENUES)
        || withoutPlaceholder(coupon && coupon.venue, PLACEHOLDER_VENUES),
      address: withoutPlaceholder(loc.address, PLACEHOLDER_ADDRESSES)
        || withoutPlaceholder(coupon && coupon.address, PLACEHOLDER_ADDRESSES),
      latitude: loc.latitude !== undefined ? loc.latitude : (coupon && coupon.latitude),
      longitude: loc.longitude !== undefined ? loc.longitude : (coupon && coupon.longitude),
      dishes: (coupon && coupon.dishes) || "",
      people: (coupon && coupon.people) || "",
      participants: formatParticipants(plan.withText || plan.participants),
      hasFeedback: Boolean(fb.rating),
      feedbackRating: fb.rating || 0,
      feedbackRatingStars: formatStars(fb.rating || 0),
      feedbackComment: formatFeedbackComment(fb),
      note: plan.note || "",
      platform: (coupon && coupon.platform) || plan.platform || "",
    });
  });

  standaloneUsedCoupons.forEach((coupon) => {
    const price = Number(coupon.price || 0);
    const originalPrice = Number(coupon.originalPrice || 0);
    const saved = originalPrice > price ? (originalPrice - price) : 0;
    const loc = coupon.location || {};
    combinedRecords.push({
      id: `c_${coupon.id}`,
      couponId: coupon.id,
      isPlan: false,
      title: historyTitle(coupon.title),
      price,
      originalPrice,
      saved,
      category: coupon.type || coupon.category || "",
      type: coupon.type || coupon.category || "",
      date: coupon.usedAt || "",
      time: "已核销",
      venue: withoutPlaceholder(coupon.venue, PLACEHOLDER_VENUES)
        || withoutPlaceholder(loc.name, PLACEHOLDER_VENUES),
      address: withoutPlaceholder(coupon.address, PLACEHOLDER_ADDRESSES)
        || withoutPlaceholder(loc.address, PLACEHOLDER_ADDRESSES),
      latitude: coupon.latitude !== undefined ? coupon.latitude : loc.latitude,
      longitude: coupon.longitude !== undefined ? coupon.longitude : loc.longitude,
      dishes: coupon.dishes || "",
      people: coupon.people || "",
      participants: "我",
      hasFeedback: false,
      feedbackRating: 0,
      feedbackRatingStars: "",
      feedbackComment: "",
      note: coupon.note || "券包直接标记使用",
      platform: coupon.platform || "",
    });
  });

  combinedRecords.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return combinedRecords;
}

function calculateCompletedStats(combinedRecords = []) {
  let totalCost = 0;
  let totalOriginalPrice = 0;
  let totalSaved = 0;
  const categoryCounts = new Map();
  const friendCounts = new Map();

  combinedRecords.forEach((item) => {
    const price = toAmount(item.price);
    const originalPrice = toAmount(item.originalPrice);
    totalCost += price;
    totalOriginalPrice += originalPrice > 0 ? originalPrice : (price > 0 ? price : 0);
    totalSaved += toAmount(item.saved);
    if (item.category) categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1);

    const participants = formatParticipants(item.participants);
    if (participants) {
      participants.split("、").forEach((p) => {
        const name = p.trim();
        if (name && !["我", "自己"].includes(name)) {
          friendCounts.set(name, (friendCounts.get(name) || 0) + 1);
        }
      });
    }
  });

  let favoriteCategory = "无";
  let maxCount = 0;
  for (const [cat, cnt] of categoryCounts.entries()) {
    if (cnt > maxCount) { maxCount = cnt; favoriteCategory = cat; }
  }

  let topFriend = "无";
  let maxFriendCount = 0;
  for (const [name, cnt] of friendCounts.entries()) {
    if (cnt > maxFriendCount) { maxFriendCount = cnt; topFriend = name; }
  }

  const avgDiscount = (totalOriginalPrice > 0 && totalSaved > 0) ? `${((totalCost / totalOriginalPrice) * 10).toFixed(1)}折` : "";

  return {
    count: combinedRecords.length,
    totalCost: totalCost.toFixed(1),
    totalSaved: totalSaved.toFixed(1),
    totalSavedNum: Number(totalSaved.toFixed(1)),
    avgDiscount,
    favoriteCategory,
    topFriend,
  };
}

function calculateAchievementBadges(stats) {
  const { totalSavedNum = 0, count = 0, topFriend = "无", avgDiscount = "" } = stats || {};

  return [
    {
      id: "saver", icon: "🎖️", title: "省钱达人", desc: "累计节省超 ¥100",
      unlocked: totalSavedNum >= 100, progress: `${Math.min(100, Math.round((totalSavedNum / 100) * 100))}%`,
    },
    {
      id: "explorer", icon: "🍽️", title: "探店先锋", desc: "打卡 5 次优质出行",
      unlocked: count >= 5, progress: `${Math.min(100, Math.round((count / 5) * 100))}%`,
    },
    {
      id: "partner", icon: "🤝", title: "黄金搭子", desc: "与好友共同就餐",
      unlocked: topFriend !== "无", progress: topFriend !== "无" ? "100%" : "0%",
    },
    {
      id: "expert", icon: "💎", title: "羊毛专家", desc: "享 7 折及以下折扣",
      unlocked: Boolean(avgDiscount && parseFloat(avgDiscount) <= 7.0),
      progress: avgDiscount && parseFloat(avgDiscount) <= 7.0 ? "100%" : "50%",
    },
  ];
}

function groupRecordsByMonth(combinedRecords = []) {
  const groups = {};
  combinedRecords.forEach((item) => {
    let monthLabel = "日期待补充";
    const matched = String(item.date).match(/^(\d{4})[-/](\d{1,2})/);
    const monthNumber = matched ? Number(matched[2]) : 0;
    if (matched && monthNumber >= 1 && monthNumber <= 12) {
      monthLabel = `${matched[1]}年${String(monthNumber).padStart(2, "0")}月`;
    }
    if (!groups[monthLabel]) groups[monthLabel] = [];
    groups[monthLabel].push(item);
  });

  const months = Object.keys(groups).map((label) => ({ label, plans: groups[label] }));
  months.sort((a, b) => {
    if (a.label === "日期待补充") return 1;
    if (b.label === "日期待补充") return -1;
    return b.label.localeCompare(a.label);
  });
  return months;
}

function sliceMonthGroups(months = [], offset = 0, limit = 40) {
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.max(0, Number(limit) || 0);
  if (!safeLimit) return [];

  const pageEnd = safeOffset + safeLimit;
  let recordOffset = 0;
  const visibleMonths = [];
  (Array.isArray(months) ? months : []).forEach((month) => {
    const plans = month && Array.isArray(month.plans) ? month.plans : [];
    const monthStart = recordOffset;
    const monthEnd = monthStart + plans.length;
    recordOffset = monthEnd;
    if (monthEnd <= safeOffset || monthStart >= pageEnd) return;

    const localStart = Math.max(0, safeOffset - monthStart);
    const localEnd = Math.min(plans.length, pageEnd - monthStart);
    if (localStart >= localEnd) return;
    visibleMonths.push({
      label: month.label,
      plans: plans.slice(localStart, localEnd),
    });
  });
  return visibleMonths;
}

module.exports = {
  aggregateCompletedRecords,
  calculateCompletedStats,
  calculateAchievementBadges,
  groupRecordsByMonth,
  sliceMonthGroups,
};
