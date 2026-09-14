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
spin() {
    if (this.unloaded || this.hidden) return;
    if (this.wheelDataReady === false) {
      showActiveToast(this, { title: "转盘正在刷新，请稍候", icon: "none" });
      return;
    }
    const filteredCandidates = Array.isArray(this.filteredCandidateRecords)
      ? this.filteredCandidateRecords
      : [];
    const activeItems = filteredCandidates.filter(
      (item) => item.enabled && !item.blocked && Number(item.weight) > 0,
    );
    if (this.data.spinning || !activeItems.length) return;

    let candidate = null;
    try {
      candidate = spinStore.pickCandidate(filteredCandidates, this.data.mode);
    } catch (error) {
      showActiveToast(this, { title: "候选抽取失败，请重试", icon: "none" });
      return;
    }
    if (!candidate) return;
    let visualItems = Array.isArray(this.wheelVisualItems) ? this.wheelVisualItems : [];
    let visualMode = this.wheelVisualMode || this.data.mode;
    let targetIndex = this.wheelCandidateSliceIndex instanceof Map
      ? this.wheelCandidateSliceIndex.get(candidate.id)
      : undefined;
    if (!visualItems.length || !Number.isInteger(targetIndex)) {
      const boundedWheel = buildBoundedWheelItems(activeItems, this.data.mode);
      visualItems = boundedWheel.visualItems;
      visualMode = boundedWheel.visualMode;
      targetIndex = boundedWheel.candidateSliceIndex.get(candidate.id);
      this.wheelVisualItems = visualItems;
      this.wheelVisualMode = visualMode;
      this.wheelCandidateSliceIndex = boundedWheel.candidateSliceIndex;
    }
    if (!Number.isInteger(targetIndex)) {
      showActiveToast(this, { title: "选中项无效", icon: "none" });
      return;
    }

    let targetAngleDegrees = 0;
    try {
      targetAngleDegrees = computeTargetAngle(
        visualItems,
        targetIndex,
        visualMode,
        this.currentAngleDegrees || 0
      );
      this.setData({
        spinning: true,
        resultVisible: false,
        result: null,
        wheelRotation: targetAngleDegrees,
        wheelTransitionStyle: "transform 3.5s cubic-bezier(0.15, 0.9, 0.25, 1)",
      });
    } catch (error) {
      showActiveToast(this, { title: "转盘启动失败，请重试", icon: "none" });
      return;
    }

    if (this.tickTimeoutId !== null && this.tickTimeoutId !== undefined) clearTimeout(this.tickTimeoutId);
    let tickCount = 0;
    const playTick = () => {
      this.tickTimeoutId = null;
      if (tickCount >= 6 || this.unloaded || this.hidden || !this.data.spinning) return;
      try {
        haptics.light();
      } catch (error) {}
      tickCount += 1;
      try {
        this.tickTimeoutId = setTimeout(playTick, Math.floor(200 * Math.pow(1.4, tickCount)));
      } catch (error) {
        this.tickTimeoutId = null;
      }
    };
    playTick();

    this.currentAngleDegrees = targetAngleDegrees;
    const finishSpin = () => {
      this.spinTimeoutId = null;
      if (this.unloaded || this.hidden) return;
      this.currentAngleDegrees %= 360;

      let result = Object.assign({}, candidate);
      if (candidate.source === "coupon" && candidate.couponId) {
        try {
          const coupon = couponStore.findCoupon(candidate.couponId);
          if (coupon) {
            const rec = recommendation.generateRecommendation(coupon, this.getRecommendationContext());
            result = Object.assign(result, {
              reasons: rec.reasons || [],
              warnings: rec.warnings || [],
              score: rec.score || candidate.score,
              level: rec.level || candidate.level,
            });
          }
        } catch (error) {
          console.warn("food wheel result enrichment failed:", error);
        }
      }

      try {
        haptics.medium();
      } catch (error) {}
      let resultRendered = true;
      try {
        this.setData({
          spinning: false,
          result,
          resultVisible: true,
          wheelTransitionStyle: "none",
          wheelRotation: this.currentAngleDegrees,
        }, () => {
          if (!this.unloaded && !this.hidden) this.launchConfetti();
        });
      } catch (error) {
        resultRendered = false;
        console.warn("food wheel result render failed:", error);
        try {
          this.setData({
            spinning: false,
            wheelTransitionStyle: "none",
            wheelRotation: this.currentAngleDegrees,
          });
        } catch (recoveryError) {}
      }
      let historySaved = false;
      try {
        historySaved = Boolean(spinStore.saveLastResult(candidate));
      } catch (error) {
        console.warn("food wheel history storage threw:", error);
      }
      if (!resultRendered || !historySaved) {
        showActiveToast(this, {
          title: !resultRendered && !historySaved
            ? "结果已生成，但页面显示和历史保存失败"
            : (!resultRendered ? "结果已生成，但页面显示失败" : "结果已生成，但历史记录保存失败"),
          icon: "none",
        });
      }
      try {
        eventLogger.logEvent("food_wheel_result", {
          mode: this.data.mode,
          candidateId: candidate.id,
          source: candidate.source,
        });
      } catch (error) {
        console.warn("food wheel result log failed:", error);
      }
    };
    try {
      this.spinTimeoutId = setTimeout(finishSpin, 3500);
    } catch (error) {
      this.spinTimeoutId = null;
      if (this.tickTimeoutId !== null && this.tickTimeoutId !== undefined) {
        clearTimeout(this.tickTimeoutId);
        this.tickTimeoutId = null;
      }
      this.currentAngleDegrees %= 360;
      try {
        this.setData({
          spinning: false,
          wheelTransitionStyle: "none",
          wheelRotation: this.currentAngleDegrees,
        });
      } catch (renderError) {}
      showActiveToast(this, { title: "转盘计时启动失败，请重试", icon: "none" });
    }
  },

spinAgain() {
    this.spin();
  },

excludeResult() {
    if (!this.data.result) return;
    const resultId = normalizeExactId(this.data.result.id, 128);
    if (!resultId) {
      showActiveToast(this, { title: "候选标识无效，请刷新后重试", icon: "none" });
      return;
    }
    let excluded = false;
    try {
      excluded = Boolean(spinStore.setCandidateEnabled(resultId, false));
    } catch (error) {
      console.warn("food wheel result exclusion failed:", error);
    }
    if (!excluded) {
      wx.showToast({ title: "排除候选保存失败", icon: "none" });
      return;
    }
    this.setData({ resultVisible: false, result: null });
    this.wheelDataReady = false;
    this.loadCandidates();
  }
};

// 分页后批量操作仍作用于完整筛选结果，避免“全选”只影响首屏。
handlers.toggleAllCandidates = function toggleAllCandidates() {
  if (this.unloaded || this.hidden) return;
  try {
    haptics.light();
  } catch (error) {}
  const targetState = !this.data.allEnabled;
  const ids = (Array.isArray(this.filteredCandidateRecords) ? this.filteredCandidateRecords : [])
    .filter((item) => item && !item.blocked)
    .map((item) => item.id)
    .filter(Boolean);
  if (!ids.length) {
    showActiveToast(this, { title: "当前没有可切换的候选", icon: "none" });
    return;
  }
  if (ids.length > MAX_BULK_CANDIDATE_TOGGLES) {
    showActiveToast(this, { title: "候选过多，请先按来源或分类筛选后再批量切换", icon: "none" });
    return;
  }
  let saved = false;
  try {
    saved = Boolean(spinStore.setCandidatesEnabled(ids, targetState));
  } catch (error) {
    console.warn("food wheel bulk candidate storage failed:", error);
  }
  if (!saved) {
    showActiveToast(this, { title: "候选状态保存失败", icon: "none" });
    return;
  }
  this.wheelDataReady = false;
  const refreshed = this.loadCandidates() !== false;
  const refreshedById = new Map(
    (Array.isArray(this.allCandidateRecords) ? this.allCandidateRecords : [])
      .filter((item) => item && item.id)
      .map((item) => [item.id, item]),
  );
  const fullyApplied = refreshed && ids.every((id) => {
    const item = refreshedById.get(id);
    return item && Boolean(item.enabled) === targetState;
  });
  showActiveToast(this, {
    title: !refreshed
      ? "候选状态已保存，列表刷新失败"
      : (fullyApplied
        ? (targetState ? "已全选" : "已全不选")
        : "部分候选状态未能保存，请缩小筛选范围后重试"),
    icon: "none",
  });
};

// 删除校验读取页面实例中的完整数据，不再要求把全量候选传到视图层。
handlers.removeCustom = function removeCustom(e) {
  if (this.unloaded || this.hidden) return;
  const id = normalizeExactId((e && e.currentTarget && e.currentTarget.dataset
    ? e.currentTarget.dataset.id
    : "") || "", 128);
  const item = (Array.isArray(this.allCandidateRecords) ? this.allCandidateRecords : [])
    .find((candidate) => candidate && candidate.id === id);
  if (!item || item.source !== "custom") {
    showActiveToast(this, { title: "该自定义候选已不存在", icon: "none" });
    return;
  }
  let removed = false;
  try {
    removed = Boolean(spinStore.removeCustomCandidate(id));
  } catch (error) {
    console.warn("food wheel custom candidate removal failed:", error);
  }
  if (!removed) {
    showActiveToast(this, { title: "删除失败，请重试", icon: "none" });
    return;
  }
  this.wheelDataReady = false;
  if (this.loadCandidates() === false) {
    showActiveToast(this, { title: "候选已删除，列表刷新失败", icon: "none" });
  }
};


module.exports = handlers;
