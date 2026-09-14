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
getRecommendationContext() {
    const weather = weatherService.getWeather ? weatherService.getWeather() : {};
    return recommendation.buildRecommendationContext({
      weather,
      existingPlans: planStore.getPlans(),
    });
  },

updateWheelData() {
    if (this.unloaded || this.hidden) return false;
    try {
      const activeItems = (Array.isArray(this.filteredCandidateRecords)
        ? this.filteredCandidateRecords
        : []).filter((item) => item.enabled && !item.blocked && Number(item.weight) > 0);
      const boundedWheel = buildBoundedWheelItems(activeItems, this.data.mode);
      const sliceCount = boundedWheel.visualItems.length || 6;
      const maxSafetyWidth = Math.min(230, Math.floor(240 * (6.28 / sliceCount) - 24));
      const baseFontSize = sliceCount > 4 ? Math.max(24, 32 - (sliceCount - 4) * 1.5) : 32;
      const { conicGradientStyle, wheelSlices } = calculateWheelSlices(
        boundedWheel.visualItems,
        boundedWheel.visualMode,
        maxSafetyWidth,
        baseFontSize
      );
      this.setData({ conicGradientStyle, wheelSlices });
      this.wheelVisualItems = boundedWheel.visualItems;
      this.wheelCandidateSliceIndex = boundedWheel.candidateSliceIndex;
      this.wheelVisualMode = boundedWheel.visualMode;
      this.wheelDataReady = true;
      return true;
    } catch (error) {
      this.wheelDataReady = false;
      console.warn("food wheel visual data update failed:", error);
      showActiveToast(this, { title: "转盘刷新失败，请重试", icon: "none" });
      return false;
    }
  },

loadCandidates() {
    if (this.unloaded || this.hidden) return false;
    const loadToken = (this.candidateLoadToken || 0) + 1;
    this.candidateLoadToken = loadToken;
    let allCandidates = null;
    let categoryFilters = null;
    try {
      allCandidates = spinStore.getCandidates();
      categoryFilters = buildCategoryFilters(allCandidates);
    } catch (error) {
      showActiveToast(this, { title: "候选列表读取失败，请重试", icon: "none" });
      return false;
    }
    const previousCandidatesLoaded = this.candidatesLoaded;
    const previousCandidateRecords = this.allCandidateRecords;
    const previousWheelDataReady = this.wheelDataReady;
    this.candidatesLoaded = true;
    this.allCandidateRecords = Array.isArray(allCandidates) ? allCandidates : [];
    this.wheelDataReady = false;
    const activeCategory = this.data.activeCategory !== "all"
      && !categoryFilters.some((filter) => filter.label === this.data.activeCategory)
      ? "all"
      : this.data.activeCategory;
    try {
      this.setData({ allCandidates: [], categoryFilters, activeCategory }, () => {
        if (loadToken === this.candidateLoadToken && !this.unloaded && !this.hidden) {
          this.applyFilters();
        }
      });
      return true;
    } catch (error) {
      this.candidatesLoaded = previousCandidatesLoaded;
      this.allCandidateRecords = previousCandidateRecords;
      this.wheelDataReady = previousWheelDataReady;
      console.warn("food wheel candidate list render failed:", error);
      showActiveToast(this, { title: "候选已读取，但列表刷新失败", icon: "none" });
      return false;
    }
  },

applyFilters() {
    if (this.unloaded || this.hidden) return false;
    const previousFilteredCandidateRecords = this.filteredCandidateRecords;
    const previousWheelDataReady = this.wheelDataReady;
    try {
      const { sourceFilter, activeCategory, sourceFilters } = this.data;
      const allCandidates = Array.isArray(this.allCandidateRecords) ? this.allCandidateRecords : [];
      const { candidates, allEnabled, enabledCount, couponCount, customCount } = filterWheelCandidates(
        allCandidates,
        sourceFilter,
        activeCategory
      );
      const filterSummary = buildFilterSummary(sourceFilter, activeCategory, sourceFilters);
      const candidateTotalCount = candidates.length;
      const candidateVisibleCount = Math.min(CANDIDATE_PAGE_SIZE, candidateTotalCount);
      this.filteredCandidateRecords = candidates;
      this.wheelDataReady = false;

      this.setData({
        candidates: candidates.slice(0, candidateVisibleCount),
        candidateVisibleCount,
        candidateTotalCount,
        hasMoreCandidates: candidateVisibleCount < candidateTotalCount,
        allEnabled,
        enabledCount,
        couponCount,
        customCount,
        filterSummary,
      }, () => {
        if (!this.unloaded && !this.hidden) this.updateWheelData();
      });
      return true;
    } catch (error) {
      this.filteredCandidateRecords = previousFilteredCandidateRecords;
      this.wheelDataReady = previousWheelDataReady;
      console.warn("food wheel filter update failed:", error);
      showActiveToast(this, { title: "候选筛选刷新失败，请重试", icon: "none" });
      return false;
    }
  },

loadMoreCandidates() {
    if (this.unloaded || this.hidden || !this.data.hasMoreCandidates || this.candidatePageLoading) return;
    const allFiltered = Array.isArray(this.filteredCandidateRecords)
      ? this.filteredCandidateRecords
      : [];
    const previousVisibleCount = Math.min(
      allFiltered.length,
      Math.max(0, Number(this.data.candidateVisibleCount) || 0),
    );
    const candidateVisibleCount = Math.min(
      allFiltered.length,
      previousVisibleCount + CANDIDATE_PAGE_SIZE,
    );
    const patch = {
      candidateVisibleCount,
      candidateTotalCount: allFiltered.length,
      hasMoreCandidates: candidateVisibleCount < allFiltered.length,
    };
    allFiltered.slice(previousVisibleCount, candidateVisibleCount).forEach((item, index) => {
      patch[`candidates[${previousVisibleCount + index}]`] = item;
    });
    this.candidatePageLoading = true;
    try {
      this.setData(patch, () => {
        this.candidatePageLoading = false;
      });
    } catch (error) {
      this.candidatePageLoading = false;
      console.warn("food wheel candidate page render failed:", error);
      showActiveToast(this, { title: "更多候选加载失败，请重试", icon: "none" });
    }
  }
};

module.exports = handlers;
