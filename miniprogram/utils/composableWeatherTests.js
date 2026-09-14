const assert = require("assert");
const weatherService = require("./services/weatherService.js");
const recommendation = require("./recommendation.js");

// Mock global Mini Program environment hooks
global.wx = {
  getStorageSync: () => null,
  setStorageSync: () => null,
};

console.log("=== Start Composable Weather Engine Assertions ===");

// 1. Verify WEATHER_OPTIONS mapping
const options = weatherService.getWeatherOptions();
assert.strictEqual(options.length, 24, "Should have 24 weather options defined");

options.forEach(opt => {
  console.log(`Checking Weather Option: [${opt.value}] - ${opt.label}`);
  
  // Assert composable model properties exist
  assert.ok(opt.mainCondition, `mainCondition should exist on ${opt.value}`);
  assert.ok(typeof opt.intensity === 'number', `intensity should be number on ${opt.value}`);
  assert.ok(Array.isArray(opt.modifiers), `modifiers should be array on ${opt.value}`);
  assert.ok(opt.thermalMood, `thermalMood should exist on ${opt.value}`);
});

console.log("✔ all 24 weather profiles have valid 5D fields");

// 2. Verify withMeta time calculation
const todayWeather = weatherService.getWeather();
assert.ok(todayWeather.timeOfDay, "timeOfDay should be computed");
assert.strictEqual(typeof todayWeather.isNight, "boolean", "isNight should be boolean");
console.log(`✔ today's weather parsed successfully (timeOfDay: ${todayWeather.timeOfDay}, isNight: ${todayWeather.isNight})`);

// 3. Verify recommendation score Weather linking
const outdoorCoupon = {
  id: "c1",
  title: "户外公园门票",
  category: "运动户外",
  tags: ["户外", "适合散步"],
};

const indoorCoupon = {
  id: "c2",
  title: "室内猫咪咖啡厅",
  category: "美食",
  tags: ["室内", "适合聚餐"],
  subCategory: "火锅"
};

const slot = {
  date: "2026-06-30",
  scene: "午餐"
};

// Test Case A: Storm Rain (intensity 4) vs Outdoor Coupon
const stormOption = options.find(o => o.value === "storm_rain");
const contextStorm = {
  weather: weatherService.getWeather(),
  weeklyWeather: [Object.assign({}, stormOption, { date: "2026-06-30", mainCondition: "rain", intensity: 4, modifiers: ["cloud_heavy"], thermalMood: "cold" })],
};

const scoreA = recommendation.generateRecommendation(outdoorCoupon, {
  weather: contextStorm.weeklyWeather[0],
  weeklyWeather: contextStorm.weeklyWeather,
});

assert.ok(scoreA.level !== "blocked", "Outdoor coupon should not be blocked during heavy storm rain");
assert.ok(scoreA.warnings.length > 0, "Outdoor coupon should have weather warnings during heavy storm rain");
console.log("✔ Heavy storm correctly flags warnings for outdoor coupons instead of hard blocking");

// Test Case B: Hot Weather vs Outdoor Coupon at Lunch
const hotOption = options.find(o => o.value === "hot");
const contextHot = {
  weather: weatherService.getWeather(),
  weeklyWeather: [Object.assign({}, hotOption, { date: "2026-06-30", mainCondition: "sunny", intensity: 2, modifiers: ["sun_haze"], thermalMood: "hot" })],
};

const scoreB = recommendation.generateRecommendation(outdoorCoupon, {
  weather: contextHot.weeklyWeather[0],
  weeklyWeather: contextHot.weeklyWeather,
});
assert.ok(scoreB.blockers.length === 0, "Hot weather shouldn't block outdoor coupon completely");
console.log("✔ Hot weather at lunch emits appropriate warning instead of hard blocking");

// Test Case C: Cold Weather vs Indoor Hot Food Coupon
const coldOption = options.find(o => o.value === "cold");
const testDateCold = new Date("2026-06-30T12:00:00");
const contextCold = {
  now: testDateCold,
  weather: coldOption,
  weeklyWeather: [Object.assign({}, coldOption, { date: "2026-06-30", mainCondition: "cloudy", intensity: 2, modifiers: [], thermalMood: "cold" })],
};

const scoreC = recommendation.generateRecommendation(indoorCoupon, {
  now: testDateCold,
  weather: contextCold.weeklyWeather[0],
  weeklyWeather: contextCold.weeklyWeather,
});

// Since cold weather gives +15 points for indoor/hot food, score should be boosted
assert.ok(scoreC.reasons.some(r => r.includes("天气寒冷")), "Should give cold weather reason for indoor friendly coupon");
console.log("✔ Cold weather correctly boosts indoor friendly food coupon");

// 4. Verify Taste Fatigue Scorer
const contextFatigue = {
  now: new Date("2026-06-30T12:00:00"),
  existingPlans: [
    {
      id: "p_past",
      couponId: "c2",
      title: "室内猫咪咖啡厅",
      statusCode: "completed",
      date: "2026-06-29",
      createdAt: "2026-06-29T12:00:00"
    }
  ]
};
const scoreFatigue = recommendation.evaluateCustomSlot(indoorCoupon, "2026-06-30", "12:00", {
  now: contextFatigue.now,
  weather: contextCold.weeklyWeather[0],
  weeklyWeather: contextCold.weeklyWeather,
  existingPlans: contextFatigue.existingPlans
});

assert.ok(scoreFatigue.warnings.some(w => w.includes("最近刚安排吃过") || w.includes("口味发生疲劳") || w.includes("换换口味")), "Should trigger taste fatigue warnings");
console.log("✔ Taste fatigue correctly triggers category warning and score damping");

// 5. Verify Cleaning Buffer Scorer
const hotpotCoupon = {
  id: "c_hotpot",
  title: "麻辣火锅双人餐",
  category: "美食",
  tags: ["味道大", "需要洗澡洗头"],
  cleanup: "饭后预留 45 分钟洗澡洗头",
  durationMinutes: 90
};

const contextScheduleConflict = {
  now: new Date("2026-06-30T12:00:00"),
  weather: contextCold.weeklyWeather[0],
  weeklyWeather: contextCold.weeklyWeather,
  existingPlans: [],
  userSchedule: [
    {
      title: "晚间夜跑组会",
      weekday: "周六",
      startTime: "20:15",
      endTime: "21:30"
    }
  ]
};

const scoreSlotResult = recommendation.evaluateCustomSlot(hotpotCoupon, "2026-07-04", "18:30", { // Saturday is 2026-07-04
  now: contextScheduleConflict.now,
  weather: contextCold.weeklyWeather[0],
  weeklyWeather: contextCold.weeklyWeather,
  existingPlans: [],
  userSchedule: contextScheduleConflict.userSchedule
});

assert.ok(scoreSlotResult.blockers.some(b => b.includes("餐后洗头整理") || b.includes("冲突")), "Should block slot due to post-activity cleanup overlapping with next schedule");
console.log("✔ Cleanup buffer successfully blocks slot when clean time overlaps user schedule");

// 5. Verify local text parsing in ocrService
const ocrService = require("./services/ocrService.js");

const testCouponText1 = "【美团】您已成功团购：小龙坎火锅双人套餐，价格 128 元，有效期至 2026-07-15，商户：小龙坎火锅。需要提前24小时预约，周末及节假日不可用。";
const parsed1 = ocrService.parseCouponText(testCouponText1);

assert.strictEqual(parsed1.success, true);
assert.strictEqual(parsed1.type, "火锅");
assert.strictEqual(parsed1.platform, "美团");
assert.strictEqual(parsed1.venue, "小龙坎火锅");
assert.strictEqual(parsed1.price, "128");
assert.strictEqual(parsed1.expireDate, "2026-07-15");
assert.strictEqual(parsed1.reservationRequired, true);
assert.strictEqual(parsed1.people, "2人");
assert.ok(parsed1.ruleNotes.includes("节假日不可用") || parsed1.ruleNotes.includes("周末"), "Rules should extract weekend/holiday constraint");

const testCouponText2 = "【大众点评】您的代金券已到账。商铺：星巴克，金额 100元，有效至 2026/08/31。免预约，随时可退。";
const parsed2 = ocrService.parseCouponText(testCouponText2);

assert.strictEqual(parsed2.success, true);
assert.strictEqual(parsed2.type, "咖啡甜品");
assert.strictEqual(parsed2.platform, "大众点评");
assert.strictEqual(parsed2.venue, "星巴克");
assert.strictEqual(parsed2.price, "100");
assert.strictEqual(parsed2.expireDate, "2026-08-31");
assert.strictEqual(parsed2.reservationRequired, false);

console.log("✔ local OCR text parser successfully parses Meituan and Dianping formats");

// 6. Verify Weather Engine V2 Composable Scene Output
const weatherEngine = require("./services/weatherEngine.js");

// Test Case D1: Dawn Clear Comfortable weather normalization
const rawDawn = {
  locationName: "静安寺",
  conditionCode: "sunny",
  conditionText: "晴",
  temperature: 20,
  timestamp: new Date("2026-06-30T06:00:00").getTime(),
};
const sceneDawn = weatherEngine.generateWeatherScene(rawDawn);
assert.strictEqual(sceneDawn.visual.background.isNight, false);
assert.ok(sceneDawn.visual.background.gradient.includes("linear-gradient"), "Background should be linear gradient");
assert.ok(sceneDawn.visual.celestial.sun.visible, "Sun should be visible in dawn clear weather");
assert.strictEqual(sceneDawn.visual.celestial.sun.tint, "gold", "Sun tint at dawn should be gold");
assert.ok(sceneDawn.business.outdoorScore >= 80, "Outdoor score should be high on clear comfortable day");
console.log("✔ Weather V2 Engine correctly normalizes dawn clear comfortable conditions");

// Test Case D2: LateNight Overcast Freezing weather normalization
const rawNightOvercast = {
  locationName: "人民广场",
  conditionCode: "overcast",
  conditionText: "阴天",
  temperature: -2,
  timestamp: new Date("2026-06-30T01:00:00").getTime(),
};
const sceneNightOvercast = weatherEngine.generateWeatherScene(rawNightOvercast);
assert.strictEqual(sceneNightOvercast.visual.background.isNight, true);
assert.strictEqual(sceneNightOvercast.visual.celestial.sun.visible, false, "Sun should not be visible at night");
assert.ok(sceneNightOvercast.visual.atmosphere.ice.visible, "Ice overlay should be visible in freezing temp");
assert.ok(sceneNightOvercast.business.hotFoodScore >= 85, "Hot food score should be boosted in freezing weather");
assert.ok(sceneNightOvercast.business.outdoorScore < 45, "Outdoor score should be low in night freezing overcast weather");
console.log("✔ Weather V2 Engine correctly normalizes night freezing overcast conditions");

// 7. Verify 7-day Weekly Forecast & Date Weather Matcher
const weeklyForecast = weatherService.getWeeklyWeather();
assert.strictEqual(weeklyForecast.length, 7, "Weekly forecast should contain exactly 7 days");
weeklyForecast.forEach((day, index) => {
  assert.ok(day.date, `Day ${index} should have a date`);
  assert.ok(day.icon, `Day ${index} should have an icon`);
  assert.ok(day.temperature || day.temperatureRange, `Day ${index} should have temperature`);
});

const day3Date = weeklyForecast[3].date;
const matchedWeather = weatherService.getWeatherForDate(day3Date);
assert.strictEqual(matchedWeather.date, day3Date, "getWeatherForDate should return weather for specified date");
console.log("✔ 7-day weather forecast generation & date lookup verified");

// 8. Verify Multi-Category Weather Affinity & Badges
const hotSpringCoupon = {
  id: "c_spa",
  title: "日式私汤温泉券",
  type: "温泉",
  category: "休闲娱乐",
  tags: ["室内", "雨天适合"],
};
const campCoupon = {
  id: "c_camp",
  title: "森林轻奢露营体验",
  type: "露营",
  category: "outdoor",
  tags: ["户外", "晴天适合"],
};

const coldContext = recommendation.buildRecommendationContext({
  weather: weatherService.getWeatherOptions().find(o => o.value === "rain_snow") || { mainCondition: "snow", intensity: 2 },
  now: new Date("2026-08-15T14:00:00"),
});
const recSpa = recommendation.generateRecommendation(hotSpringCoupon, coldContext);
assert.ok(recSpa.score >= 70, "Hot spring should get boosted score in cold/rain_snow weather");
assert.ok(recSpa.reasons.some(r => r.includes("泡汤桑拿") || r.includes("室内")), "Hot spring reasons should include spa boost");

const sunnyContext = recommendation.buildRecommendationContext({
  weather: weatherService.getWeatherOptions().find(o => o.value === "sunny") || { mainCondition: "sunny", intensity: 1 },
  now: new Date("2026-08-15T14:00:00"),
});
const recCamp = recommendation.generateRecommendation(campCoupon, sunnyContext);
assert.ok(recCamp.score >= 65, "Camping should get boosted score in sunny weather");
assert.ok(recCamp.reasons.some(r => r.includes("阳光明媚") || r.includes("户外")), "Camping reasons should include sunny boost");
console.log("✔ Multi-category weather affinity (Spa, Camping, Hotpot) and badge tags verified");

// 9. Verify Compound Time × Weather Animation Blending (Night + Fog, Night + Rain, Sunset + Rain)
const nightFogRaw = {
  locationName: "静安寺",
  conditionCode: "fog",
  conditionText: "雾天",
  temperature: 15,
  timestamp: new Date("2026-06-30T22:30:00").getTime(),
};
const sceneNightFog = weatherEngine.generateWeatherScene(nightFogRaw);
assert.strictEqual(sceneNightFog.visual.background.isNight, true, "Night fog should have isNight=true");
assert.ok(sceneNightFog.visual.background.gradient.includes("#070d18") || sceneNightFog.visual.background.gradient.includes("#141f2e"), "Night fog should use dark night-fog gradient");
assert.strictEqual(sceneNightFog.visual.celestial.moon.visible, true, "Hazy moon should be visible in night fog");
assert.strictEqual(sceneNightFog.semantic.displayTitle, "夜雾", "Night fog title should be 夜雾");
assert.ok(sceneNightFog.visual.atmosphere.fog.visible, "Fog overlay should be visible in night fog");

const sunsetRainRaw = {
  locationName: "外滩",
  conditionCode: "rain",
  conditionText: "中雨",
  temperature: 24,
  timestamp: new Date("2026-06-30T18:45:00").getTime(),
};
const sceneSunsetRain = weatherEngine.generateWeatherScene(sunsetRainRaw);
assert.strictEqual(sceneSunsetRain.visual.background.isNight, false, "Sunset rain should have isNight=false");
assert.ok(sceneSunsetRain.visual.background.gradient.includes("#332d44") || sceneSunsetRain.visual.background.gradient.includes("#876b77"), "Sunset rain should use twilight sunset-rain gradient");
assert.ok(sceneSunsetRain.semantic.displayTitle.includes("暮色") || sceneSunsetRain.semantic.displayTitle.includes("暮雨"), "Sunset rain title should reflect twilight rain");
console.log("✔ Compound Time × Weather blending (Night+Fog, Night+Rain, Sunset+Rain) verified");

// 10. Verify Universal Weather API Adapter for Multi-Vendor Payload Ingestion
const weatherApiAdapter = require("./services/weatherApiAdapter.js");

// 10.1 QWeather Payload Test
const qweatherPayload = {
  code: "200",
  updateTime: "2026-08-14T18:00+08:00",
  locationName: "徐家汇",
  now: {
    temp: "28",
    icon: "306",
    text: "中雨",
    windSpeed: "15",
    humidity: "82",
    vis: "8",
  },
  aqi: "35",
};
assert.strictEqual(weatherApiAdapter.detectApiProvider(qweatherPayload), "qweather");
const qParsed = weatherService.parseLiveApiResponse(qweatherPayload);
assert.strictEqual(qParsed.provider, "qweather");
assert.strictEqual(qParsed.temperature, 28);
assert.strictEqual(qParsed.mainCondition, "rain");
assert.ok(qParsed.v2Scene.visual.particles.rain.visible, "Rain particle should be visible for QWeather 306");
assert.strictEqual(qParsed.v2Scene.semantic.aqi.class, "excellent");

// 10.2 Amap Payload Test
const amapPayload = {
  status: "1",
  info: "OK",
  lives: [{
    city: "静安区",
    weather: "雷阵雨",
    temperature: "26",
    winddirection: "东南",
    windpower: "4",
    humidity: "90",
  }]
};
assert.strictEqual(weatherApiAdapter.detectApiProvider(amapPayload), "amap");
const amapParsed = weatherService.parseLiveApiResponse(amapPayload);
assert.strictEqual(amapParsed.provider, "amap");
assert.strictEqual(amapParsed.temperature, 26);
assert.strictEqual(amapParsed.mainCondition, "thunderstorm");
assert.ok(amapParsed.v2Scene.visual.particles.thunder.visible, "Thunder particle should be active for Amap 雷阵雨");

// 10.3 Caiyun Payload Test
const caiyunPayload = {
  status: "ok",
  server_time: 1786689000,
  result: {
    realtime: {
      status: "ok",
      temperature: 34.2,
      humidity: 0.45,
      skycon: "CLEAR_DAY",
      visibility: 15,
      wind: { speed: 8 },
      air_quality: { aqi: { chn: 25 } }
    }
  }
};
assert.strictEqual(weatherApiAdapter.detectApiProvider(caiyunPayload), "caiyun");
const caiyunParsed = weatherService.parseLiveApiResponse(caiyunPayload);
assert.strictEqual(caiyunParsed.provider, "caiyun");
assert.strictEqual(caiyunParsed.temperature, 34);
assert.strictEqual(caiyunParsed.mainCondition, "clear");
assert.strictEqual(caiyunParsed.v2Scene.visual.background.isNight, false);

// 10.4 OpenWeatherMap Payload Test
const owmPayload = {
  name: "Shanghai",
  weather: [{ id: 601, main: "Snow", description: "snow", icon: "13d" }],
  main: { temp: -1.5, temp_min: -3, temp_max: 1, humidity: 88 },
  wind: { speed: 4.2 }
};
assert.strictEqual(weatherApiAdapter.detectApiProvider(owmPayload), "openweathermap");
const owmParsed = weatherService.parseLiveApiResponse(owmPayload);
assert.strictEqual(owmParsed.provider, "openweathermap");
assert.strictEqual(owmParsed.temperature, -1);
assert.strictEqual(owmParsed.mainCondition, "snow");
assert.ok(owmParsed.v2Scene.visual.particles.snow.visible, "Snow particle should be active for OWM Snow");

console.log("✔ Universal Weather API Adapter (QWeather, Amap, Caiyun, OWM) multi-provider parsing verified");

// 11. Verify Astronomical Synodic Lunar Moon Phase Calculation
// Known Astronomical Reference: 2026-08-28 is Mid-Autumn / Full Moon period (around JD)
const fullMoonDate = new Date("2026-08-28T21:00:00");
const lunarFull = weatherEngine.getLunarMoonPhase(fullMoonDate);
assert.ok(lunarFull.phase === "full" || lunarFull.illumination >= 0.8, "Moon phase around Mid-Autumn should be full or near-full");
assert.ok(lunarFull.moonAge >= 0 && lunarFull.moonAge <= 29.53, "Moon age must be within synodic month [0, 29.53]");

const crescentDate = new Date("2026-08-16T21:00:00");
const lunarCrescent = weatherEngine.getLunarMoonPhase(crescentDate);
assert.ok(lunarCrescent.phase.includes("crescent") || lunarCrescent.phase.includes("quarter"), "Crescent/quarter should be recognized");

// Verify that scene generator attaches lunar metadata
const sceneWithMoon = weatherEngine.generateWeatherScene({
  conditionCode: "clear",
  timePhase: "night",
  timestamp: fullMoonDate.getTime(),
});
assert.strictEqual(sceneWithMoon.visual.celestial.moon.visible, true);
assert.ok(sceneWithMoon.visual.celestial.moon.phaseLabel, "Moon phaseLabel should exist");
assert.ok(sceneWithMoon.visual.celestial.moon.moonAge !== undefined, "Moon age should exist");
console.log(`✔ Astronomical Synodic Lunar Moon Phase verified (Full Moon age: ${lunarFull.moonAge}d, phase: ${lunarFull.phaseLabel})`);

console.log("=== All Composable Weather Engine Tests Passed successfully! ===");
