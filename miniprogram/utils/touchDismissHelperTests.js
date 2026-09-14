const assert = require("assert");
const TouchDismissHelper = require("./touchDismissHelper.js");

const helper = new TouchDismissHelper({ thresholdY: 70, velocityThreshold: 99 });
let dismissed = false;

helper.onTouchStart({ touches: [{ clientX: 10, clientY: 0 }] });
const move = helper.onTouchMove({ touches: [{ clientX: 10, clientY: 100 }] });
assert.strictEqual(move.isDragging, true);
assert.ok(move.dragOffsetY > 0);
const end = helper.onTouchEnd({}, () => { dismissed = true; });
assert.strictEqual(end.dismissed, true);
assert.strictEqual(dismissed, true);

dismissed = false;
helper.onTouchStart({ touches: [{ clientX: 10, clientY: 100 }] });
const tapEnd = helper.onTouchEnd({}, () => { dismissed = true; });
assert.strictEqual(tapEnd.dismissed, false);
assert.strictEqual(dismissed, false);

console.log("touch dismiss helper tests ok");
