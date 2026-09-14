const TouchDismissHelper = require("../../utils/touchDismissHelper.js");
const friendStore = require("../../utils/friendStore.js");
const couponStore = require("../../utils/couponStore.js");
const planStore = require("../../utils/planStore.js");
const haptics = require("../../utils/haptics.js");
const privacyService = require("../../utils/privacyService.js");
const { normalizeExactId } = require("../../utils/idUtils.js");
const { findPlanForSlot } = require("../friend-heatmap/heatmapViewHelper.js");

const MAX_PLAN_NOTE_LENGTH = 300;
const MAX_VOTE_OPTION_NAME_LENGTH = 40;
const MAX_VISIBLE_VOTER_NAMES = 12;

function limitText(value, maxLength) {
  return String(value === undefined || value === null ? "" : value).slice(0, maxLength);
}

function resolveRecommendedCoupon(page, rawId) {
  const id = normalizeExactId(rawId);
  if (!id) return null;
  return (page.data.recommendedCoupons || []).find((coupon) => coupon && coupon.id === id) || null;
}

const {
  PRESET_SCENES,
  SELF_PARTICIPANT_ID,
  timeRangesOverlap,
  getLocalDateForWeekday,
  getStoredVotes,
  initDefaultVotes,
  loadSelectedFriendIds,
  addVoteOption,
  toggleVoteOption,
  deleteVoteOption,
  clearVotes,
  loadStoredScenes,
  ensureSelfParticipant,
  resolvePlanStatus,
} = require("../friend-heatmap/heatmapHelper.js");

Page({
  data: {
    day: "",
    scene: "",
    timeRange: "",
    targetDate: "",
    friendStatus: [],
    availableFriendsCount: 0,
    totalVotersCount: 0,
    selectedFriendsCount: 0,
    activeSlotVotes: null,
    newVoteOptionName: "",
    winningActivity: "",
    recommendedCoupons: [],
    showExportDrawer: false,
    exportDragY: 0,
    selectedCoupon: null,
    planNote: "",
    exportChecks: {
      includeTime: true,
      includeActivity: true,
      includeFriends: true,
      includeCoupon: true,
      includeDishes: true,
      includeNote: true,
    },
    mealNotePills: ["不吃辣", "鸳鸯锅", "靠窗位", "提前预约", "AA制", "不喝酒", "要发票", "儿童椅"],
  },

  onLoad(options) {
    this.hidden = false;
    this.unloaded = false;
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const routeOptions = options && typeof options === "object" ? options : {};
    const hasDay = Object.prototype.hasOwnProperty.call(routeOptions, "day");
    const hasScene = Object.prototype.hasOwnProperty.call(routeOptions, "scene");
    const requestedDay = hasDay && typeof routeOptions.day === "string" ? routeOptions.day : "";
    const day = !hasDay
      ? weekdays[new Date().getDay()]
      : requestedDay;
    const scene = hasScene ? normalizeExactId(routeOptions.scene, 24) : "";
    this._routeSceneProvided = hasScene;
    this._invalidRouteOptions = (hasDay && !weekdays.includes(requestedDay)) || (hasScene && !scene);
    this.setData({ day, scene, targetDate: getLocalDateForWeekday(day) });
  },

  onShow() {
    if (this.unloaded) return;
    this.hidden = false;
    this.loadDetails();
  },

  onHide() {
    this.hidden = true;
  },

  onUnload() {
    this.unloaded = true;
    this.hidden = true;
  },

  onPlanNoteInput(e) {
    this.setData({ planNote: limitText(e && e.detail && e.detail.value, MAX_PLAN_NOTE_LENGTH) });
  },

  appendMealPill(e) {
    const pill = limitText(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.text, 24);
    if (!pill) return;
    const current = limitText(this.data.planNote, MAX_PLAN_NOTE_LENGTH);
    const sep = current && !current.endsWith("\n") && !current.endsWith("，") ? "，" : "";
    const appendedNote = current + sep + pill;
    const planNote = limitText(appendedNote, MAX_PLAN_NOTE_LENGTH);
    this.setData({ planNote });
    if (appendedNote.length > MAX_PLAN_NOTE_LENGTH) {
      wx.showToast({ title: `备忘最多 ${MAX_PLAN_NOTE_LENGTH} 字`, icon: "none" });
    }
  },

  loadDetails() {
    if (this.hidden || this.unloaded) return;
    if (this._invalidRouteOptions) {
      wx.showToast({ title: "热力图时段参数无效", icon: "none" });
      return;
    }
    const { day } = this.data;
    const storedSceneState = loadStoredScenes();
    const scenes = Array.isArray(storedSceneState.scenes) && storedSceneState.scenes.length
      ? storedSceneState.scenes
      : PRESET_SCENES.default;
    const sceneObj = this._routeSceneProvided
      ? scenes.find((s) => s.name === this.data.scene)
      : scenes[0];
    if (!sceneObj) {
      wx.showToast({ title: "可用时段读取失败", icon: "none" });
      return;
    }
    const scene = sceneObj.name;
    const targetDate = getLocalDateForWeekday(day, sceneObj.end, sceneObj.start);
    this.setData({ scene, timeRange: sceneObj.timeRange, targetDate });

    let selfName = "我";
    let rawSelfSlots = [];
    try {
      selfName = String(privacyService.readLocalData("life_helper_self_name", "我") || "我");
      rawSelfSlots = privacyService.readLocalData("life_helper_self_slots", []);
    } catch (error) {}
    const selfSlots = Array.isArray(rawSelfSlots)
      ? [...new Set(rawSelfSlots.slice(0, 64)
        .map(friendStore.normalizeAvailabilitySlot)
        .filter(Boolean))].slice(0, 64)
      : [];
    const rawFriends = (friendStore.readFriends() || []).filter((f) => f.name !== selfName && f.name !== "我");
    let myDisplayName = (selfName && selfName !== "我" && selfName !== "我 (我)") ? `${selfName} (我)` : "我";
    const combinedFriends = [{ id: SELF_PARTICIPANT_ID, name: myDisplayName, slots: selfSlots, isSelf: true }, ...rawFriends];
    const selectedFriendIds = loadSelectedFriendIds(combinedFriends);

    let availableCount = 0;
    const friendStatus = combinedFriends.map((friend) => {
      const isSelected = selectedFriendIds.includes(friend.id || friend.name);
      let isAvailable = false;
      let slotDetail = "";

      if (friend.slots && friend.slots.length > 0) {
        isAvailable = friend.slots.some((item) => {
          if (!item.includes(day)) return false;
          const otherScenes = scenes.filter((s) => s.name !== scene);
          if (otherScenes.some((s) => item.includes(s.name)) && !item.includes(scene)) return false;

          const matchedRange = item.match(/(\d{1,2}:\d{2})\s*[-至到]\s*(\d{1,2}:\d{2})/);
          if (matchedRange) {
            if (timeRangesOverlap(matchedRange[1], matchedRange[2], sceneObj.start, sceneObj.end)) {
              slotDetail = item;
              return true;
            }
            return false;
          }

          const matchedAfter = item.match(/(\d{1,2}:\d{2})\s*(?:后|以后)/);
          if (matchedAfter) {
            if (timeRangesOverlap(matchedAfter[1], "23:59", sceneObj.start, sceneObj.end)) {
              slotDetail = item;
              return true;
            }
            return false;
          }

          slotDetail = item;
          return true;
        });
      }

      if (isAvailable && isSelected) availableCount++;
      return { id: friend.id || friend.name, name: friend.name, isSelf: Boolean(friend.isSelf), isAvailable, isSelected, slotDetail };
    });

    const activeSelectedFriends = friendStatus.filter((f) => f.isSelected);
    const voteKey = `${day}_${scene}`;
    const allVotes = getStoredVotes();
    let activeSlotVotes = allVotes[voteKey] || null;
    let winningActivity = "";

    if (activeSlotVotes && Array.isArray(activeSlotVotes.options)) {
      activeSlotVotes = {
        options: activeSlotVotes.options.map((opt) => {
          const votes = Array.isArray(opt && opt.votes) ? opt.votes : [];
          const voterNames = votes.map((voterId) => {
            const found = friendStatus.find((f) => f.id === voterId);
            return found ? found.name : "未知";
          });
          return Object.assign({}, opt, {
            votes,
            voterNames,
            voterNamesStr: voterNames.length > MAX_VISIBLE_VOTER_NAMES
              ? `${voterNames.slice(0, MAX_VISIBLE_VOTER_NAMES).join("、")} 等${voterNames.length}人`
              : voterNames.join("、"),
            hasVoted: votes.includes(SELF_PARTICIPANT_ID),
          });
        })
      };

      let maxVotes = 0;
      activeSlotVotes.options.forEach((opt) => {
        if (opt.votes.length > maxVotes) {
          maxVotes = opt.votes.length;
          winningActivity = opt.name;
        }
      });
    }

    let allCoupons = [];
    try {
      allCoupons = couponStore.getAllCoupons() || [];
    } catch (error) {
      if (!this.hidden && !this.unloaded) {
        wx.showToast({ title: "优惠券读取失败，其他协同功能仍可使用", icon: "none" });
      }
    }
    const recommendedCoupons = allCoupons.filter((coupon) => {
      if (["draft", "planned", "used", "expired"].includes(coupon.statusCode)) return false;
      const type = coupon.type || "其他";
      return scene === "下午茶" ? (type === "咖啡甜品" || coupon.category === "play") : type !== "咖啡甜品";
    }).sort((a, b) => {
      const aUrgent = a.stateClass === "urgent" ? 0 : a.stateClass === "priority" ? 1 : 2;
      const bUrgent = b.stateClass === "urgent" ? 0 : b.stateClass === "priority" ? 1 : 2;
      return aUrgent !== bUrgent ? aUrgent - bUrgent : (Number(b.recommendationScore) || 0) - (Number(a.recommendationScore) || 0);
    }).slice(0, 12);

    this.setData({
      friendStatus,
      availableFriendsCount: availableCount,
      totalVotersCount: activeSelectedFriends.length,
      selectedFriendsCount: activeSelectedFriends.length,
      activeSlotVotes,
      winningActivity,
      recommendedCoupons,
    });
  },

  initVoteForActiveSlot() {
    if (!initDefaultVotes(this.data.day, this.data.scene)) {
      wx.showToast({ title: "投票保存失败，请重试", icon: "none" });
      return;
    }
    this.loadDetails();
    wx.showToast({ title: "投票已发起", icon: "success" });
  },

  onVoteInput(e) {
    this.setData({
      newVoteOptionName: limitText(e && e.detail && e.detail.value, MAX_VOTE_OPTION_NAME_LENGTH),
    });
  },

  addVoteOption() {
    const name = String(this.data.newVoteOptionName || "").trim();
    if (!name) {
      wx.showToast({ title: "请输入选项名称", icon: "none" });
      return;
    }
    const res = addVoteOption(this.data.day, this.data.scene, name);
    if (!res.success) {
      const message = res.reason === "storage"
        ? "选项保存失败，请重试"
        : (res.reason === "limit"
          ? "每个时段最多 20 个投票选项"
          : (res.reason === "slot_limit" ? "可发起投票的时段已达上限" : "该选项已存在"));
      wx.showToast({ title: message, icon: "none" });
      return;
    }
    this.setData({ newVoteOptionName: "" });
    this.loadDetails();
    wx.showToast({ title: "添加成功", icon: "success" });
  },

  toggleVoteOption(e) {
    haptics.light();
    if (!toggleVoteOption(this.data.day, this.data.scene, e.currentTarget.dataset.optId, SELF_PARTICIPANT_ID)) {
      wx.showToast({ title: "投票保存失败，请重试", icon: "none" });
      return;
    }
    this.loadDetails();
  },

  deleteVoteOption(e) {
    if (!deleteVoteOption(this.data.day, this.data.scene, e.currentTarget.dataset.optId)) {
      wx.showToast({ title: "选项删除失败，请重试", icon: "none" });
      return;
    }
    this.loadDetails();
    wx.showToast({ title: "选项已删除", icon: "none" });
  },

  clearVotes() {
    const { day, scene } = this.data;
    wx.showModal({
      title: "确认清空",
      content: `确定清空 ${day}·${scene} 的活动投票吗？`,
      success: (res) => {
        if (this.hidden || this.unloaded) return;
        if (res.confirm) {
          if (!clearVotes(day, scene)) {
            wx.showToast({ title: "投票清空失败，请重试", icon: "none" });
            return;
          }
          this.loadDetails();
          wx.showToast({ title: "已清空投票", icon: "none" });
        }
      }
    });
  },

  openExportDrawer() {
    this.setData({ showExportDrawer: true, selectedCoupon: null, planNote: "" });
  },

  openExportDrawerWithCoupon(e) {
    const coupon = resolveRecommendedCoupon(
      this,
      e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : "",
    );
    if (!coupon) return;
    this.setData({ showExportDrawer: true, selectedCoupon: coupon, planNote: "" });
  },

  closeExportDrawer() {
    this.setData({ showExportDrawer: false });
  },

  toggleExportCheck(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.key
      : "";
    if (!Object.prototype.hasOwnProperty.call(this.data.exportChecks || {}, key)) return;
    this.setData({
      exportChecks: Object.assign({}, this.data.exportChecks, { [key]: !this.data.exportChecks[key] }),
    });
  },

  goCouponDetail(e) {
    const coupon = resolveRecommendedCoupon(
      this,
      e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : "",
    );
    if (!coupon) return;
    wx.navigateTo({
      url: `/pages/coupon-detail/index?id=${encodeURIComponent(coupon.id)}`,
      fail: () => {
        if (!this.hidden && !this.unloaded) wx.showToast({ title: "优惠券详情打开失败", icon: "none" });
      },
    });
  },

  copyInviteText() {
    const { day, timeRange, targetDate, winningActivity, friendStatus, selectedCoupon, planNote, exportChecks } = this.data;
    const safePlanNote = limitText(planNote, MAX_PLAN_NOTE_LENGTH);
    let text = `📅 【有时好饭】聚餐出行安排单\n--------------------------------\n`;
    if (exportChecks.includeTime) text += `🕒 时间：${targetDate} (${day}) ${timeRange}\n`;
    if (exportChecks.includeActivity) text += `🎈 活动：${winningActivity || (selectedCoupon ? selectedCoupon.title : "暂定聚会")}\n`;
    if (exportChecks.includeFriends) {
      const freeNames = friendStatus.filter((f) => f.isAvailable && f.isSelected).map((f) => f.name);
      if (freeNames.length) text += `👥 出席好友：${freeNames.join("、")}\n`;
    }
    if (exportChecks.includeCoupon && selectedCoupon) {
      const price = selectedCoupon.price !== "" && selectedCoupon.price !== null && selectedCoupon.price !== undefined
        ? selectedCoupon.price
        : "未标";
      text += `🎫 优惠卡券：${selectedCoupon.title} (实付¥${price} · 店铺: ${selectedCoupon.venue || selectedCoupon.merchantName || "待补充"})\n`;
    }
    if (exportChecks.includeDishes && selectedCoupon && selectedCoupon.dishes) {
      text += `🍽️ 套餐菜品：${selectedCoupon.dishes.replace(/\n+/g, ' · ')}\n`;
    }
    if (exportChecks.includeNote && safePlanNote) {
      text += `📝 聚餐备忘：${safePlanNote}\n`;
    }
    text += `--------------------------------\n点击进入小程序“有时好饭”，共同开启精彩聚会！`;

    wx.setClipboardData({
      data: text,
      success: () => {
        if (this.hidden || this.unloaded) return;
        wx.showToast({ title: "群邀请文案已复制", icon: "success" });
        this.closeExportDrawer();
      },
      fail: () => {
        if (!this.hidden && !this.unloaded) wx.showToast({ title: "群邀请文案复制失败", icon: "none" });
      },
    });
  },

  saveToMyPlans() {
    if (this.planSaving) return;
    if (this.savedPlanId) {
      wx.showToast({ title: "该计划已经保存，可在计划页查看", icon: "none" });
      return;
    }
    const { day, scene, timeRange, targetDate, winningActivity, friendStatus, selectedCoupon, planNote, exportChecks } = this.data;
    const safePlanNote = limitText(planNote, MAX_PLAN_NOTE_LENGTH);
    let existingPlan = null;
    try {
      existingPlan = exportChecks.includeTime
        ? findPlanForSlot(planStore.getPlans() || [], day, scene)
        : null;
    } catch (error) {
      wx.showToast({ title: "现有计划读取失败，请重试", icon: "none" });
      return;
    }
    if (existingPlan) {
      wx.showToast({ title: "该时段已有计划，请先处理原计划", icon: "none" });
      return;
    }
    this.planSaving = true;
    const title = winningActivity || (selectedCoupon ? selectedCoupon.title : `${day}${scene}聚会`);
    const freeFriends = friendStatus.filter((f) => f.isAvailable && f.isSelected);
    const participants = ensureSelfParticipant(freeFriends.map((f) => ({
      id: f.id,
      name: f.name,
      isSelf: f.isSelf,
      status: f.isSelf ? "confirmed" : "pending",
    })));

    const [startHour = "", endHour = ""] = timeRange.split("-").map((t) => t.trim());
    const finalStatusCode = exportChecks.includeTime
      ? resolvePlanStatus(participants, exportChecks.includeFriends)
      : "draft";
    const couponScore = selectedCoupon
      && selectedCoupon.recommendationScore !== ""
      && selectedCoupon.recommendationScore !== null
      && selectedCoupon.recommendationScore !== undefined
      ? Number(selectedCoupon.recommendationScore)
      : NaN;

    const noteSegments = [];
    if (exportChecks.includeNote && safePlanNote) noteSegments.push(`📝 聚餐备忘：${safePlanNote}`);
    if (exportChecks.includeDishes && selectedCoupon && selectedCoupon.dishes) noteSegments.push(`🍽️ 套餐菜品：${selectedCoupon.dishes}`);
    noteSegments.push(`由热力图 ${day}·${scene} 投票方案「${title}」一键生成。`);

    const plan = {
      id: `p_heatmap_${Date.now()}`,
      couponId: (exportChecks.includeCoupon && selectedCoupon) ? selectedCoupon.id : "",
      title: exportChecks.includeActivity ? title : `${day}${scene}聚会`,
      category: selectedCoupon ? selectedCoupon.category : "play",
      statusCode: finalStatusCode,
      selectedTime: {
        date: exportChecks.includeTime ? targetDate : "",
        startTime: exportChecks.includeTime ? startHour : "",
        endTime: exportChecks.includeTime ? endHour : "",
        scene: exportChecks.includeTime ? scene : "",
        label: exportChecks.includeTime ? `${day} ${scene}` : "时间待定",
      },
      location: selectedCoupon ? {
        name: selectedCoupon.venue || selectedCoupon.merchantName || "待定",
        address: selectedCoupon.address || "",
        latitude: selectedCoupon.latitude !== undefined ? selectedCoupon.latitude : selectedCoupon.location && selectedCoupon.location.latitude,
        longitude: selectedCoupon.longitude !== undefined ? selectedCoupon.longitude : selectedCoupon.location && selectedCoupon.location.longitude,
        distanceText: /\d/.test(String(selectedCoupon.travelTime || "")) ? selectedCoupon.travelTime : "待估算",
      } : {
        name: "待定",
        address: "",
        distanceText: "待估算",
      },
      participants: exportChecks.includeFriends ? participants : [{ id: "self", name: "我", status: "confirmed" }],
      recommendationSnapshot: {
        score: Number.isFinite(couponScore) ? couponScore : null,
        level: selectedCoupon ? "coupon_match" : "collaboration",
        reasons: ["根据热力图中选择的时段生成"],
        warnings: [],
        scoreBreakdown: {},
      },
      reminders: exportChecks.includeFriends ? ["可将计划分享给好友确认"] : [],
      dishes: (exportChecks.includeDishes && selectedCoupon) ? selectedCoupon.dishes : "",
      note: noteSegments.join("\n"),
    };

    let savedPlan = null;
    try {
      savedPlan = planStore.upsertStoredPlan(plan);
    } catch (error) {}
    if (!savedPlan) {
      this.planSaving = false;
      wx.showToast({ title: "计划保存失败，请重试", icon: "none" });
      return;
    }
    this.savedPlanId = savedPlan.id;
    this.planSaving = false;

    wx.showModal({
      title: "生成成功",
      content: "计划已成功写入您的日程安排表中，可在主页或计划页面查看！",
      showCancel: false,
      success: () => {
        if (this.hidden || this.unloaded) return;
        this.closeExportDrawer();
        wx.navigateBack();
      },
      fail: () => {
        if (!this.hidden && !this.unloaded) wx.showToast({ title: "计划已保存，可在计划页查看", icon: "none" });
      },
    });
  },

  onExportTouchStart(e) {
    if (!this.exportTouchHelper) this.exportTouchHelper = new TouchDismissHelper({ thresholdY: 70 });
    const result = this.exportTouchHelper.onTouchStart(e);
    if (result) this.setData({ exportDragY: result.dragOffsetY });
  },

  onExportTouchMove(e) {
    if (!this.exportTouchHelper) return;
    const result = this.exportTouchHelper.onTouchMove(e);
    if (result) this.setData({ exportDragY: result.dragOffsetY });
  },

  onExportTouchEnd(e) {
    if (!this.exportTouchHelper) return;
    this.exportTouchHelper.onTouchEnd(e, () => this.closeExportDrawer());
    this.setData({ exportDragY: 0 });
  },

  stopPropagation() {},
});
