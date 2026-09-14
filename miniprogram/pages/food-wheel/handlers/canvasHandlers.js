const spinStore = require("../../../utils/spinStore.js");
const planStore = require("../../../utils/planStore.js");
const eventLogger = require("../../../utils/eventLogger.js");
const couponStore = require("../../../utils/couponStore.js");
const recommendation = require("../../../utils/recommendation.js");
const weatherService = require("../../../utils/services/weatherService.js");
const haptics = require("../../../utils/haptics.js");
const {
  calculateWheelSlices,
  computeTargetAngle,
  createConfettiParticles,
  updateAndRenderConfetti,
  buildCategoryFilters,
  filterWheelCandidates,
  buildFilterSummary,
} = require("../wheelEngine.js");
const { normalizeExactId } = require("../../../utils/idUtils.js");

const MAX_CANVAS_INIT_ATTEMPTS = 3;
const MAX_CANVAS_DPR = 4;
const MAX_CANVAS_BACKING_SIZE = 2048;
const CANDIDATE_PAGE_SIZE = 40;
const MAX_WHEEL_VISUAL_SLICES = 32;
const MAX_BULK_CANDIDATE_TOGGLES = 500;

function decodeSharedCandidate(value) {
  const raw = String(value || "").trim().slice(0, 2048);
  if (!raw) return "";
  try {
    return Array.from(decodeURIComponent(raw).trim()).slice(0, 80).join("");
  } catch (error) {
    return Array.from(raw).slice(0, 80).join("");
  }
}

function showActiveToast(page, options) {
  if (!page || page.unloaded || page.hidden) return;
  try {
    wx.showToast(options);
  } catch (error) {
    console.warn("food wheel toast failed:", error);
  }
}

function buildBoundedWheelItems(activeItems, mode) {
  const items = Array.isArray(activeItems) ? activeItems : [];
  const candidateSliceIndex = new Map();
  if (items.length <= MAX_WHEEL_VISUAL_SLICES) {
    items.forEach((item, index) => candidateSliceIndex.set(item.id, index));
    return {
      candidateSliceIndex,
      visualItems: items,
      visualMode: mode,
    };
  }

  const visualItems = [];
  for (let index = 0; index < MAX_WHEEL_VISUAL_SLICES; index += 1) {
    const start = Math.floor((index * items.length) / MAX_WHEEL_VISUAL_SLICES);
    const end = Math.floor(((index + 1) * items.length) / MAX_WHEEL_VISUAL_SLICES);
    const members = items.slice(start, end);
    if (!members.length) continue;
    members.forEach((item) => candidateSliceIndex.set(item.id, visualItems.length));
    const first = members[0];
    visualItems.push({
      id: `wheel_group_${index}`,
      source: "group",
      title: members.length > 1 ? `${first.title}等${members.length}项` : first.title,
      weight: mode === "random"
        ? members.length
        : members.reduce((sum, item) => sum + (Number(item.weight) || 0), 0),
    });
  }

  return {
    candidateSliceIndex,
    visualItems,
    // 分组后每个扇区代表的候选数不同，因此两种模式都按聚合权重绘制。
    visualMode: "weighted",
  };
}

const handlers = {
releaseCanvasBackingStore() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (ctx && this.canvasWidth && this.canvasHeight) {
      try {
        ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
      } catch (error) {
        console.warn("wheel canvas clear failed:", error);
      }
    }
    if (canvas) {
      try {
        canvas.width = 1;
        canvas.height = 1;
      } catch (error) {
        console.warn("wheel canvas release failed:", error);
      }
    }
    this.ctx = null;
    this.canvas = null;
    this.canvasWidth = 0;
    this.canvasHeight = 0;
    this.canvasDpr = 1;
    this.cancelConfettiFrame = null;
    this.confettiFrameId = null;
    this.canvasInitPending = false;
    this.hasRendered = false;
  },

initCanvas(callback) {
    if (this.unloaded || this.hidden || this.canvasInitPending) return;
    const initToken = (this.canvasInitToken || 0) + 1;
    this.canvasInitToken = initToken;
    this.canvasInitPending = true;
    const failInitialization = (error) => {
      if (initToken !== this.canvasInitToken) return;
      this.canvasInitPending = false;
      if (error) console.warn("wheel canvas initialization failed:", error);
      if (typeof callback === "function" && !this.unloaded && !this.hidden) callback(false);
    };
    const handleCanvasResult = (res) => {
      if (initToken !== this.canvasInitToken || this.unloaded || this.hidden) {
        const staleCanvas = res && res[0] && res[0].node;
        // 隐藏期的迟到回调也要释放；若页面已重新显示，则不能误缩新一代共用节点。
        if (staleCanvas && (this.unloaded || this.hidden)) {
          try {
            staleCanvas.width = 1;
            staleCanvas.height = 1;
          } catch (error) {}
        }
        return;
      }
      this.canvasInitPending = false;
      if (!res || !res[0]) {
        failInitialization();
        return;
      }
      const canvas = res[0].node;
      if (!canvas) {
        failInitialization();
        return;
      }
      try {
        const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
        if (!ctx) {
          failInitialization();
          return;
        }

        let windowInfo = {};
        try {
          windowInfo = typeof wx.getWindowInfo === "function" ? (wx.getWindowInfo() || {}) : {};
        } catch (error) {}
        const reportedDpr = Number(windowInfo.pixelRatio);
        const dpr = Number.isFinite(reportedDpr)
          ? Math.min(MAX_CANVAS_DPR, Math.max(1, reportedDpr))
          : 1;
        const reportedWindowWidth = Number(windowInfo.windowWidth);
        const windowWidth = Number.isFinite(reportedWindowWidth) && reportedWindowWidth > 0
          ? reportedWindowWidth
          : 375;
        const measuredWidth = Number(res[0].width);
        const measuredHeight = Number(res[0].height);
        const measuredCanvasPx = [measuredWidth, measuredHeight]
          .filter((value) => Number.isFinite(value) && value > 0)
          .reduce((minimum, value) => Math.min(minimum, value), Number.POSITIVE_INFINITY);
        const requestedCanvasPx = Number.isFinite(measuredCanvasPx)
          ? measuredCanvasPx
          : 620 * (windowWidth / 750);
        const canvasPx = Math.max(1, Math.min(requestedCanvasPx, MAX_CANVAS_BACKING_SIZE / dpr));
        const backingSize = Math.max(1, Math.min(
          MAX_CANVAS_BACKING_SIZE,
          Math.round(canvasPx * dpr),
        ));

        canvas.width = backingSize;
        canvas.height = backingSize;
        ctx.scale(dpr, dpr);

        this.canvas = canvas;
        this.ctx = ctx;
        this.canvasWidth = canvasPx;
        this.canvasHeight = canvasPx;
        this.canvasDpr = dpr;
        this.currentAngle = 0;
      } catch (error) {
        try {
          canvas.width = 1;
          canvas.height = 1;
        } catch (releaseError) {}
        failInitialization(error);
        return;
      }
      if (typeof callback === "function") callback(true);
    };

    try {
      const query = wx.createSelectorQuery();
      query.select("#wheelCanvas").fields({ node: true, size: true }).exec(handleCanvasResult);
    } catch (error) {
      failInitialization(error);
    }
  },

launchConfetti() {
    const { ctx, canvas, canvasWidth: width, canvasHeight: height } = this;
    if (!ctx || !canvas) return;
    this.stopConfetti();

    const colors = ["#d99c52", "#0d5f5a", "#e25c5c", "#a8c3b7", "#cbd6c1", "#3b82f6", "#fcd34d"];
    const particles = createConfettiParticles(width / 2, height / 2, colors, 120);
    const requestFrame = canvas.requestAnimationFrame
      ? canvas.requestAnimationFrame.bind(canvas)
      : ((callback) => setTimeout(callback, 16));
    this.cancelConfettiFrame = canvas.cancelAnimationFrame
      ? canvas.cancelAnimationFrame.bind(canvas)
      : clearTimeout;

    const renderLoop = () => {
      this.confettiFrameId = null;
      if (this.unloaded || this.hidden || this.data.spinning) {
        try {
          ctx.clearRect(0, 0, width, height);
        } catch (error) {}
        return;
      }
      let remainingParticles = 0;
      try {
        remainingParticles = updateAndRenderConfetti(ctx, width, height, particles);
      } catch (error) {
        console.warn("wheel confetti render failed:", error);
        return;
      }
      if (remainingParticles > 0) {
        try {
          this.confettiFrameId = requestFrame(renderLoop);
        } catch (error) {
          this.confettiFrameId = null;
        }
      }
    };
    renderLoop();
  },

stopConfetti() {
    if (this.confettiFrameId !== null && this.confettiFrameId !== undefined
      && typeof this.cancelConfettiFrame === "function") {
      try {
        this.cancelConfettiFrame(this.confettiFrameId);
      } catch (error) {}
    }
    this.confettiFrameId = null;
  }
};

module.exports = handlers;
