const QUANTITY_UNIT_PATTERN = "(?:份|盘|扎|杯|听|个|块|碗|套|位|串|盒|瓶|支|包|组|根|双|只|张|口|例|条|打|锅|煲|桶|罐|管|勺|坛|把|碟|盆|段|粒|颗|片|卷|扇|袋|箱|册|首|部|件|顶|名|人|人次|次|场|局|轮|节|堂|门|晚|天|宿|笼|尾|切角|g|kg|ml|L|小时|分钟|分|h|min)";
const CHINESE_OR_ARABIC_NUM_PATTERN = "(?:\\d+(?:\\.\\d+)?|\\d+\\/\\d+|[一二三四五六七八九十百千万两半]+)";

function parseDishesList(dishesStr = "") {
  if (!dishesStr || typeof dishesStr !== "string") return [];
  const text = dishesStr.trim().slice(0, 4000);
  if (!text) return [];

  const rawItems = text.split(/[\n\r、,，;；+|]+|\/(?!\d)|\s{2,}/)
    .map((s) => s.trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, 100);
  return rawItems.map((item, idx) => {
    const multiMatch = item.match(/^(.+?)\s*[xX*×]\s*(\d+|[一二三四五六七八九十两半]+)\s*$/);
    if (multiMatch) {
      return { id: `dish_${idx}`, name: multiMatch[1].trim().slice(0, 120), count: `x${multiMatch[2].trim().slice(0, 24)}` };
    }

    const quantityPattern = `${CHINESE_OR_ARABIC_NUM_PATTERN}\\s*${QUANTITY_UNIT_PATTERN}`;
    const standardMatch = item.match(new RegExp(`^(.+?)\\s*(${quantityPattern})\\s*$`, "i"));
    if (standardMatch) {
      return { id: `dish_${idx}`, name: standardMatch[1].trim().slice(0, 120), count: standardMatch[2].trim().slice(0, 24) };
    }

    const parenthesizedMatch = item.match(/^(.+?)[(（]([^()（）]+)[)）]\s*$/);
    if (parenthesizedMatch) {
      return { id: `dish_${idx}`, name: parenthesizedMatch[1].trim().slice(0, 120), count: parenthesizedMatch[2].trim().slice(0, 24) };
    }

    return { id: `dish_${idx}`, name: item.slice(0, 120), count: "" };
  });
}

module.exports = {
  parseDishesList,
};
