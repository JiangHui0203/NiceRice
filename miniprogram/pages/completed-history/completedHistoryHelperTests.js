const assert = require("assert");
const {
  aggregateCompletedRecords,
  calculateCompletedStats,
} = require("./completedHistoryHelper.js");

const records = aggregateCompletedRecords([{
  entityId: "log1",
  entityType: "plan",
  title: "测试记录",
  timestamp: "2026-08-30 12:00",
  finance: { actualPaid: "12.5", originalPrice: "20", savedAmount: "7.5" },
  executionSnapshot: { participants: "我、小李" },
  feedback: { rating: -3 },
}], [], []);

assert.strictEqual(records[0].participants, "我、小李");
assert.strictEqual(records[0].feedbackRatingStars, "☆☆☆☆☆");
const stats = calculateCompletedStats(records);
assert.strictEqual(stats.totalCost, "12.5");
assert.strictEqual(stats.topFriend, "小李");

console.log("completed history helper tests ok");
