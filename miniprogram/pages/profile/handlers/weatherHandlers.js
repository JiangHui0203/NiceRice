const weatherService = require("../../../utils/services/weatherService.js");
const haptics = require("../../../utils/haptics.js");

function getWeatherState(page) {
  const weather = weatherService.getWeather() || {};
  const weatherOptions = weatherService.getWeatherOptions() || [];
  const categories = weatherService.getWeatherCategories() || [];
  const categoryIds = categories.map((item) => item && item.id).filter(Boolean);
  const preferredCategory = weather.category || page.data.activeCategory || "sunny";
  const activeCategory = categoryIds.includes(preferredCategory)
    ? preferredCategory
    : (categoryIds[0] || "sunny");
  return {
    weather,
    weatherOptions,
    categories,
    activeCategory,
    activeSubWeathers: weatherOptions.filter((option) => option.category === activeCategory),
    isWeatherOverride: weatherService.isWeatherOverrideActive(),
  };
}

function renderWeatherState(page, toast = null) {
  page.setData(getWeatherState(page), () => {
    if (page.unloaded || page.hidden) return;
    page.updateSummaries();
    if (toast) wx.showToast(toast);
  });
}

module.exports = {
  selectWeather(e) {
    const value = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.value
      : "";
    const valid = (this.data.weatherOptions || []).some((option) => option && option.value === value);
    if (!valid || !weatherService.saveWeatherOverride(value)) {
      wx.showToast({ title: "天气设置失败", icon: "none" });
      return;
    }
    haptics.light();
    renderWeatherState(this, { title: "天气已更新", icon: "success" });
  },

  resetWeather() {
    if (!weatherService.clearWeatherOverride()) {
      wx.showToast({ title: "实况模式恢复失败", icon: "none" });
      return;
    }
    haptics.light();
    renderWeatherState(this, { title: "已恢复实况天气", icon: "none" });
  },

  selectCategory(e) {
    const activeCategory = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "";
    if (!(this.data.categories || []).some((category) => category && category.id === activeCategory)) return;
    haptics.light();
    const weatherOptions = this.data.weatherOptions || [];
    this.setData({
      activeCategory,
      activeSubWeathers: weatherOptions.filter((option) => option.category === activeCategory),
    });
  },
};

module.exports.getWeatherState = getWeatherState;
