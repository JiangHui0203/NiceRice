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
onLoad(options = {}) {
    this.unloaded = false;
    this.hidden = false;
    this.hasRendered = false;
    this.candidatesLoaded = false;
    this.candidateLoadToken = 0;
    this.pageReady = false;
    this.canvasInitAttempts = 0;
    this.planSubmitting = false;
    this.planSubmissionToken = 0;
    this.pendingPlanNavigation = null;
    this.navigationTimerId = null;
    this.readyTimeoutId = null;
    this.tickTimeoutId = null;
    this.spinTimeoutId = null;
    this.confettiFrameId = null;
    this.canvas = null;
    this.ctx = null;
    this.allCandidateRecords = [];
    this.filteredCandidateRecords = [];
    this.spinHistoryRecords = [];
    this.wheelVisualItems = [];
    this.wheelCandidateSliceIndex = new Map();
    this.wheelVisualMode = "random";
    this.wheelDataReady = false;
    this.candidatePageLoading = false;
    this.currentAngleDegrees = 0;
    this.setData({ wheelRotation: 0, wheelTransitionStyle: "none" });

    const sharedTitle = decodeSharedCandidate(options.add);
    if (sharedTitle) {
      try {
        const exists = spinStore.getCandidates().some((candidate) => (
          candidate.source === "custom" && candidate.title === sharedTitle
        ));
        if (!exists) {
          if (spinStore.addCustomCandidate(sharedTitle)) this.sharedCandidateAdded = sharedTitle;
          else this.sharedCandidateAddFailed = true;
        }
      } catch (error) {
        this.sharedCandidateAddFailed = true;
      }
    }
  },

onShow() {
    if (this.unloaded) return;
    this.hidden = false;
    const resumePatch = {};
    if (this.data.spinning) {
      this.currentAngleDegrees = (this.currentAngleDegrees || 0) % 360;
      resumePatch.spinning = false;
      resumePatch.wheelTransitionStyle = "none";
      resumePatch.wheelRotation = this.currentAngleDegrees;
    }
    if (this.data.planSubmitting !== Boolean(this.planSubmitting)) {
      resumePatch.planSubmitting = Boolean(this.planSubmitting);
    }
    if (Object.keys(resumePatch).length) {
      try {
        this.setData(resumePatch);
      } catch (error) {
        console.warn("wheel resume-state render failed:", error);
      }
    }
    if (this.pageReady) {
      this.loadCandidates();
    }
    if (this.pageReady && !this.hasRendered) {
      this.canvasInitAttempts = 0;
      this.scheduleCanvasInitialization();
    }
    this.flushSharedCandidateNotice();
  },

onHide() {
    this.hidden = true;
    this.candidateLoadToken = (this.candidateLoadToken || 0) + 1;
    this.canvasInitToken = (this.canvasInitToken || 0) + 1;
    this.canvasInitPending = false;
    if (this.readyTimeoutId !== null && this.readyTimeoutId !== undefined) {
      clearTimeout(this.readyTimeoutId);
      this.readyTimeoutId = null;
    }
    if (typeof this.cancelPlanSubmission === "function") this.cancelPlanSubmission();
    if (this.tickTimeoutId !== null && this.tickTimeoutId !== undefined) {
      clearTimeout(this.tickTimeoutId);
      this.tickTimeoutId = null;
    }
    if (this.spinTimeoutId !== null && this.spinTimeoutId !== undefined) {
      clearTimeout(this.spinTimeoutId);
      this.spinTimeoutId = null;
    }
    this.stopConfetti();
    if (this.data.spinning && !this.unloaded) {
      this.currentAngleDegrees = (this.currentAngleDegrees || 0) % 360;
    }
    this.releaseCanvasBackingStore();
    this.releaseCandidateRenderData();
  },

onReady() {
    this.pageReady = true;
    this.canvasInitAttempts = 0;
    if (!this.candidatesLoaded) this.loadCandidates();
    this.scheduleCanvasInitialization();
  },

scheduleCanvasInitialization() {
    if ((this.readyTimeoutId !== null && this.readyTimeoutId !== undefined)
      || this.canvasInitPending || this.hasRendered || this.unloaded || this.hidden) return;
    if ((this.canvasInitAttempts || 0) >= MAX_CANVAS_INIT_ATTEMPTS) return;
    try {
      this.readyTimeoutId = setTimeout(() => {
        this.readyTimeoutId = null;
        if (this.unloaded || this.hidden) return;
        this.canvasInitAttempts = (this.canvasInitAttempts || 0) + 1;
        this.initCanvas((canvasReady) => {
          if (this.unloaded || this.hidden) return;
          if (!canvasReady) {
            if (!this.candidatesLoaded) this.loadCandidates();
            this.scheduleCanvasInitialization();
            return;
          }
          this.canvasInitAttempts = 0;
          if (!this.candidatesLoaded) this.loadCandidates();
          this.hasRendered = true;
          this.flushSharedCandidateNotice();
        });
      }, 150);
    } catch (error) {
      this.readyTimeoutId = null;
      console.warn("wheel canvas initialization scheduling failed:", error);
    }
  },

flushSharedCandidateNotice() {
    if (this.unloaded || this.hidden) return;
    if (this.sharedCandidateAdded) {
      showActiveToast(this, { title: `已加入: ${this.sharedCandidateAdded}`, icon: "none" });
      this.sharedCandidateAdded = "";
      return;
    }
    if (this.sharedCandidateAddFailed) {
      showActiveToast(this, { title: "分享候选保存失败", icon: "none" });
      this.sharedCandidateAddFailed = false;
    }
  },

onUnload() {
    this.unloaded = true;
    if (this.readyTimeoutId !== null && this.readyTimeoutId !== undefined) {
      clearTimeout(this.readyTimeoutId);
      this.readyTimeoutId = null;
    }
    this.onHide();
    this.pageReady = false;
  },

releaseCandidateRenderData() {
    this.allCandidateRecords = [];
    this.filteredCandidateRecords = [];
    this.spinHistoryRecords = [];
    this.wheelVisualItems = [];
    this.wheelCandidateSliceIndex = new Map();
    this.wheelVisualMode = this.data.mode || "random";
    this.wheelDataReady = false;
    this.candidatePageLoading = false;
    this.candidatesLoaded = false;
    if (this.unloaded) return;
    try {
      this.setData({
        allCandidates: [],
        candidates: [],
        candidateVisibleCount: 0,
        candidateTotalCount: 0,
        hasMoreCandidates: false,
        enabledCount: 0,
        couponCount: 0,
        customCount: 0,
        allEnabled: true,
        conicGradientStyle: "conic-gradient(#fbfaf7 0% 100%)",
        wheelSlices: [],
        spinning: false,
        planSubmitting: false,
        wheelTransitionStyle: "none",
        wheelRotation: (this.currentAngleDegrees || 0) % 360,
        showHistoryDrawer: false,
        historyList: [],
      });
    } catch (error) {
      console.warn("wheel candidate render state release failed:", error);
    }
  }
};

module.exports = handlers;
