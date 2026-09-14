const assert = require("assert");

delete global.wx;
const spinStore = require("./spinStore.js");

spinStore.clearCustomCandidates();
const first = spinStore.addCustomCandidate("拉面");
const second = spinStore.addCustomCandidate("烧烤");
assert.notStrictEqual(first.id, second.id);
assert.strictEqual(spinStore.getCandidates().filter((item) => item.source === "custom").length, 2);

spinStore.clearCustomCandidates();
assert.strictEqual(spinStore.getCandidates().filter((item) => item.source === "custom").length, 0);

console.log("spin store tests ok");
