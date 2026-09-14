const { buildWheelShareData } = require("../wheelEngine.js");

module.exports = {
  onShareAppMessage() {
    return buildWheelShareData(this.data.result);
  },

  onShareTimeline() {
    const result = this.data.result;
    const title = Array.from(String((result && result.title) || "").trim()).slice(0, 80).join("");
    return {
      title: title ? `🎯 今天吃啥抽中了【${title}】！` : "🎲 今天吃啥转盘：解决你的用餐选择困难症！",
      query: "",
    };
  },
};
