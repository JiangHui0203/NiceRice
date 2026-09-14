const { isActivePlanStatus } = require("../../utils/plan/planStatus.js");

function buildActiveCell(options = {}) {
  const dayIndex = Number(options.dayIndex);
  const sceneIndex = Number(options.sceneIndex);
  const row = (options.heatmapRows || [])[sceneIndex];
  const cell = row && (row.cells || [])[dayIndex];
  const scene = (options.scenes || [])[sceneIndex];
  const day = (options.weekdays || [])[dayIndex];

  if (!cell || !scene || !day) return null;
  const rangeMatch = String(scene.timeRange || "").match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  const start = scene.start || scene.startTime || (rangeMatch && rangeMatch[1]) || "";
  const end = scene.end || scene.endTime || (rangeMatch && rangeMatch[2]) || "";

  return Object.assign({}, cell, {
    day,
    scene: scene.name,
    emoji: scene.emoji || "📅",
    start,
    end,
    timeRange: scene.timeRange || (start && end ? `${start} - ${end}` : ""),
    friendStatus: cell.friendStatus || [],
  });
}

function planMatchesSlot(plan = {}, day = "", scene = "") {
  const source = plan && typeof plan === "object" ? plan : {};
  const selectedTime = source.selectedTime && typeof source.selectedTime === "object"
    ? source.selectedTime
    : {};
  const label = String(selectedTime.label || "");
  let weekday = String(selectedTime.weekday || "").replace("星期", "周").replace("周天", "周日");
  if (!weekday && selectedTime.date) {
    const matched = String(selectedTime.date).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (matched) {
      const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
      const isExactDate = !Number.isNaN(date.getTime())
        && date.getFullYear() === Number(matched[1])
        && date.getMonth() === Number(matched[2]) - 1
        && date.getDate() === Number(matched[3]);
      if (isExactDate) {
        weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
      }
    }
  }
  const dayMatches = weekday ? weekday === day : label.includes(day);
  const sceneMatches = selectedTime.scene ? selectedTime.scene === scene : label.includes(scene);
  return dayMatches && sceneMatches;
}

function findPlanForSlot(plans = [], day = "", scene = "") {
  return plans.find((plan) => {
    const status = String((plan && plan.statusCode) || "");
    return (!status || isActivePlanStatus(status)) && planMatchesSlot(plan, day, scene);
  }) || null;
}

function buildPlanSlotMap(plans = [], weekdays = [], scenes = []) {
  const slotMap = Object.create(null);
  plans.forEach((plan) => {
    const status = String((plan && plan.statusCode) || "");
    if (status && !isActivePlanStatus(status)) return;
    weekdays.forEach((day) => {
      scenes.forEach((scene) => {
        if (planMatchesSlot(plan, day, scene.name)) {
          const key = `${day}_${scene.name}`;
          if (!slotMap[key]) slotMap[key] = plan;
        }
      });
    });
  });
  return slotMap;
}

function couponMatchesScene(coupon = {}, sceneName = "") {
  if (["draft", "planned", "used", "expired"].includes(coupon.statusCode || coupon.status)) return false;
  const type = coupon.type || "其他";
  return sceneName === "下午茶"
    ? type === "咖啡甜品" || coupon.category === "play"
    : type !== "咖啡甜品";
}

function couponPriority(coupon = {}) {
  if (coupon.stateClass === "urgent") return 0;
  if (coupon.stateClass === "priority") return 1;
  return 2;
}

function couponScore(coupon = {}) {
  const recommendationScore = coupon.recommendationScore;
  if (recommendationScore !== "" && recommendationScore !== null && recommendationScore !== undefined
    && Number.isFinite(Number(recommendationScore))) {
    return Number(recommendationScore);
  }
  return Number.isFinite(Number(coupon.score)) ? Number(coupon.score) : 0;
}

function getRecommendedCoupons(coupons = [], sceneName = "", limit = 3) {
  return coupons
    .filter((coupon) => couponMatchesScene(coupon, sceneName))
    .sort((left, right) => {
      const priorityDiff = couponPriority(left) - couponPriority(right);
      return priorityDiff || couponScore(right) - couponScore(left);
    })
    .slice(0, limit);
}

function buildSceneCouponCache(coupons = [], scenes = []) {
  return scenes.reduce((cache, scene) => {
    cache[scene.name] = getRecommendedCoupons(coupons, scene.name);
    return cache;
  }, Object.create(null));
}

function compactHeatmapRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => Object.assign({}, row, {
    cells: (Array.isArray(row && row.cells) ? row.cells : []).map((cell) => {
      if (!cell || typeof cell !== "object") return cell;
      const compact = Object.assign({}, cell);
      delete compact.availableFriends;
      delete compact.friendStatus;
      return compact;
    }),
  }));
}

module.exports = {
  buildActiveCell,
  buildPlanSlotMap,
  buildSceneCouponCache,
  compactHeatmapRows,
  couponMatchesScene,
  findPlanForSlot,
  getRecommendedCoupons,
  planMatchesSlot,
};
