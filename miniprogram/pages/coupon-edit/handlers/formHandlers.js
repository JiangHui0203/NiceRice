const { dateAfter, formatDate } = require("../../../utils/dateUtils.js");
const haptics = require("../../../utils/haptics.js");
const {
  calculateDiscount,
  handleTypeChange,
  handlePlatformChange,
  handleReservationChange,
  handleRefundChange,
  handlePeopleChange,
  toggleFormTag,
  addCustomTagToForm,
  parseDishesList,
} = require("../couponEditHelper.js");

module.exports = {
  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const limits = {
      title: 120,
      venue: 120,
      price: 32,
      originalPrice: 32,
      lossAmount: 32,
      dishes: 1000,
      address: 500,
      travelTime: 80,
      usableTime: 160,
      storeLimit: 500,
      ruleNotes: 1000,
      note: 1000,
    };
    if (!Object.prototype.hasOwnProperty.call(limits, field)) return;
    let value = String(e.detail.value === undefined || e.detail.value === null ? "" : e.detail.value)
      .slice(0, limits[field]);
    if (field === "price" || field === "originalPrice" || field === "lossAmount") {
      value = value.replace(/[^\d.]/g, "");
      const parts = value.split(".");
      value = parts.length > 1
        ? `${parts.shift()}.${parts.join("").slice(0, 2)}`
        : parts[0];
    }
    const nextForm = Object.assign({}, this.data.form, { [field]: value });
    const discountInfo = (field === "price" || field === "originalPrice")
      ? calculateDiscount(nextForm.price, nextForm.originalPrice)
      : this.data.discountInfo;
    const parsedDishes = field === "dishes"
      ? parseDishesList(value)
      : this.data.parsedDishes;

    this.setData({
      [`form.${field}`]: value,
      discountInfo,
      parsedDishes,
    }, () => {
      if (field === "venue" || field === "address") {
        this.refreshLocationSummary(this.data.form);
      }
    });
  },

  appendDishPill(e) {
    const text = e.currentTarget.dataset.text;
    const current = (this.data.form.dishes || "").trim();
    const updated = (current ? `${current}、${text}` : text).slice(0, 1000);
    this.setData({
      "form.dishes": updated,
      parsedDishes: parseDishesList(updated),
    });
    haptics.light();
  },

  appendRulePill(e) {
    const text = e.currentTarget.dataset.text;
    const current = (this.data.form.ruleNotes || "").trim();
    if (current.includes(text)) return;
    const updated = (current ? `${current}；${text}` : text).slice(0, 1000);
    this.setData({ "form.ruleNotes": updated });
    haptics.light();
  },

  onTypeChange(e) {
    const res = handleTypeChange(Number(e.detail.value), this.data.typeOptions, this.data.selectedTags);
    this.setData(Object.assign({}, res, { "form.type": res.type }));
  },

  onPlatformChange(e) {
    const res = handlePlatformChange(Number(e.detail.value), this.data.platformOptions);
    this.setData({ platformIndex: res.platformIndex, "form.platform": res.platform });
  },

  onReservationChange(e) {
    const res = handleReservationChange(Number(e.detail.value));
    this.setData({
      reservationIndex: res.reservationIndex,
      "form.reservationRequired": res.reservationRequired,
      "form.reservationStatus": res.reservationStatus,
    });
  },

  onRefundChange(e) {
    const res = handleRefundChange(Number(e.detail.value));
    this.setData({ refundIndex: res.refundIndex, "form.refundType": res.refundType });
  },

  onExpireChange(e) {
    this.setData({ "form.expireDate": e.detail.value });
  },

  applyQuickDate(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const days = Number(dataset.days);
    if (Number.isFinite(days) && days > 0) {
      this.setData({ "form.expireDate": dateAfter(days) });
      return;
    }

    const now = new Date();
    let target = new Date(now);
    if (dataset.type === "end_of_month") {
      target = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (dataset.type === "end_of_next_month") {
      target = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    } else if (dataset.type === "end_of_year") {
      target = new Date(now.getFullYear(), 11, 31);
    } else {
      return;
    }
    this.setData({ "form.expireDate": formatDate(target) });
  },

  onPeopleChange(e) {
    const res = handlePeopleChange(Number(e.detail.value), this.data.peopleOptions);
    this.setData({ peopleIndex: res.peopleIndex, "form.people": res.people });
  },

  toggleTag(e) {
    const tag = e.currentTarget.dataset.tag || e.currentTarget.dataset.label;
    this.setData(toggleFormTag(tag, this.data.selectedTags));
  },

  onCustomTagInput(e) {
    this.setData({ customTag: String(e.detail.value || "").slice(0, 48) });
  },

  addCustomTag() {
    const res = addCustomTagToForm(this.data.customTag, this.data.selectedTags);
    if (!res) return;
    this.setData(Object.assign({}, res, { customTag: "" }));
  },
};
