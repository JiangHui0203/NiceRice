const assert = require("assert");
const {
  buildCouponsSharePayload,
  buildShareCandidateItems,
  buildShareCandidateText,
  decodeSharedText,
  parseSharedJson,
  stripCouponForShare,
} = require("./couponShareHelper.js");

const coupons = [
  { id: "a", title: "火锅", venue: "一号店", people: "2人", price: "99", secret: "drop" },
  { id: "b", title: "烤肉", merchantName: "二号店", people: "3人人", price: "88" },
];
const items = buildShareCandidateItems(coupons, { a: true, b: true });
assert.deepStrictEqual(items.map((item) => item.badge), ["A", "B"]);
assert.ok(buildShareCandidateText(items).includes("A / B"));
assert.ok(buildShareCandidateText(items).includes("适合 3人"));
assert.strictEqual(stripCouponForShare(coupons[0]).secret, undefined);
assert.deepStrictEqual(
  [stripCouponForShare({ latitude: 0, longitude: 0 }).latitude, stripCouponForShare({ latitude: 0, longitude: 0 }).longitude],
  [0, 0],
);

const payload = buildCouponsSharePayload(items);
assert.ok(payload.title.includes("火锅 vs 烤肉"));
const query = payload.path.split("sharedCoupons=")[1].split("&")[0];
assert.strictEqual(JSON.parse(decodeURIComponent(query)).length, 2);
assert.strictEqual(buildCouponsSharePayload([]).path, "/pages/coupons/index");

const percentPayload = [{ id: "percent", title: "双人餐 50% 优惠 🐰" }];
const percentJson = JSON.stringify(percentPayload);
assert.deepStrictEqual(parseSharedJson(percentJson), percentPayload);
assert.deepStrictEqual(parseSharedJson(encodeURIComponent(percentJson)), percentPayload);
assert.deepStrictEqual(parseSharedJson(encodeURIComponent(encodeURIComponent(percentJson))), percentPayload);
assert.strictEqual(parseSharedJson("%not-json"), null);
assert.strictEqual(decodeSharedText("双人餐 50% 优惠"), "双人餐 50% 优惠");

console.log("coupon share helper tests ok");
