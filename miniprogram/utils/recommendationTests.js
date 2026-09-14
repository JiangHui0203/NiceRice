const recommendation = require("./recommendation.js");

function buildTestCoupons() {
  return [
    {
      id: "test_noodle_urgent",
      title: "牛肉面单人套餐",
      venue: "测试面馆",
      type: "粉面",
      category: "food",
      people: "1人",
      expireDate: "2026-06-01",
      usableTime: "11:00-20:30",
      travelTime: "12分钟",
      price: "29",
      tags: ["快速", "适合午餐"],
    },
    {
      id: "test_hotpot_cleanup",
      title: "涮羊肉双人套餐",
      venue: "测试铜锅",
      type: "火锅",
      category: "food",
      people: "2人",
      expireDate: "2026-06-03",
      usableTime: "17:00-22:00",
      travelTime: "28分钟",
      price: "168",
      reservationRequired: true,
      tags: ["味道大", "需要洗澡洗头", "雨天适合"],
    },
    {
      id: "test_park_rain",
      title: "湖边公园游船票",
      venue: "测试公园",
      type: "公园",
      category: "outdoor",
      people: "2人",
      expireDate: "2026-06-10",
      usableTime: "09:00-18:00",
      travelTime: "42分钟",
      tags: ["户外", "晴天适合"],
    },
    {
      id: "test_bbq_far",
      title: "城郊烧烤双人券",
      venue: "测试烧烤",
      type: "烧烤",
      category: "food",
      people: "2人",
      expireDate: "2026-06-04",
      usableTime: "18:00-23:00",
      travelTime: "78分钟",
      tags: ["味道大", "需要洗澡洗头"],
    },
    {
      id: "test_reservation_urgent",
      title: "需要预约双人套餐",
      venue: "测试餐厅",
      type: "火锅",
      category: "food",
      people: "2人",
      expireDate: "2026-06-01",
      usableTime: "17:00-22:00",
      travelTime: "26分钟",
      reservationRequired: true,
      usageRules: {
        needReservation: true,
        reservationLeadTimeHours: 24,
        notes: "需提前一天预约",
      },
      tags: ["需要预约", "味道大"],
    },
    {
      id: "test_dislike_conflict",
      title: "香菜牛肉粉",
      venue: "测试粉店",
      type: "粉面",
      category: "food",
      people: "1人",
      expireDate: "2026-06-05",
      usableTime: "11:00-20:00",
      travelTime: "15分钟",
      tags: ["快速"],
    },
  ];
}

function runRecommendationRegression() {
  const context = recommendation.buildRecommendationContext({
    now: new Date("2026-05-31T10:00:00"),
    weather: {
      title: "小雨",
      desc: "适合室内，户外体验一般。",
      temperature: "18-24°",
      tips: ["带伞"],
    },
    userPreference: {
      likedFoods: ["热汤", "粉面"],
      dislikedFoods: ["香菜"],
      commuteLimit: "45分钟",
    },
  });
  return buildTestCoupons().map((coupon) => {
    const result = recommendation.generateRecommendation(coupon, context);
    return {
      couponId: coupon.id,
      title: coupon.title,
      score: result.score,
      level: result.level,
      statusLabel: result.statusLabel,
      firstReason: result.reasons[0] || "",
      firstWarning: result.warnings[0] || "",
      firstBlocker: result.blockers[0] || "",
      pass: Boolean(result.level && (result.level === "blocked" || result.score > 0)),
    };
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runAssertions() {
  const rows = runRecommendationRegression();
  rows.forEach((row) => {
    assert(row.pass, `推荐回归失败：${row.couponId}`);
  });

  const context = recommendation.buildRecommendationContext({
    now: new Date("2026-06-11T03:00:00"),
    friends: [{
      name: "小王",
      slots: ["周四 18:00-22:00", "周五 18:00-22:00", "周六 13:00-18:00"],
    }],
    userSchedule: [],
  });
  const expiringCoupon = {
    id: "test_expire_boundary",
    title: "临期火锅券",
    type: "火锅",
    category: "food",
    people: "2人",
    expireDate: "2026-06-14",
    usableTime: "17:00-22:00",
    travelTime: "28分钟",
    price: "168",
    tags: ["味道大"],
  };
  const result = recommendation.generateRecommendation(expiringCoupon, context);
  assert(result.recommendedTime, "临期券应能在过期日前找到可用时间");
  assert(result.recommendedTime.date <= expiringCoupon.expireDate, "推荐时间不能晚于券过期日");

  // 验证生命条分段与衰减算法 (<=3天红色，4-10天黄色，11天往上绿色)
  const couponStore = require("./couponStore.js");
  const urgentLife3 = couponStore.computeCouponLifeProgress(3, "unplanned");
  assert(urgentLife3.lifeColorClass === "urgent" && urgentLife3.lifeBarColor === "#e25c5c", "3天内应为红色 urgent");

  const watchLife7 = couponStore.computeCouponLifeProgress(7, "unplanned");
  assert(watchLife7.lifeColorClass === "watch" && watchLife7.lifeBarColor === "#eab308", "4-10天内应为黄色 watch");

  const readyLife14 = couponStore.computeCouponLifeProgress(14, "unplanned");
  assert(readyLife14.lifeColorClass === "ready" && readyLife14.lifeBarColor === "#3aafa9", "11天往上应为绿色 ready");

  const expiredLife = couponStore.computeCouponLifeProgress(-1, "expired");
  assert(expiredLife.expiryProgress === 0 && expiredLife.lifeColorClass === "expired", "过期券生命条应归零");

  // 验证基于经纬度的动态测距
  const routeService = require("./services/routeService.js");
  const originWork = { latitude: 39.9928, longitude: 116.4782 };
  const destNear = { latitude: 39.9982, longitude: 116.4812 };
  const distRes = routeService.getDynamicDistance({ location: destNear }, originWork);
  assert(distRes.distanceMeters > 0 && distRes.distanceMeters < 1500, "近距离店铺应计算出真实米数");
  assert(distRes.distanceKmText.includes("m") || distRes.distanceKmText.includes("km"), "应生成有效距离文案");

  const crossRegionCoupon = {
    id: "test_cross_region",
    title: "跨城体验券",
    venue: "异地门店",
    type: "其他",
    category: "life",
    people: "1人",
    expireDate: "2026-09-05",
    usableTime: "09:00-21:00",
    latitude: 22.5412,
    longitude: 113.9482,
    travelTime: "10分钟",
    state: "优先",
    stateClass: "priority",
  };
  const crossRegionContext = recommendation.buildRecommendationContext({
    now: new Date("2026-08-30T10:00:00"),
    routeOrigin: originWork,
    weather: { source: "local", mainCondition: "cloudy" },
    userPreference: {},
    userSchedule: [],
    friends: [],
  });
  const crossRegionResult = recommendation.generateRecommendation(crossRegionCoupon, crossRegionContext);
  const crossRegionView = recommendation.mergeCouponRecommendation(
    crossRegionCoupon,
    crossRegionResult,
    crossRegionContext,
  );
  assert(crossRegionResult.level === "blocked", "跨城券不能进入首选推荐");
  assert(crossRegionResult.blockers.some((text) => /异地|跨城|距离过远/.test(text)), "跨城券应给出明确阻断原因");
  assert(crossRegionView.travelTime === "异地商户", "跨城券不能展示数千分钟的伪精确耗时");
  assert(crossRegionView.stateClass === "blocked", "硬阻断状态不能被临期或优先样式覆盖");

  const lifeCoupon = {
    id: "test_life_copy",
    title: "普拉提私教体验课",
    venue: "测试运动工作室",
    type: "瑜伽普拉提",
    category: "life",
    people: "1人",
    expireDate: "2026-09-05",
    usableTime: "09:00-21:00",
    travelTime: "10分钟",
  };
  const lifeContext = recommendation.buildRecommendationContext({
    now: new Date("2026-08-30T10:30:00"),
    weather: { source: "local", mainCondition: "cloudy" },
    userPreference: { likedFoods: ["面食"], dislikedFoods: ["香菜"] },
    userSchedule: [],
    friends: [],
  });
  const lifeResult = recommendation.generateRecommendation(lifeCoupon, lifeContext);
  const lifeView = recommendation.mergeCouponRecommendation(lifeCoupon, lifeResult, lifeContext);
  const affinityLabel = lifeResult.recommendedTime && lifeResult.recommendedTime.timeAffinityBadge
    ? lifeResult.recommendedTime.timeAffinityBadge.label
    : "";
  assert(!/午市|就餐|饭/.test(affinityLabel), "非餐饮券不能显示餐饮时段徽章");
  assert(!/就餐|好好吃饭/.test(lifeView.diningPerspectiveText), "非餐饮券不能显示就餐视角文案");
  assert(!lifeView.highlightTags.some((tag) => tag.type === "food"), "非餐饮券不能生成口味标签");
}

if (require.main === module) {
  runAssertions();
  console.log("recommendation tests ok");
}

module.exports = {
  buildTestCoupons,
  runRecommendationRegression,
  runAssertions,
};
