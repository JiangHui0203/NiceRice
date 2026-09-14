/**
 * ocrParserTests.js
 * OCR 文本解析引擎独立单元回归测试
 */

const assert = require("assert");
const ocrParser = require("./services/ocr/ocrTextParser.js");

console.log("=== Start OCR Text Parser Assertions ===");

// 1. Meituan format
const mtText = `
美团
青禾铜锅·老北京涮羊肉（望京店）
营业中 | 距你 1.2km | 望京SOHO地下1层
特惠双人涮肉套餐
套餐内容：手切鲜羊肉1盘、精品肥牛1盘、鲜墨鱼滑1盘
价格：168元
有效期：2026-09-30
使用规则：周末及节假日不可用；需提前24小时预约；仅限堂食；不可退款。
`;

const res1 = ocrParser.parseCouponText(mtText);
assert.strictEqual(res1.success, true);
assert.strictEqual(res1.type, "火锅");
assert.strictEqual(res1.platform, "美团");
assert.strictEqual(res1.venue, "青禾铜锅·老北京涮羊肉（望京店）");
assert.strictEqual(res1.expireDate, "2026-09-30");
assert.strictEqual(res1.price, "168");
assert.strictEqual(res1.reservationRequired, true);
assert.strictEqual(res1.reservationLeadTimeHours, "24");
assert.strictEqual(res1.refundType, "non_refundable");
assert.strictEqual(res1.people, "2人");
console.log("✔ Meituan hotpot coupon text parsed successfully");

// 2. Dianping single meal format
const dpText = `
大众点评
巷口牛肉面（阜通店）
单人精品牛肉面套餐
1碗红烧牛肉面、1份小菜、1瓶酸梅汤
实付 ¥29.9
有效期：20260830
营业时间：11:00-20:30
无需预约，自动退款
`;

const res2 = ocrParser.parseCouponText(dpText);
assert.strictEqual(res2.success, true);
assert.strictEqual(res2.type, "粉面");
assert.strictEqual(res2.platform, "大众点评");
assert.strictEqual(res2.expireDate, "2026-08-30");
assert.strictEqual(res2.usableTime, "11:00-20:30");
assert.strictEqual(res2.price, "29.9");
assert.strictEqual(res2.reservationRequired, false);
assert.strictEqual(res2.refundType, "auto");
assert.strictEqual(res2.people, "1人");
console.log("✔ Dianping noodle coupon text parsed successfully");

// 3. Short month-day format
const shortDateText = `
星巴克
双人下午茶咖啡甜品
2杯生椰拿铁、1份提拉米苏
售价：68元
截止日期：10月15日
`;

const res3 = ocrParser.parseCouponText(shortDateText);
assert.strictEqual(res3.success, true);
assert.strictEqual(res3.type, "咖啡甜品");
assert.strictEqual(res3.expireDate.endsWith("-10-15"), true);
assert.strictEqual(res3.price, "68");
assert.strictEqual(res3.people, "2人");
console.log("✔ Short date coffee coupon parsed successfully");

console.log("=== All OCR Text Parser Tests Passed! ===");
