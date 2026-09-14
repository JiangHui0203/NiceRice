const preferenceStore = require("../../utils/preferenceStore.js");
const haptics = require("../../utils/haptics.js");

Page({
  data: {
    preferences: preferenceStore.defaultPreferences,
    foodDraft: preferenceStore.buildFoodDraft(preferenceStore.defaultPreferences),
    foodOptions: preferenceStore.buildFoodOptions(preferenceStore.defaultPreferences),
    foodCustomMode: "likedFoods",
    foodCustomValue: "",
  },

  onLoad() {
    this.hidden = false;
    this.unloaded = false;
    const preferences = preferenceStore.readPreferences();
    const foodDraft = preferenceStore.buildFoodDraft(preferences);
    this.setData({
      preferences,
      foodDraft,
      foodOptions: preferenceStore.buildFoodOptions(foodDraft),
    });
  },

  onShow() {
    if (this.unloaded) return;
    this.hidden = false;
  },

  onHide() {
    this.hidden = true;
    if (this.navigationTimer !== null && this.navigationTimer !== undefined) {
      clearTimeout(this.navigationTimer);
      this.navigationTimer = null;
    }
  },

  onUnload() {
    this.unloaded = true;
    this.onHide();
  },

  toggleFoodPreference(e) {
    haptics.light();
    const mode = e.currentTarget.dataset.mode;
    const label = e.currentTarget.dataset.label;
    const oppositeMode = mode === "likedFoods" ? "dislikedFoods" : "likedFoods";
    const foodDraft = Object.assign({}, this.data.foodDraft);
    const values = (foodDraft[mode] || []).slice();
    const oppositeValues = (foodDraft[oppositeMode] || []).slice();
    const index = values.indexOf(label);
    if (index > -1) {
      values.splice(index, 1);
    } else {
      values.push(label);
      const oppositeIndex = oppositeValues.indexOf(label);
      if (oppositeIndex > -1) oppositeValues.splice(oppositeIndex, 1);
    }
    foodDraft[mode] = preferenceStore.unique(values);
    foodDraft[oppositeMode] = preferenceStore.unique(oppositeValues);
    this.setData({
      foodDraft,
      foodOptions: preferenceStore.buildFoodOptions(foodDraft),
    });
  },

  selectFoodCustomMode(e) {
    haptics.light();
    this.setData({
      foodCustomMode: e.currentTarget.dataset.mode,
    });
  },

  onFoodCustomInput(e) {
    this.setData({
      foodCustomValue: e.detail.value,
    });
  },

  addCustomFood() {
    const label = this.data.foodCustomValue.trim();
    if (!label) {
      wx.showToast({
        title: "先输入食材或口味",
        icon: "none",
      });
      return;
    }
    if (label.length > 8) {
      wx.showToast({
        title: "名称尽量短一点",
        icon: "none",
      });
      return;
    }
    haptics.medium();
    const mode = this.data.foodCustomMode;
    const oppositeMode = mode === "likedFoods" ? "dislikedFoods" : "likedFoods";
    const foodDraft = Object.assign({}, this.data.foodDraft);
    const values = (foodDraft[mode] || []).slice();
    const oppositeValues = (foodDraft[oppositeMode] || []).slice();
    const customFoods = (foodDraft.customFoods || []).slice();
    if (values.indexOf(label) === -1) values.push(label);
    const oppositeIndex = oppositeValues.indexOf(label);
    if (oppositeIndex > -1) oppositeValues.splice(oppositeIndex, 1);
    if (preferenceStore.foodCommonOptions.indexOf(label) === -1 && customFoods.indexOf(label) === -1) {
      customFoods.push(label);
    }
    foodDraft[mode] = preferenceStore.unique(values);
    foodDraft[oppositeMode] = preferenceStore.unique(oppositeValues);
    foodDraft.customFoods = preferenceStore.unique(customFoods);
    this.setData({
      foodDraft,
      foodOptions: preferenceStore.buildFoodOptions(foodDraft),
      foodCustomValue: "",
    });
  },

  cancelEdit() {
    wx.navigateBack();
  },

  saveEdit() {
    haptics.medium();
    const preferences = Object.assign({}, this.data.preferences, {
      likedFoods: preferenceStore.unique(this.data.foodDraft.likedFoods),
      dislikedFoods: preferenceStore.unique(this.data.foodDraft.dislikedFoods),
      customFoods: preferenceStore.unique(this.data.foodDraft.customFoods),
    });
    if (!preferenceStore.savePreferences(preferences)) {
      wx.showToast({
        title: "保存失败",
        icon: "none",
      });
      return;
    }
    wx.showToast({
      title: "已保存",
      icon: "success",
    });
    this.navigationTimer = setTimeout(() => {
      this.navigationTimer = null;
      if (!this.hidden && !this.unloaded) wx.navigateBack();
    }, 450);
  },
});
