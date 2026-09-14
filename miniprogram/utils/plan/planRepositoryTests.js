const assert = require("assert");

const storage = new Map();
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
};

const repository = require("./planRepository.js");

repository.saveStoredPlans([{
  id: "plan_context_cache_test",
  title: "户外公园",
  category: "outdoor",
  statusCode: "pending",
  selectedTime: {
    date: "2099-01-01",
    weekday: "周四",
    startTime: "12:00",
    endTime: "14:00",
  },
  participants: [{ id: "self", name: "我", status: "confirmed" }],
}]);

const rainyPlans = repository.fetchAllPlans({
  now: new Date("2098-12-01T00:00:00"),
  weather: { title: "暴雨", condition: "rainstorm" },
}, true);
const sunnyPlans = repository.fetchAllPlans({
  now: new Date("2098-12-01T00:00:00"),
  weather: { title: "晴天", condition: "sunny" },
});
const rainyPlan = rainyPlans.find((plan) => plan.id === "plan_context_cache_test");
const sunnyPlan = sunnyPlans.find((plan) => plan.id === "plan_context_cache_test");

assert.notStrictEqual(rainyPlans, sunnyPlans);
assert.strictEqual(rainyPlan.liveRisk.messages.some((item) => item.type === "weather_changed"), true);
assert.strictEqual(sunnyPlan.liveRisk.messages.some((item) => item.type === "weather_changed"), false);
assert.strictEqual(sunnyPlan.statusCode, "pending");

rainyPlan.title = "被调用方篡改";
rainyPlan.liveRisk.messages.push({ type: "injected" });
const isolatedPlans = repository.fetchAllPlans({
  now: new Date("2098-12-01T00:00:00"),
  weather: { title: "晴天", condition: "sunny" },
});
const isolatedPlan = isolatedPlans.find((plan) => plan.id === "plan_context_cache_test");
assert.strictEqual(isolatedPlan.title, "户外公园");
assert.strictEqual(isolatedPlan.liveRisk.messages.some((item) => item.type === "injected"), false);

const pastPlans = repository.fetchAllPlans({
  now: new Date("2100-01-01T00:00:00"),
  weather: { title: "晴天", condition: "sunny" },
});
const pastPlan = pastPlans.find((plan) => plan.id === "plan_context_cache_test");
assert.strictEqual(pastPlan.liveRisk.messages.some((item) => item.type === "time_passed"), true);
assert.strictEqual(pastPlan.statusCode, "expired");

console.log("plan repository tests ok");
