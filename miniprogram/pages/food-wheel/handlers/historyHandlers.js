const spinStore = require("../../../utils/spinStore.js");
const haptics = require("../../../utils/haptics.js");
const { normalizeExactId } = require("../../../utils/idUtils.js");

function isPageActive(page) {
  return !page.hidden && !page.unloaded;
}

function showActiveToast(page, options) {
  if (!isPageActive(page)) return;
  try {
    wx.showToast(options);
  } catch (error) {
    console.warn("food wheel history toast failed:", error);
  }
}

function renderActiveState(page, patch) {
  if (!isPageActive(page)) return false;
  try {
    page.setData(patch);
    return true;
  } catch (error) {
    console.warn("food wheel history render failed:", error);
    return false;
  }
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

function normalizeHistoryResult(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const title = boundedText(item.title, 80);
  if (!title) return null;
  const score = Number(item.score);
  const weight = Number(item.weight);
  const id = item.id ? normalizeExactId(item.id, 128) : "";
  const couponId = item.couponId ? normalizeExactId(item.couponId, 96) : "";
  if ((item.id && !id) || (item.couponId && !couponId)) return null;
  return {
    id,
    source: item.source === "coupon" ? "coupon" : "custom",
    couponId,
    title,
    subtitle: boundedText(item.subtitle, 120),
    reason: boundedText(item.reason, 160),
    reasons: (Array.isArray(item.reasons) ? item.reasons : [])
      .map((entry) => boundedText(entry, 160)).filter(Boolean).slice(0, 10),
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
    level: boundedText(item.level, 32),
    categoryKey: boundedText(item.categoryKey, 32),
    categoryLabel: boundedText(item.categoryLabel, 48),
    stateClass: boundedText(item.stateClass, 32),
    tags: (Array.isArray(item.tags) ? item.tags : [])
      .map((entry) => boundedText(entry, 32)).filter(Boolean).slice(0, 10),
    weight: Number.isFinite(weight) ? Math.max(1, Math.min(10, weight)) : 1,
    enabled: item.enabled !== false,
    blocked: item.blocked === true,
    selectedAt: boundedText(item.selectedAt, 40),
    timeText: boundedText(item.timeText, 48),
  };
}

module.exports = {
  toggleHistoryDrawer(e = {}) {
    if (e.type === "beforeleave") {
      if (this.data.showHistoryDrawer) {
        try {
          this.setData({ showHistoryDrawer: false, historyList: [] });
        } catch (error) {
          console.warn("food wheel history drawer cleanup failed:", error);
        }
      }
      this.spinHistoryRecords = [];
      return;
    }
    if (!isPageActive(this)) return;
    runHaptic("light");
    const nextState = !this.data.showHistoryDrawer;
    let historyList = [];
    if (nextState) {
      this.spinHistoryRecords = [];
      try {
        historyList = spinStore.getSpinHistory();
      } catch (error) {
        console.warn("food wheel history read failed:", error);
        showActiveToast(this, { title: "抽奖记录读取失败，请重试", icon: "none" });
        return;
      }
      if (!Array.isArray(historyList)) {
        showActiveToast(this, { title: "抽奖记录格式异常，请清理后重试", icon: "none" });
        return;
      }
    }
    if (!renderActiveState(this, {
      showHistoryDrawer: nextState,
      historyList,
    })) {
      showActiveToast(this, { title: "历史抽屉打开失败，请重试", icon: "none" });
      return;
    }
    // 私有完整集合只在视图切换成功后提交，避免 setData 失败时二者错位。
    this.spinHistoryRecords = nextState ? historyList : [];
  },

  clearHistory() {
    if (!isPageActive(this)) return;
    runHaptic("warning");
    try {
      wx.showModal({
        title: "清除抽奖记录",
        content: "确定清空近期的转盘记录吗？",
        confirmText: "清空",
        confirmColor: "#dc2626",
        success: (res) => {
          if (!isPageActive(this) || !res || !res.confirm) return;
          let cleared = false;
          try {
            cleared = Boolean(spinStore.clearSpinHistory());
          } catch (error) {
            console.warn("food wheel history clear failed:", error);
          }
          if (!cleared) {
            showActiveToast(this, { title: "清空失败，请重试", icon: "none" });
            return;
          }
          const rendered = renderActiveState(this, { historyList: [] });
          this.spinHistoryRecords = [];
          showActiveToast(this, {
            title: rendered ? "已清空" : "记录已清空，列表刷新失败",
            icon: rendered ? "success" : "none",
          });
        },
        fail: () => {
          showActiveToast(this, { title: "清空确认框打开失败，请重试", icon: "none" });
        },
      });
    } catch (error) {
      showActiveToast(this, { title: "清空确认框打开失败，请重试", icon: "none" });
    }
  },

  quickScheduleFromHistory(e) {
    if (!isPageActive(this)) return;
    const dataset = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset
      : {};
    const historyIndex = Number(dataset.index);
    const indexedItem = Number.isInteger(historyIndex) && historyIndex >= 0
      && Array.isArray(this.spinHistoryRecords)
      ? this.spinHistoryRecords[historyIndex]
      : null;
    // 保留 data-item 兼容，供迁移前页面或旧调用继续使用。
    const item = normalizeHistoryResult(indexedItem || dataset.item);
    if (!item) {
      showActiveToast(this, { title: "历史结果无效，请重新打开记录", icon: "none" });
      return;
    }
    runHaptic("medium");
    if (!renderActiveState(this, {
      result: item,
      resultVisible: true,
      showHistoryDrawer: false,
      historyList: [],
    })) {
      showActiveToast(this, { title: "历史结果载入失败，请重试", icon: "none" });
      return;
    }
    this.spinHistoryRecords = [];
    showActiveToast(this, { title: `已载入: ${item.title || "历史结果"}`, icon: "none" });
  },
};
