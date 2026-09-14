const lifecycleHandlers = require("./handlers/lifecycleHandlers.js");
const canvasHandlers = require("./handlers/canvasHandlers.js");
const dataHandlers = require("./handlers/dataHandlers.js");
const spinHandlers = require("./handlers/spinHandlers.js");
const candidateHandlers = require("./handlers/candidateHandlers.js");
const planHandlers = require("./handlers/planHandlers.js");
const historyHandlers = require("./handlers/historyHandlers.js");
const shareHandlers = require("./handlers/shareHandlers.js");

const pageConfig = {
  data: {
    allCandidates: [],
    candidates: [],
    candidateVisibleCount: 0,
    candidateTotalCount: 0,
    hasMoreCandidates: false,
    enabledCount: 0,
    couponCount: 0,
    customCount: 0,
    sourceFilter: "all",
    sourceFilters: [
      { label: "全部", value: "all" },
      { label: "待用券", value: "coupon" },
      { label: "自定义", value: "custom" },
    ],
    activeCategory: "all",
    categoryFilters: [],
    filterSummary: "全部候选",
    customTitle: "",
    mode: "random",
    spinning: false,
    resultVisible: false,
    planSubmitting: false,
    conicGradientStyle: "conic-gradient(#fbfaf7 0% 100%)",
    wheelSlices: [],
    wheelRotation: 0,
    wheelTransitionStyle: "none",
    allEnabled: true,
    popularPresets: [
      "麻辣烫", "螺蛳粉", "炸鸡汉堡", "轻食沙拉", "日料寿司",
      "烧烤烤肉", "热腾拉面", "川湘小炒", "减脂轻食", "牛肉火锅",
    ],
    showHistoryDrawer: false,
    historyList: [],
  }
};

Object.assign(
  pageConfig,
  lifecycleHandlers,
  canvasHandlers,
  dataHandlers,
  spinHandlers,
  candidateHandlers,
  planHandlers,
  historyHandlers,
  shareHandlers,
);

Page(pageConfig);
