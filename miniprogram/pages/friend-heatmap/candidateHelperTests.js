const assert = require("assert");
const {
  appendCustomCandidate,
  buildCandidateDrawerState,
  buildCandidateShareData,
  buildCandidateVoteText,
  countSelectedCandidates,
  getCandidateVoteItems,
  removeCustomCandidate,
  toggleCandidateSelection,
} = require("./candidateHelper.js");

const drawer = buildCandidateDrawerState([
  { id: "active", title: "火锅", statusCode: "pending" },
  { id: "used", title: "已使用", statusCode: "used" },
], [{ id: "custom", title: "桌游", selected: false }]);
assert.deepStrictEqual(drawer.heatmapCandidates.map((item) => item.id), ["active"]);
assert.strictEqual(drawer.heatmapCandidates[0].badge, "A");
assert.strictEqual(drawer.customCandidates[0].badge, "B");
assert.strictEqual(drawer.selectedCandidateCount, 1);

const appended = appendCustomCandidate([], "  咖啡  ", { now: () => 123, random: () => 0.5 });
assert.strictEqual(appended.success, true);
assert.strictEqual(appended.candidate.title, "咖啡");
assert.strictEqual(appendCustomCandidate(appended.candidates, "咖啡").success, false);
assert.deepStrictEqual(removeCustomCandidate(appended.candidates, appended.candidate.id), []);

const toggled = toggleCandidateSelection([{ id: "a", selected: true }], "a");
assert.strictEqual(toggled[0].selected, false);
assert.strictEqual(countSelectedCandidates(toggled, [{ id: "b", selected: true }]), 1);

const voteItems = getCandidateVoteItems([{ id: "a", title: "A", selected: false }], [{ id: "b", title: "B", selected: false }]);
assert.strictEqual(voteItems.length, 2);
assert.ok(buildCandidateVoteText(voteItems).includes("选项 A：A"));
assert.ok(buildCandidateShareData([{ title: "火锅", selected: true }], []).title.includes("火锅"));

console.log("friend heatmap candidate helper tests ok");
