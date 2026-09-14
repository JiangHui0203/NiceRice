const assert = require("assert");
const editHelper = require("./coupon-edit/couponEditHelper.js");
const detailHelper = require("./coupon-detail/couponDetailHelper.js");
const dishParser = require("../utils/coupon/dishParser.js");

assert.strictEqual(editHelper.parseDishesList, dishParser.parseDishesList);
assert.strictEqual(detailHelper.parseDishesList, dishParser.parseDishesList);

for (const parseDishesList of [dishParser.parseDishesList, editHelper.parseDishesList, detailHelper.parseDishesList]) {
  const items = parseDishesList("招牌牛肉 2份 / 半只烤鸭1/2份 / 冰美式x2");
  assert.strictEqual(items.length, 3);
  assert.deepStrictEqual(
    items.map((item) => item.count),
    ["2份", "1/2份", "x2"],
  );
}

assert.deepStrictEqual(dishParser.parseDishesList(null), []);
assert.deepStrictEqual(dishParser.parseDishesList("  "), []);
assert.deepStrictEqual(
  dishParser.parseDishesList("拿铁（大杯）、厚切吐司"),
  [
    { id: "dish_0", name: "拿铁", count: "大杯" },
    { id: "dish_1", name: "厚切吐司", count: "" },
  ],
);

console.log("coupon dish parser tests ok");
