const preferenceStore = require("../../../utils/preferenceStore.js");
const haptics = require("../../../utils/haptics.js");

function applyPreferencePatch(page, patch, viewPatch = {}) {
  const candidate = Object.assign({}, page.data.preferences, patch);
  if (!preferenceStore.savePreferences(candidate)) {
    wx.showToast({ title: "偏好保存失败，请重试", icon: "none" });
    return null;
  }
  const preferences = preferenceStore.readPreferences();
  page.setData(Object.assign({}, viewPatch, {
    preferences,
    preferenceGroups: preferenceStore.buildGroups(preferences),
  }), () => {
    if (!page.unloaded && !page.hidden) page.updateSummaries();
  });
  return preferences;
}

module.exports = {
  togglePreference(e) {
    const { key, label } = e.currentTarget.dataset;
    const values = (this.data.preferences[key] || []).slice();
    const index = values.indexOf(label);
    if (index > -1) values.splice(index, 1);
    else values.push(label);
    applyPreferencePatch(this, { [key]: values });
  },

  selectLimit(e) {
    const { key, value } = e.currentTarget.dataset;
    applyPreferencePatch(this, { [key]: value });
  },

  onTransportModeChange(e) {
    const index = Number(e.detail.value);
    const mode = this.data.transportModes[index] ? this.data.transportModes[index].id : "transit";
    applyPreferencePatch(this, { transportMode: mode }, { transportModeIndex: index });
  },

  onMaxTravelDurationChange(e) {
    applyPreferencePatch(this, { maxTravelDuration: Number(e.detail.value) });
  },

  setPriceSensitivity(e) {
    applyPreferencePatch(this, { priceSensitivity: e.currentTarget.dataset.val });
  },

  onHomeCityInput(e) {
    applyPreferencePatch(this, { homeCity: String(e.detail.value || "").slice(0, 64) });
  },

  savePreferences() {
    const success = preferenceStore.savePreferences(this.data.preferences);
    if (success) haptics.light();
    wx.showToast({ title: success ? "偏好已保存" : "保存失败", icon: success ? "success" : "none" });
  },
};
