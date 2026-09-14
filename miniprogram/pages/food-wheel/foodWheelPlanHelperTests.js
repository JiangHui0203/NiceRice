const assert = require("assert");
const { buildSelectedTime } = require("./foodWheelPlanHelper.js");

const yearEnd = new Date(2026, 11, 31, 10, 15, 0);
const originalTime = yearEnd.getTime();

assert.deepStrictEqual(buildSelectedTime("today_lunch", yearEnd), {
  date: "2026-12-31",
  weekday: "周四",
  startTime: "12:00",
  endTime: "13:30",
  scene: "午餐",
  label: "今天午餐",
});

assert.deepStrictEqual(buildSelectedTime("tomorrow_dinner", yearEnd), {
  date: "2027-01-01",
  weekday: "周五",
  startTime: "18:30",
  endTime: "20:30",
  scene: "晚餐",
  label: "明天晚餐",
});

assert.strictEqual(yearEnd.getTime(), originalTime, "building a slot must not mutate the caller's Date");
assert.strictEqual(buildSelectedTime("unknown", yearEnd).label, "今天午餐");

console.log("food wheel plan helper tests ok");
