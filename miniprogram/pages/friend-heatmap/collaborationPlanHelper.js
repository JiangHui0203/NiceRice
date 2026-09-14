const {
  ensureSelfParticipant,
  getLocalDateForWeekday,
  isSelfParticipant,
  resolvePlanStatus,
} = require("./heatmapHelper.js");

function getSelectedFriends(friends = [], selectedFriendIds = []) {
  return friends.filter((friend) => selectedFriendIds.includes(friend.id || friend.name));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidTime(value) {
  const matched = normalizeText(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return false;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function getCouponDistanceText(coupon = {}) {
  const travelTime = normalizeText(coupon.travelTime);
  if (!/\d/.test(travelTime)) return "待估算";
  return /^(?:路程|约)/.test(travelTime) ? travelTime : `约${travelTime}`;
}

function normalizeTargetCell(cell = {}) {
  const day = normalizeText(cell.day);
  const scene = normalizeText(cell.scene || cell.sceneName);
  const startTime = normalizeText(cell.start);
  const endTime = normalizeText(cell.end);
  if (!day || !scene || !isValidTime(startTime) || !isValidTime(endTime)) return null;
  const date = getLocalDateForWeekday(day, endTime, startTime);
  return date ? { day, scene, startTime, endTime, date } : null;
}

function buildParticipants(friends = [], selectedFriendIds = [], availableFriends = null) {
  const selectedFriends = getSelectedFriends(friends, selectedFriendIds);
  const selfFriend = friends.find(isSelfParticipant) || {};
  const participants = selectedFriends.map((friend) => ({
    id: friend.id || friend.name,
    name: friend.name,
    isSelf: isSelfParticipant(friend),
    status: isSelfParticipant(friend) ? "confirmed" : "pending",
  }));
  return ensureSelfParticipant(participants, selfFriend);
}

function buildCouponSlotPlan(options = {}) {
  const coupon = options.coupon || {};
  const activeCell = options.activeCell || {};
  const targetCell = normalizeTargetCell(activeCell);
  const title = normalizeText(coupon.title);
  if (!targetCell || !title) return null;
  const participants = buildParticipants(
    options.friends,
    options.selectedFriendIds,
    activeCell.availableFriends || []
  );
  const now = typeof options.now === "function" ? options.now() : Date.now();

  return {
    id: `plan_hm_${now}`,
    couponId: coupon.id,
    title,
    type: coupon.type || "聚餐",
    category: coupon.category || "food",
    platform: normalizeText(coupon.platform),
    price: coupon.price || "",
    originalPrice: coupon.originalPrice || "",
    isCollaborative: true,
    statusCode: resolvePlanStatus(participants, true),
    selectedTime: {
      date: targetCell.date,
      startTime: targetCell.startTime,
      endTime: targetCell.endTime,
      scene: targetCell.scene,
      label: `${targetCell.day} ${targetCell.scene}`,
    },
    location: {
      name: coupon.venue || coupon.merchantName || "",
      address: normalizeText(coupon.address || (coupon.location && coupon.location.address)),
      latitude: coupon.latitude != null ? coupon.latitude : (coupon.location && coupon.location.latitude),
      longitude: coupon.longitude != null ? coupon.longitude : (coupon.location && coupon.location.longitude),
      distanceText: getCouponDistanceText(coupon),
    },
    participants,
    dishes: coupon.dishes || "",
    note: `根据「有时好饭」好友空档热力图所选时段创建。\n参与人：${participants.map((participant) => participant.name).join("、")}`,
  };
}

function findBestAvailableCell(heatmapRows = []) {
  for (const row of heatmapRows) {
    for (const cell of row.cells || []) {
      if (cell.activeClass === "level-full") {
        const candidate = {
          day: cell.day,
          scene: cell.sceneName,
          start: cell.start,
          end: cell.end,
          timeRange: cell.timeRange,
          availableFriends: cell.availableFriends,
        };
        if (normalizeTargetCell(candidate)) return candidate;
      }
    }
  }
  return null;
}

function buildCandidateSlotPlan(options = {}) {
  const selectedCoupon = options.selectedCoupon || null;
  const selectedCustom = options.selectedCustom || null;
  if ((!selectedCoupon && !selectedCustom) || (selectedCoupon && selectedCustom)) {
    return { error: "请选择一个候选方案" };
  }
  const rawTargetCell = options.activeCell || findBestAvailableCell(options.heatmapRows);
  const targetCell = normalizeTargetCell(rawTargetCell);
  if (!targetCell) return { error: "没有可用于排期的完整空档时段" };
  const { day, scene, startTime, endTime, date } = targetCell;
  const participants = buildParticipants(options.friends, options.selectedFriendIds);
  const title = normalizeText(selectedCoupon ? selectedCoupon.title : selectedCustom.title);
  if (!title) return { error: "候选方案名称不能为空" };
  const now = typeof options.now === "function" ? options.now() : Date.now();

  return {
    title,
    day,
    scene,
    plan: {
      id: `plan_cand_${now}`,
      couponId: selectedCoupon && !selectedCoupon.isSharedCandidate ? selectedCoupon.id : null,
      title,
      type: selectedCoupon ? (selectedCoupon.type || "聚会活动") : "聚会活动",
      category: selectedCoupon ? (selectedCoupon.category || "social") : "social",
      platform: selectedCoupon ? normalizeText(selectedCoupon.platform) : "自定义",
      price: selectedCoupon ? selectedCoupon.price : "",
      originalPrice: selectedCoupon ? selectedCoupon.originalPrice : "",
      isCollaborative: true,
      statusCode: resolvePlanStatus(participants, true),
      selectedTime: {
        date,
        startTime,
        endTime,
        scene,
        label: `${day} ${scene}`,
      },
      location: selectedCoupon ? {
        name: selectedCoupon.venue || selectedCoupon.merchantName || "",
        address: normalizeText(selectedCoupon.address || (selectedCoupon.location && selectedCoupon.location.address)),
        latitude: selectedCoupon.latitude != null ? selectedCoupon.latitude : (selectedCoupon.location && selectedCoupon.location.latitude),
        longitude: selectedCoupon.longitude != null ? selectedCoupon.longitude : (selectedCoupon.location && selectedCoupon.location.longitude),
        distanceText: getCouponDistanceText(selectedCoupon),
      } : {
        name: "待定地点",
        address: "",
        distanceText: "待估算",
      },
      participants,
      dishes: (selectedCoupon && selectedCoupon.dishes) || "",
      note: `由约局候选卡一键写入协同日程。\n协同好友：${participants.map((participant) => participant.name).join("、")}`,
    },
  };
}

function buildSlotScheduleText(options = {}) {
  const activeCell = options.activeCell;
  if (!activeCell) return "";

  const selectedFriends = getSelectedFriends(options.friends, options.selectedFriendIds);
  const freeFriends = (activeCell.availableFriends || []).map((friend) => friend.name);
  const busyFriends = selectedFriends
    .filter((friend) => !freeFriends.includes(friend.name))
    .map((friend) => friend.name);

  let text = "📅 【有时好饭】时段活动协同计划单\n";
  text += "================================\n";
  text += `⏰ 协同时间：本周${activeCell.day} · ${activeCell.scene} (${activeCell.timeRange})\n`;
  text += `👥 好友空档：${freeFriends.length}/${selectedFriends.length} 人有空\n`;
  text += `   🟢 有空：${freeFriends.join("、") || "暂无"}\n`;
  if (busyFriends.length > 0) text += `   🔴 冲突：${busyFriends.join("、")}\n`;

  const activeCellPlan = options.activeCellPlan;
  const recommendedCoupons = options.recommendedCoupons || [];
  if (activeCellPlan) {
    text += `\n🎯 已定活动：${activeCellPlan.title}\n`;
    text += `   📍 地点：${(activeCellPlan.location && activeCellPlan.location.name) || "待定"}\n`;
    if (activeCellPlan.price) text += `   💰 预算：¥${activeCellPlan.price}\n`;
    if (activeCellPlan.dishes) text += `   🍽️ 菜品：${activeCellPlan.dishes}\n`;
    if (activeCellPlan.note) text += `   💡 备注：${activeCellPlan.note}\n`;
  } else if (recommendedCoupons.length > 0) {
    text += "\n💡 推荐备选方案：\n";
    recommendedCoupons.slice(0, 2).forEach((coupon, index) => {
      text += `   选项 ${index + 1}：${coupon.title} (📍 ${coupon.venue || "店铺"} · ¥${coupon.price || "待定"})\n`;
    });
  }
  text += "\n================================\n";
  text += "来自小程序「有时好饭」🎯";
  return text;
}

module.exports = {
  buildCandidateSlotPlan,
  buildCouponSlotPlan,
  buildParticipants,
  buildSlotScheduleText,
  findBestAvailableCell,
};
