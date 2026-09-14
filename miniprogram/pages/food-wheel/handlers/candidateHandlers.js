const spinStore = require("../../../utils/spinStore.js");
const haptics = require("../../../utils/haptics.js");
const { SCENARIO_PACKS } = require("../wheelEngine.js");
const { normalizeExactId } = require("../../../utils/idUtils.js");

function isPageActive(page) {
  return !page.hidden && !page.unloaded;
}

function showActiveToast(page, options) {
  if (!isPageActive(page)) return;
  try {
    wx.showToast(options);
  } catch (error) {
    console.warn("food wheel candidate toast failed:", error);
  }
}

function renderActiveState(page, patch, callback) {
  if (!isPageActive(page)) return false;
  try {
    page.setData(patch, () => {
      if (!isPageActive(page) || typeof callback !== "function") return;
      try {
        callback();
      } catch (error) {
        console.warn("food wheel candidate render callback failed:", error);
        showActiveToast(page, { title: "页面刷新失败，请重试", icon: "none" });
      }
    });
    return true;
  } catch (error) {
    console.warn("food wheel candidate render failed:", error);
    return false;
  }
}

function renderWheelFilterState(page, patch, callback) {
  const previousWheelDataReady = page.wheelDataReady;
  page.wheelDataReady = false;
  const rendered = renderActiveState(page, patch, callback);
  if (!rendered) page.wheelDataReady = previousWheelDataReady;
  return rendered;
}

function runHaptic(type) {
  try {
    if (typeof haptics[type] === "function") haptics[type]();
  } catch (error) {}
}

function boundedText(value, maxLength) {
  return Array.from(String(value === undefined || value === null ? "" : value).trim())
    .slice(0, maxLength)
    .join("");
}

function persistCandidateChange(page, operation, failureMessage) {
  try {
    if (operation()) return true;
  } catch (error) {
    console.warn("food wheel candidate storage failed:", error);
  }
  showActiveToast(page, { title: failureMessage, icon: "none" });
  return false;
}

function refreshCandidates(page) {
  // 存储已发生变化时，旧扇区映射不得继续参与抽取。
  page.wheelDataReady = false;
  try {
    return page.loadCandidates() !== false;
  } catch (error) {
    console.warn("food wheel candidate refresh failed:", error);
    return false;
  }
}

module.exports = {
  toggleAllCandidates() {
    if (!isPageActive(this)) return;
    runHaptic("light");
    const { candidates, allEnabled } = this.data;
    const targetState = !allEnabled;
    const ids = (Array.isArray(candidates) ? candidates : [])
      .filter((item) => item && !item.blocked)
      .map((item) => item.id)
      .filter(Boolean);
    if (!ids.length) {
      showActiveToast(this, { title: "当前没有可切换的候选", icon: "none" });
      return;
    }
    if (!persistCandidateChange(
      this,
      () => spinStore.setCandidatesEnabled(ids, targetState),
      "候选状态保存失败",
    )) return;
    const refreshed = refreshCandidates(this);
    showActiveToast(this, {
      title: refreshed ? (targetState ? "已全选" : "已全不选") : "候选状态已保存，列表刷新失败",
      icon: "none",
    });
  },

  addPresetTag(e) {
    if (!isPageActive(this)) return;
    runHaptic("light");
    const tag = boundedText((e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.tag
      : "") || "", 80);
    if (!tag) return;
    if (!persistCandidateChange(this, () => spinStore.addCustomCandidate(tag), "候选保存失败")) return;
    const refreshed = refreshCandidates(this);
    showActiveToast(this, {
      title: refreshed ? `已加入: ${tag}` : "候选已保存，列表刷新失败",
      icon: "none",
    });
  },

  selectMode(e) {
    if (!isPageActive(this)) return;
    runHaptic("light");
    const mode = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.mode
      : "";
    if (!["random", "weighted"].includes(mode)) {
      showActiveToast(this, { title: "转盘模式无效，请重试", icon: "none" });
      return;
    }
    if (mode === this.data.mode) return;
    if (!renderWheelFilterState(this, { mode, resultVisible: false, result: null }, () => this.applyFilters())) {
      showActiveToast(this, { title: "转盘模式切换失败，请重试", icon: "none" });
    }
  },

  selectSourceFilter(e) {
    if (!isPageActive(this)) return;
    runHaptic("light");
    const sourceFilter = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.value
      : "";
    const validSources = (Array.isArray(this.data.sourceFilters) ? this.data.sourceFilters : [])
      .map((item) => item && item.value)
      .filter(Boolean);
    if (!validSources.includes(sourceFilter)) {
      showActiveToast(this, { title: "候选来源筛选无效，请重试", icon: "none" });
      return;
    }
    if (!renderWheelFilterState(this, { sourceFilter, resultVisible: false, result: null }, () => this.applyFilters())) {
      showActiveToast(this, { title: "候选筛选失败，请重试", icon: "none" });
    }
  },

  selectCategoryFilter(e) {
    if (!isPageActive(this)) return;
    runHaptic("light");
    const activeCategory = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.value
      : "";
    const validCategories = ["all"].concat(
      (Array.isArray(this.data.categoryFilters) ? this.data.categoryFilters : [])
        .map((item) => item && item.label)
        .filter(Boolean),
    );
    if (!validCategories.includes(activeCategory)) {
      showActiveToast(this, { title: "候选分类筛选无效，请重试", icon: "none" });
      return;
    }
    if (!renderWheelFilterState(this, { activeCategory, resultVisible: false, result: null }, () => this.applyFilters())) {
      showActiveToast(this, { title: "候选筛选失败，请重试", icon: "none" });
    }
  },

  onCustomInput(e) {
    if (!isPageActive(this)) return;
    const value = boundedText(e && e.detail ? e.detail.value : "", 80);
    if (!renderActiveState(this, { customTitle: value })) {
      showActiveToast(this, { title: "输入内容更新失败，请重试", icon: "none" });
    }
  },

  addCustom() {
    if (!isPageActive(this)) return;
    // 事件输入已有 maxlength；这里仍收口，兼容旧调用直接写入 data 的情况。
    const title = boundedText(this.data.customTitle, 80);
    if (!title) {
      showActiveToast(this, { title: "先写一个想法", icon: "none" });
      return;
    }
    if (!persistCandidateChange(this, () => spinStore.addCustomCandidate(title), "候选保存失败")) return;
    const inputCleared = renderActiveState(this, { customTitle: "" });
    const refreshed = refreshCandidates(this);
    if (!inputCleared || !refreshed) {
      showActiveToast(this, { title: "候选已保存，页面刷新失败", icon: "none" });
    }
  },

  toggleCandidate(e) {
    if (!isPageActive(this)) return;
    const id = normalizeExactId(e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "", 128);
    const item = (Array.isArray(this.data.candidates) ? this.data.candidates : [])
      .find((candidate) => candidate && candidate.id === id);
    if (!item || item.blocked) return;
    if (!persistCandidateChange(
      this,
      () => spinStore.setCandidateEnabled(id, !item.enabled),
      "候选状态保存失败",
    )) return;
    if (!refreshCandidates(this)) {
      showActiveToast(this, { title: "候选状态已保存，列表刷新失败", icon: "none" });
      return;
    }
    const refreshedItem = (Array.isArray(this.allCandidateRecords) ? this.allCandidateRecords : [])
      .find((candidate) => candidate && candidate.id === id);
    if (!refreshedItem || Boolean(refreshedItem.enabled) === Boolean(item.enabled)) {
      showActiveToast(this, { title: "候选状态未能保存，请调整筛选后重试", icon: "none" });
    }
  },

  removeCustom(e) {
    if (!isPageActive(this)) return;
    const id = normalizeExactId(e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "", 128);
    const item = (Array.isArray(this.data.allCandidates) ? this.data.allCandidates : [])
      .find((candidate) => candidate && candidate.id === id);
    if (!item || item.source !== "custom") {
      showActiveToast(this, { title: "该自定义候选已不存在", icon: "none" });
      return;
    }
    if (!persistCandidateChange(
      this,
      () => spinStore.removeCustomCandidate(id),
      "删除失败，请重试",
    )) return;
    if (!refreshCandidates(this)) {
      showActiveToast(this, { title: "候选已删除，列表刷新失败", icon: "none" });
    }
  },

  applyScenarioPack(e) {
    if (!isPageActive(this)) return;
    const pack = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.pack
      : "";
    runHaptic("medium");
    const items = Object.prototype.hasOwnProperty.call(SCENARIO_PACKS, pack)
      && Array.isArray(SCENARIO_PACKS[pack])
      ? SCENARIO_PACKS[pack]
      : [];
    if (!items.length) return;
    if (!persistCandidateChange(this, () => spinStore.replaceCustomCandidates(items), "预设包保存失败")) return;
    this.wheelDataReady = false;
    const rendered = renderActiveState(this, {
      sourceFilter: "all",
      activeCategory: "all",
      resultVisible: false,
      result: null,
    }, () => {
      const refreshed = refreshCandidates(this);
      showActiveToast(this, {
        title: refreshed ? "已载入预设包！" : "预设包已保存，页面刷新失败",
        icon: refreshed ? "success" : "none",
      });
    });
    if (!rendered) {
      showActiveToast(this, { title: "预设包已保存，页面刷新失败", icon: "none" });
    }
  },
};
