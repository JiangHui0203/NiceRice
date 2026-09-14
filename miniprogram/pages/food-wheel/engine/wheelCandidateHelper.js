const CATEGORY_ORDER = ["美食", "饮品", "娱乐", "户外", "生活", "其他"];

const SCENARIO_PACKS = {
  workday: ["麻辣烫", "沙县小吃", "自选快餐", "牛肉拉面", "日式便当", "轻食沙拉"],
  diet: ["羽衣甘蓝沙拉", "鸡胸肉波奇饭", "减脂荞麦面", "无糖酸奶碗", "清汤时蔬煲"],
  night: ["炭烤生蚝", "川味烤鱼", "烤冷面与炸串", "麻辣小龙虾", "精酿与炸鸡"],
  tea: ["特调手冲咖啡", "生椰拿铁", "红丝绒切块", "港式丝袜奶茶", "舒芙蕾松饼"],
};

function buildCategoryFilters(candidates) {
  const counts = {};
  (candidates || []).forEach((candidate) => {
    const label = candidate.categoryLabel || "其他";
    counts[label] = (counts[label] || 0) + 1;
  });
  return CATEGORY_ORDER
    .filter((label) => counts[label])
    .map((label) => ({ label, count: counts[label] }));
}

function filterWheelCandidates(allCandidates, sourceFilter, activeCategory) {
  const candidates = (allCandidates || []).filter((item) => {
    const sourceMatched = sourceFilter === "all" || item.source === sourceFilter;
    const categoryMatched = activeCategory === "all" || item.categoryLabel === activeCategory;
    return sourceMatched && categoryMatched;
  });
  const selectable = candidates.filter((item) => !item.blocked);
  const enabled = selectable.filter((item) => item.enabled);
  const allEnabled = selectable.length > 0 && enabled.length === selectable.length;

  return {
    candidates,
    allEnabled,
    enabledCount: enabled.length,
    couponCount: candidates.filter((item) => item.source === "coupon").length,
    customCount: candidates.filter((item) => item.source === "custom").length,
  };
}

function buildFilterSummary(sourceFilter, activeCategory, sourceFilters = []) {
  const source = sourceFilters.find((item) => item.value === sourceFilter);
  const labels = [];
  if (source && source.value !== "all") labels.push(source.label);
  if (activeCategory !== "all") labels.push(activeCategory);
  return labels.length ? labels.join(" · ") : "全部候选";
}

module.exports = {
  buildCategoryFilters,
  filterWheelCandidates,
  buildFilterSummary,
  SCENARIO_PACKS,
};
