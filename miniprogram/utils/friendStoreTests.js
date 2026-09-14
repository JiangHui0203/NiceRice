const assert = require("assert");

const storage = new Map();
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  showToast() {},
};

const friendStore = require("./friendStore.js");

const rejected = friendStore.saveFriends([
  null,
  { name: "" },
  { name: "  小王  ", slots: "错误格式", restrictions: ["不吃辣", null] },
]);
assert.strictEqual(rejected, false);
assert.deepStrictEqual(friendStore.readFriends(), [], "invalid batches must be rejected without partial writes");

const saved = friendStore.saveFriends([
  { name: "  小王  ", slots: "错误格式", restrictions: ["不吃辣", null] },
]);
assert.strictEqual(saved, true);
const friends = friendStore.readFriends();
assert.strictEqual(friends.length, 1);
assert.strictEqual(friends[0].name, "小王");
assert.strictEqual(friends[0].id, "");
assert.deepStrictEqual(friends[0].slots, []);
assert.deepStrictEqual(friends[0].restrictions, ["不吃辣"]);

console.log("friend store tests ok");
