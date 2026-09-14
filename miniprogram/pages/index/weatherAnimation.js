/**
 * Weather 2D Canvas & Particle Physics Animation Engine
 * 处理首页顶栏动态天气粒子系统（雨滴、雪花、风向流光丝带、落叶花瓣、悬浮微尘与云层）
 */

const {
  generateRandomClouds,
  createWeatherParticles,
} = require("./weatherParticleFactory.js");

const {
  renderRainParticle,
  renderSnowParticle,
  renderLeafParticle,
  renderSilkWindParticle,
  renderAirMoteParticle,
} = require("./weatherParticleRenderers.js");

const PARTICLE_RENDERERS = {
  rain: renderRainParticle,
  snow: renderSnowParticle,
  leaf: renderLeafParticle,
  silkWind: renderSilkWindParticle,
  airMote: renderAirMoteParticle,
};
const MAX_CANVAS_BACKING_PIXELS = 4 * 1024 * 1024;

function boundedFinite(value, fallback, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function isPageVisible(page) {
  return !page.data || page.data.isPageVisible !== false;
}

function advanceRenderGeneration(page) {
  const current = Number.isSafeInteger(page.weatherRenderGeneration)
    ? page.weatherRenderGeneration
    : 0;
  page.weatherRenderGeneration = current >= Number.MAX_SAFE_INTEGER ? 1 : current + 1;
  return page.weatherRenderGeneration;
}

function startWeatherRenderLoop(page) {
  const requestFrame = page.reqAnimFn || ((callback) => setTimeout(callback, 20));
  const generation = advanceRenderGeneration(page);
  const render = () => {
    // cancelAnimationFrame cannot guarantee that an already-dispatched callback
    // will not run. The generation check also invalidates callbacks from an old
    // canvas after a hide -> show or repeated initialization cycle.
    if (generation !== page.weatherRenderGeneration || !page.animActive || !isPageVisible(page)) return;
    drawParticles(page);
    if (generation !== page.weatherRenderGeneration || !page.animActive || !isPageVisible(page)) return;
    page.animFrameId = requestFrame(render);
  };
  page.animFrameId = requestFrame(render);
}

function initWeatherCanvas(page) {
  if (!isPageVisible(page)) return;
  if (page.animActive) {
    initParticles(page);
    return;
  }
  if (page.canvasInitialized && page.canvasNode) {
    initParticles(page);
    page.animActive = true;
    startWeatherRenderLoop(page);
    return;
  }
  if (page.canvasInitPending) return;

  const initToken = (page.canvasInitToken || 0) + 1;
  page.canvasInitToken = initToken;
  page.canvasInitPending = true;

  const query = wx.createSelectorQuery().in(page);
  query.select('#weatherCanvas')
    .fields({ node: true, size: true })
    .exec((res) => {
      if (initToken !== page.canvasInitToken) return;
      if (!isPageVisible(page)) {
        page.canvasInitPending = false;
        return;
      }
      page.canvasInitPending = false;
      if (!res || !res[0] || !res[0].node) {
        page.canvasInitialized = false;
        return;
      }

      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        page.canvasInitialized = false;
        return;
      }

      let windowInfo = {};
      try {
        windowInfo = typeof wx.getWindowInfo === 'function' ? (wx.getWindowInfo() || {}) : {};
      } catch (error) {}
      const requestedDpr = boundedFinite(windowInfo.pixelRatio, 2, 1, 4);
      const canvasWidth = boundedFinite(res[0].width, 375, 1, 2048);
      const canvasHeight = boundedFinite(res[0].height, 220, 1, 1024);
      const maxSafeDpr = Math.sqrt(MAX_CANVAS_BACKING_PIXELS / (canvasWidth * canvasHeight));
      const dpr = Math.max(1, Math.min(requestedDpr, maxSafeDpr));

      canvas.width = Math.max(1, Math.round(canvasWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvasHeight * dpr));
      ctx.scale(dpr, dpr);

      page.canvasContext = ctx;
      page.canvasWidth = canvasWidth;
      page.canvasHeight = canvasHeight;
      page.canvasNode = canvas;
      page.canvasInitialized = true;

      initParticles(page);
      page.animActive = true;
      page.reqAnimFn = canvas.requestAnimationFrame
        ? canvas.requestAnimationFrame.bind(canvas)
        : ((callback) => setTimeout(callback, 20));
      page.cancelAnimFn = canvas.cancelAnimationFrame
        ? canvas.cancelAnimationFrame.bind(canvas)
        : clearTimeout;
      startWeatherRenderLoop(page);
    });
}

function initParticles(page) {
  page.particles = createWeatherParticles({
    weather: page.data.weather || {},
    width: page.canvasWidth || 375,
    height: page.canvasHeight || 200,
  });
}

function drawParticles(page) {
  const ctx = page.canvasContext;
  const width = page.canvasWidth;
  const height = page.canvasHeight;
  if (!ctx || !page.particles) return;

  page.windPhase = (page.windPhase || 0) + 0.0024;
  const gust = Math.sin(page.windPhase * 1.3) * Math.cos(page.windPhase * 0.6) * 0.35;
  const frame = {
    width,
    height,
    windPhase: page.windPhase,
    gust,
  };

  ctx.clearRect(0, 0, width, height);

  const particles = page.particles;
  const len = particles.length;
  for (let i = 0; i < len; i++) {
    const particle = particles[i];
    const renderer = PARTICLE_RENDERERS[particle.type];
    if (renderer) renderer(ctx, particle, frame);
  }
}

function cleanupWeatherCanvas(page) {
  const canvasNode = page.canvasNode;
  page.animActive = false;
  page.canvasInitialized = false;
  page.canvasInitPending = false;
  page.canvasInitToken = (page.canvasInitToken || 0) + 1;
  advanceRenderGeneration(page);
  if (page.animFrameId !== null && page.animFrameId !== undefined && typeof page.cancelAnimFn === "function") {
    try {
      page.cancelAnimFn(page.animFrameId);
    } catch (e) {}
  }
  page.animFrameId = null;
  // Resizing releases the backing bitmap retained by the Canvas node. Merely
  // dropping the JS reference is not enough while the page DOM still exists.
  if (canvasNode) {
    try {
      canvasNode.width = 1;
      canvasNode.height = 1;
    } catch (e) {}
  }
  page.particles = null;
  page.canvasContext = null;
  page.canvasNode = null;
  page.reqAnimFn = null;
  page.cancelAnimFn = null;
}

module.exports = {
  generateRandomClouds,
  initWeatherCanvas,
  initParticles,
  drawParticles,
  cleanupWeatherCanvas,
};
