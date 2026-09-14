const assert = require("assert");
const { dateAfter, formatDate, pad } = require("./dateUtils.js");

assert.strictEqual(pad(3), "03");
assert.strictEqual(formatDate(new Date("2026-08-09T12:00:00")), "2026-08-09");
assert.strictEqual(dateAfter(2, new Date("2026-08-29T12:00:00")), "2026-08-31");

console.log("date utils tests ok");
