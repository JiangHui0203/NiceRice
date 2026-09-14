function buildWheelShareData(result) {
  const title = Array.from(String((result && result.title) || "").trim()).slice(0, 80).join("");
  if (title) {
    return {
      title: `🎯 今天吃啥转盘抽中了【${title}】，走起一起去吃！`,
      path: `/pages/food-wheel/index?add=${encodeURIComponent(title)}`,
    };
  }
  return {
    title: "🎲 今天吃啥转盘：解决你的选择困难症！",
    path: "/pages/food-wheel/index",
  };
}

module.exports = {
  buildWheelShareData,
};
