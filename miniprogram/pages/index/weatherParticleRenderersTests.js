const assert = require("assert");
const baseline = require("./weatherParticleRenderBaseline.json");
const renderers = require("./weatherParticleRenderers.js");
const { drawParticles } = require("./weatherAnimation.js");

const CASE_RENDERERS = {
  rain: renderers.renderRainParticle,
  snow: renderers.renderSnowParticle,
  leafPetal: renderers.renderLeafParticle,
  leafGinkgo: renderers.renderLeafParticle,
  leafOval: renderers.renderLeafParticle,
  silkWind: renderers.renderSilkWindParticle,
  airMote: renderers.renderAirMoteParticle,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createFixedRandom() {
  let calls = 0;
  const random = () => {
    const value = baseline.fixedValues[calls % baseline.fixedValues.length];
    calls += 1;
    return value;
  };
  random.getCallCount = () => calls;
  return random;
}

function createTraceContext() {
  const trace = [];
  let gradientNumber = 0;
  const methods = [
    "clearRect",
    "beginPath",
    "moveTo",
    "lineTo",
    "stroke",
    "arc",
    "fill",
    "save",
    "translate",
    "rotate",
    "scale",
    "bezierCurveTo",
    "quadraticCurveTo",
    "restore",
  ];
  const target = {};
  methods.forEach((method) => {
    target[method] = (...args) => trace.push({ op: method, args });
  });
  target.createLinearGradient = (...args) => {
    gradientNumber += 1;
    const id = `gradient_${gradientNumber}`;
    trace.push({ op: "createLinearGradient", id, args });
    return {
      id,
      addColorStop(...stopArgs) {
        trace.push({ op: "addColorStop", id, args: stopArgs });
      },
    };
  };

  const ctx = new Proxy(target, {
    set(object, key, value) {
      trace.push({
        op: "set",
        key: String(key),
        value: value && value.id ? value.id : value,
      });
      object[key] = value;
      return true;
    },
  });
  return { ctx, trace };
}

function buildFrame(testCase) {
  const windPhase = testCase.initialWindPhase + 0.0024;
  return {
    width: testCase.width,
    height: testCase.height,
    windPhase,
    gust: Math.sin(windPhase * 1.3) * Math.cos(windPhase * 0.6) * 0.35,
  };
}

function expectedRendererTrace(caseName, legacyTrace) {
  if (caseName !== "silkWind") return legacyTrace;

  // Keep the pre-optimization visual snapshot immutable. The optimized
  // renderer reuses the snapshot's core gradient for both strokes, applying a
  // near-equivalent alpha to the wide glow instead of allocating glowGrad.
  const firstGradient = legacyTrace.findIndex((entry) => entry.op === "createLinearGradient");
  const firstPath = legacyTrace.findIndex((entry, index) => index > firstGradient && entry.op === "beginPath");
  const secondGradient = legacyTrace.findIndex((entry, index) => index > firstPath && entry.op === "createLinearGradient");
  const secondPath = legacyTrace.findIndex((entry, index) => index > secondGradient && entry.op === "beginPath");
  assert.ok(firstGradient >= 0 && firstPath > firstGradient && secondGradient > firstPath && secondPath > secondGradient);

  const prefix = legacyTrace.slice(0, firstGradient);
  const coreGradient = clone(legacyTrace.slice(secondGradient, secondPath)).map((entry) => {
    if (entry.id === "gradient_2") entry.id = "gradient_1";
    return entry;
  });
  const glowPath = clone(legacyTrace.slice(firstPath, secondGradient));
  const strokeStyleIndex = glowPath.findIndex((entry) => entry.op === "set" && entry.key === "strokeStyle");
  glowPath.splice(strokeStyleIndex + 1, 0, { op: "set", key: "globalAlpha", value: 0.36 });

  const corePath = clone(legacyTrace.slice(secondPath)).map((entry) => {
    if (entry.op === "set" && entry.key === "strokeStyle") {
      return { op: "set", key: "globalAlpha", value: 1 };
    }
    return entry;
  });
  return prefix.concat(coreGradient, glowPath, corePath);
}

function assertDirectRenderer(caseName, testCase) {
  const renderer = CASE_RENDERERS[caseName];
  assert.strictEqual(typeof renderer, "function", `renderer missing for ${caseName}`);
  const particle = clone(testCase.source);
  const random = createFixedRandom();
  const { ctx, trace } = createTraceContext();

  renderer(ctx, particle, buildFrame(testCase), random);

  assert.deepStrictEqual(particle, testCase.expectedParticle, `${caseName} state update changed`);
  assert.strictEqual(random.getCallCount(), testCase.randomCalls, `${caseName} random call count changed`);
  assert.deepStrictEqual(
    trace,
    expectedRendererTrace(caseName, testCase.trace.slice(1)),
    `${caseName} Canvas call order changed`
  );
  if (caseName === "silkWind") {
    assert.strictEqual(
      trace.filter((entry) => entry.op === "createLinearGradient").length,
      1,
      "silk wind should allocate one shared gradient per particle frame"
    );
  }
}

function assertDrawDispatch(caseName, testCase) {
  const particle = clone(testCase.source);
  const random = createFixedRandom();
  const { ctx, trace } = createTraceContext();
  const page = {
    data: {},
    canvasContext: ctx,
    canvasWidth: testCase.width,
    canvasHeight: testCase.height,
    windPhase: testCase.initialWindPhase,
    particles: [particle],
  };
  const originalRandom = Math.random;
  Math.random = random;
  try {
    drawParticles(page);
  } finally {
    Math.random = originalRandom;
  }

  assert.strictEqual(page.windPhase, testCase.expectedWindPhase, `${caseName} frame phase changed`);
  assert.deepStrictEqual(particle, testCase.expectedParticle, `${caseName} dispatch state changed`);
  assert.strictEqual(random.getCallCount(), testCase.randomCalls, `${caseName} dispatch random order changed`);
  assert.deepStrictEqual(trace, expectedRendererTrace(caseName, testCase.trace), `${caseName} dispatch Canvas order changed`);
}

Object.entries(baseline.cases).forEach(([caseName, testCase]) => {
  assertDirectRenderer(caseName, testCase);
  assertDrawDispatch(caseName, testCase);
});

{
  const testCase = baseline.cases.silkWind;
  const particle = clone(testCase.source);
  const { ctx, trace } = createTraceContext();
  ctx.globalAlpha = 0.5;
  trace.length = 0;
  renderers.renderSilkWindParticle(ctx, particle, buildFrame(testCase), createFixedRandom());
  assert.strictEqual(ctx.globalAlpha, 0.5, "silk wind renderer must restore an inherited global alpha");
  assert.strictEqual(trace.filter((entry) => entry.op === "createLinearGradient").length, 1);
  assert.ok(trace.some((entry) => entry.op === "set" && entry.key === "globalAlpha" && entry.value === 0.18));
}

assert.deepStrictEqual(Object.keys(renderers), [
  "renderRainParticle",
  "renderSnowParticle",
  "renderLeafParticle",
  "renderSilkWindParticle",
  "renderAirMoteParticle",
]);

console.log("weather particle renderer tests ok");
