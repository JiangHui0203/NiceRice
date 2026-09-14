const assert = require("assert");
const Module = require("module");

const originalLoad = Module._load;
Module._load = function mockCloud(request, parent, isMain) {
  if (request !== "wx-server-sdk") return originalLoad.call(this, request, parent, isMain);
  return {
    DYNAMIC_CURRENT_ENV: "test",
    init() {},
    database() {
      return {};
    },
    getWXContext() {
      return { OPENID: "test-openid" };
    },
  };
};

const service = require("./index.js");
Module._load = originalLoad;

const guards = service.__test__;
assert.ok(guards, "cloud guard helpers should be exported for tests");

assert.strictEqual(guards.normalizeInviteStatus("confirmed"), "confirmed");
assert.strictEqual(guards.normalizeInviteStatus("", "pending"), "pending");
assert.throws(
  () => guards.normalizeInviteStatus("finished"),
  (error) => error && error.code === "invalid_status",
);

assert.strictEqual(guards.comparePlanUpdatedAt("2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z"), 1);
assert.strictEqual(guards.comparePlanUpdatedAt("2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z"), -1);
assert.strictEqual(guards.comparePlanUpdatedAt("same", "same"), 0);
assert.strictEqual(guards.getUpdatedCount({ stats: { updated: 1 } }), 1);
assert.strictEqual(guards.getUpdatedCount({ updated: 2 }), 2);

assert.strictEqual(guards.isAllowedOcrFileId("cloud://env-id/ocr/coupon_123.jpg"), true);
assert.strictEqual(guards.isAllowedOcrFileId("cloud://env-id/ocr/coupon_123.webp"), true);
assert.strictEqual(guards.isAllowedOcrFileId("cloud://env-id/avatars/user.jpg"), false);
assert.strictEqual(guards.isAllowedOcrFileId("cloud://env-id/ocr/../avatar.jpg"), false);
assert.strictEqual(guards.isAllowedOcrFileId("cloud://env-id/ocr/coupon_123.txt"), false);
assert.strictEqual(guards.isAllowedOcrFileId("https://example.com/coupon.jpg"), false);

const now = Date.now();
const expiry = guards.getInviteExpiry(now);
assert.strictEqual(expiry.getTime(), now + guards.INVITE_TTL_MS);
assert.strictEqual(guards.isInviteExpired({ expiresAt: new Date(now - 1) }, now), true);
assert.strictEqual(guards.isInviteExpired({ expiresAt: new Date(now + 1) }, now), false);
assert.strictEqual(
  guards.isInviteExpired({ createdAt: new Date(now - guards.INVITE_TTL_MS - 1) }, now),
  true,
);
const refreshPatch = guards.buildInviteRefreshPatch({
  couponId: "coupon-1",
  title: "new plan",
  selectedTime: { date: "2026-09-01" },
  planSnapshot: { id: "plan-1" },
  friendName: "朋友",
  status: "pending",
  planUpdatedAt: "2026-09-01T00:00:00.000Z",
  updatedAt: new Date(now),
  expiresAt: new Date(now + 1000),
});
assert.strictEqual(refreshPatch.planUpdatedAt, "2026-09-01T00:00:00.000Z");
assert.strictEqual(refreshPatch.responderOpenid, "");

guards.rateLimitBuckets.clear();
guards.enforceRateLimit("ocr", "openid-a", 2, 60000, now);
guards.enforceRateLimit("ocr", "openid-a", 2, 60000, now + 1);
assert.throws(
  () => guards.enforceRateLimit("ocr", "openid-a", 2, 60000, now + 2),
  (error) => error && error.code === "rate_limited",
);
guards.enforceRateLimit("ocr", "openid-b", 2, 60000, now + 2);

console.log("lifeServices guard tests ok");
