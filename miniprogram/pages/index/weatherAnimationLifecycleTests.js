const assert = require("assert");

const previousWx = global.wx;
const hadWx = Object.prototype.hasOwnProperty.call(global, "wx");
const queryCallbacks = [];
let queryCount = 0;

global.wx = {
  createSelectorQuery() {
    queryCount += 1;
    return {
      in() { return this; },
      select() { return this; },
      fields() { return this; },
      exec(callback) {
        queryCallbacks.push(callback);
      },
    };
  },
  getWindowInfo() {
    return { pixelRatio: 2 };
  },
};

const {
  initWeatherCanvas,
  cleanupWeatherCanvas,
} = require("./weatherAnimation.js");

const requestedFrames = [];
const cancelledFrames = [];
let nextFrameId = 1;
const canvas = {
  getContext() {
    return {
      scale() {},
      clearRect() {},
    };
  },
  requestAnimationFrame(callback) {
    const id = nextFrameId;
    nextFrameId += 1;
    requestedFrames.push({ id, callback });
    return id;
  },
  cancelAnimationFrame(id) {
    cancelledFrames.push(id);
  },
};
const page = {
  data: {
    isPageVisible: true,
    weather: {
      v2Scene: {
        visual: {
          particles: {
            rain: { visible: false, density: 0 },
            snow: { visible: false, density: 0 },
            wind: { visible: false, level: 0 },
          },
        },
      },
    },
  },
};

initWeatherCanvas(page);
initWeatherCanvas(page);
assert.strictEqual(queryCount, 1, "pending initialization must not create duplicate SelectorQuery requests");

page.data.isPageVisible = false;
cleanupWeatherCanvas(page);
queryCallbacks.shift()([{ node: canvas, width: 375, height: 220 }]);
assert.strictEqual(page.animActive, false, "a late query callback must not restart a hidden page");
assert.strictEqual(requestedFrames.length, 0);

page.data.isPageVisible = true;
initWeatherCanvas(page);
assert.strictEqual(queryCount, 2);
queryCallbacks.shift()([{ node: canvas, width: 375, height: 220 }]);
assert.strictEqual(page.animActive, true);
assert.strictEqual(page.canvasInitPending, false);
assert.strictEqual(requestedFrames.length, 1, "successful initialization should start exactly one render loop");

requestedFrames[0].callback();
assert.strictEqual(requestedFrames.length, 2, "an active RAF callback should render and schedule exactly one next frame");
assert.strictEqual(page.animFrameId, 2);

initWeatherCanvas(page);
assert.strictEqual(requestedFrames.length, 2, "reinitializing an active canvas must not stack RAF loops");

cleanupWeatherCanvas(page);
assert.deepStrictEqual(cancelledFrames, [2]);
assert.strictEqual(page.animActive, false);
assert.strictEqual(page.canvasContext, null, "cleanup should release the canvas context");
assert.strictEqual(page.canvasNode, null, "cleanup should release the canvas node");
assert.strictEqual(page.particles, null, "cleanup should release the particle array");
assert.strictEqual(canvas.width, 1, "cleanup should release the canvas backing bitmap");
assert.strictEqual(canvas.height, 1, "cleanup should release the canvas backing bitmap");

// Reinitialize before the already-dispatched old callback arrives. animActive
// is true again here, so an animActive-only guard would accidentally stack a
// second RAF chain.
initWeatherCanvas(page);
assert.strictEqual(queryCount, 3);
queryCallbacks.shift()([{ node: canvas, width: 375, height: 220 }]);
assert.strictEqual(requestedFrames.length, 3);
assert.strictEqual(page.animFrameId, 3);

requestedFrames[1].callback();
assert.strictEqual(requestedFrames.length, 3, "an old-generation callback must not join a newly active loop");
assert.strictEqual(page.animFrameId, 3, "an old-generation callback must not replace the current frame id");

requestedFrames[2].callback();
assert.strictEqual(requestedFrames.length, 4, "the current generation should continue rendering normally");
assert.strictEqual(page.animFrameId, 4);

cleanupWeatherCanvas(page);
assert.deepStrictEqual(cancelledFrames, [2, 4]);
assert.strictEqual(canvas.width, 1);
assert.strictEqual(canvas.height, 1);

if (hadWx) global.wx = previousWx;
else delete global.wx;

console.log("weather animation lifecycle tests ok");
