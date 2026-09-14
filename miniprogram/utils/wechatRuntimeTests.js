const assert = require("assert");
const { getWx } = require("./wechatRuntime.js");

assert.strictEqual(getWx(), null);
global.wx = { test: true };
assert.strictEqual(getWx(), global.wx);
delete global.wx;

console.log("wechat runtime tests ok");
