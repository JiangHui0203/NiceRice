const assert = require("assert");
const fs = require("fs");
const path = require("path");
const couponStore = require("../../utils/couponStore.js");
const { buildDashboardState, resolveLocationLabels } = require("./dashboardBuilder.js");

const labels = resolveLocationLabels(
  { role: "gps", latitude: 0, longitude: 0, name: "当前位置", address: "实时定位" },
  { locationName: "当前位置" },
);
assert.notStrictEqual(labels.currentOriginDetail, "点击获取实时定位");

const homeTemplate = fs.readFileSync(path.join(__dirname, "index.wxml"), "utf8");
assert.ok(homeTemplate.includes('wx:if="{{hasRecommendation}}"'), "首页应保留有推荐分支");
assert.ok(homeTemplate.includes('wx:else class="today-empty-dashed-card"'), "首页应保留原有空状态分支");
assert.ok(homeTemplate.includes('class="recommend-summary"'), "首选卡应使用紧凑推荐摘要");
assert.ok(!homeTemplate.includes('class="human-rationale-box"'), "首页不应重复展示整段推荐长文");
assert.ok(!homeTemplate.includes('class="dining-perspective-row"'), "首页不应额外堆叠就餐视角模块");
assert.ok(!homeTemplate.includes('<view class="section" wx:if="{{priorityList.length}}">'), "备选分区不应随空数据消失");
assert.ok(!homeTemplate.includes('<view class="section" wx:if="{{weeklyArrangement && weeklyArrangement.items.length}}">'), "周排程分区不应随空数据消失");
assert.strictEqual((homeTemplate.match(/class="section-empty-card/g) || []).length, 2, "首页下半区应提供两个明确空状态");

const blockedDashboard = buildDashboardState({
  coupons: [{
    id: "cross_region_home_test",
    title: "异地体验券",
    venue: "异地门店",
    category: "life",
    type: "其他",
    people: "1人",
    statusCode: "pending",
    expireDate: "2099-12-31",
    usableTime: "09:00-21:00",
    latitude: 22.5412,
    longitude: 113.9482,
    travelTime: "10分钟",
  }],
  plans: [],
  rawWeather: { source: "local", mainCondition: "cloudy", temperature: "20-26" },
  activeRouteOrigin: { latitude: 39.9928, longitude: 116.4782 },
});
assert.strictEqual(blockedDashboard.hasRecommendation, false, "跨城券不能进入今日首选");
assert.deepStrictEqual(blockedDashboard.priorityList, [], "跨城券不能伪装成备选顺位");

const sampleDashboard = buildDashboardState({
  coupons: couponStore.getAllCoupons(),
  plans: [],
  rawWeather: { source: "local", mainCondition: "cloudy", temperature: "20-26" },
  activeRouteOrigin: { latitude: 22.5431, longitude: 114.0579 },
});
assert.ok(sampleDashboard.priorityList.length > 0, "原型演示数据应继续填充备选顺位");
assert.ok(sampleDashboard.weeklyArrangement.items.length > 0, "原型演示数据应继续填充本周排程");

console.log("dashboard builder tests ok");
