const planStore = require("../../utils/planStore.js");
const couponStore = require("../../utils/couponStore.js");
const haptics = require("../../utils/haptics.js");
const privacyService = require("../../utils/privacyService.js");
const { normalizeExactId } = require("../../utils/idUtils.js");
const {
  WEEKDAYS,
  calculateHeatmapMatrix,
  getStoredVotes,
  parseInviteParams,
  ensureHeatmapEnrichment,
  loadInitialSelfAndFriends,
  normalizeSelfId,
  loadSelectedFriendIds,
  loadStoredScenes,
  saveSelectedFriendIds,
} = require("./heatmapHelper.js");
const {
  buildCandidateSlotPlan,
  buildCouponSlotPlan,
  buildSlotScheduleText,
} = require("./collaborationPlanHelper.js");
const {
  buildActiveCell,
  buildPlanSlotMap,
  buildSceneCouponCache,
  compactHeatmapRows,
  getRecommendedCoupons,
} = require("./heatmapViewHelper.js");
const candidateHandlers = require("./handlers/candidateHandlers.js");
const { parseSharedCandidatePayload } = require("./candidateHelper.js");
const inviteHandlers = require("./handlers/inviteHandlers.js");
const managementHandlers = require("./handlers/managementHandlers.js");
const touchDismissHandlers = require("./handlers/touchDismissHandlers.js");

function isPageActive(page) {
  return Boolean(page && !page.hidden && !page.unloaded);
}

const pageConfig = {
  data: {
    weekdays: WEEKDAYS,
    friends: [],
    selectedFriendIds: [],
    selectedFriendsCount: 0,
    heatmapRows: [],
    activeDayIdx: null,
    activeSceneIdx: null,
    activeCell: null,
    activeCellPlan: null,
    recommendedCoupons: [],
    scenes: [],
    currentPresetKey: "default",
    showSettingsDrawer: false,
    showFriendDrawer: false,
    newFriendName: "",
    newSlotDay: "周六",
    newSlotStart: "14:00",
    newSlotEnd: "17:30",
    selfName: "我",
    selfSlots: [],
    newCustomSceneName: "",
    newCustomSceneStart: "18:00",
    newCustomSceneEnd: "21:00",
    newCustomSceneIcon: "social",
    iconOptions: [
      { name: "breakfast", label: "早餐" }, { name: "lunch", label: "午餐" },
      { name: "tea", label: "下午茶" }, { name: "dinner", label: "晚餐" },
      { name: "game", label: "桌游/游戏" }, { name: "sports", label: "运动/健身" },
      { name: "study", label: "学习/阅读" }, { name: "social", label: "聚会/社交" },
    ],
    showInviteModal: false,
    showSlotDetailModal: false,
    inviteData: null,
    showInviteSuccessTip: false,
    inviteSuccessTip: "",
    weekdayOptions: WEEKDAYS,
    selfId: "",
    showBulkExportDrawer: false,
    exportableSlots: [],
    bulkExportOptions: { includeFriends: true },
    showCandidateDrawer: false,
    showInviteShareDrawer: false,
    heatmapCandidates: [],
    customCandidates: [],
    newCustomCandidateText: "",
    quickCandidateTags: ["聚餐饭局", "咖啡茶歇", "桌游轰趴", "户外运动"],
    selectedCandidateCount: 0,
    totalCandidateCount: 0,
    isSharedCandidateMode: false,
  },

  onLoad(options) {
    this.hidden = false;
    this.unloaded = false;
    let selfId = "";
    try {
      selfId = normalizeSelfId(privacyService.readLocalData("life_helper_self_id", ""));
      if (!selfId) {
        selfId = `self_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`;
        if (!privacyService.writeLocalData("life_helper_self_id", selfId)) {
          throw new Error("本地身份保存失败");
        }
      }
    } catch (error) {
      selfId = `self_session_${Date.now()}`;
      wx.showToast({ title: "本地身份保存失败，分享功能暂不可用", icon: "none" });
    }
    this.setData({ selfId });

    if (options && options.mode === "candidates") {
      this._pendingSharedCandidates = parseSharedCandidatePayload(options.candidates);
      this._pendingCandidateShareError = !this._pendingSharedCandidates;
    }

    if (options && options.invite) {
      const parsed = parseInviteParams(options.invite, selfId);
      if (parsed) {
        if (parsed.isSelf) {
          wx.showToast({ title: "这是您自己的分享卡片", icon: "none" });
          return;
        }
        this.setData({
          inviteData: parsed.inviteData,
          isInviteUpdate: parsed.isInviteUpdate,
          existingFriendId: parsed.existingFriendId,
          showInviteModal: true,
        });
      }
    }
  },

  onShow() {
    if (this.unloaded) return;
    this.hidden = false;
    this.loadData();
    if (this._pendingSharedCandidates) {
      const sharedCandidates = this._pendingSharedCandidates;
      this._pendingSharedCandidates = null;
      this.openSharedCandidateDrawer(sharedCandidates);
    } else if (this._pendingCandidateShareError) {
      this._pendingCandidateShareError = false;
      wx.showToast({ title: "候选分享内容无效或已过期", icon: "none" });
    }
  },

  clearLifecycleTimers() {
    if (this._animEndTimer) {
      clearTimeout(this._animEndTimer);
      this._animEndTimer = null;
    }
  },

  onHide() {
    this.hidden = true;
    this.clearLifecycleTimers();
    this.heatmapRowsFull = [];
    this.planSlotMap = null;
    this.sceneCouponCache = null;
    this.setData({
      friends: [],
      heatmapRows: [],
      activeDayIdx: null,
      activeSceneIdx: null,
      activeCell: null,
      activeCellPlan: null,
      recommendedCoupons: [],
      heatmapCandidates: [],
      customCandidates: [],
      exportableSlots: [],
      selectedCandidateCount: 0,
      totalCandidateCount: 0,
      showCandidateDrawer: false,
      showBulkExportDrawer: false,
      showInviteShareDrawer: false,
      showSettingsDrawer: false,
      showFriendDrawer: false,
      showSlotDetailModal: false,
      isModalAnimating: false,
    });
  },

  onUnload() {
    this.unloaded = true;
    this.hidden = true;
    this.clearLifecycleTimers();
    this.heatmapRowsFull = [];
    this.planSlotMap = null;
    this.sceneCouponCache = null;
  },

  loadData() {
    if (!isPageActive(this)) return;
    const { scenes, presetKey } = loadStoredScenes();
    ensureHeatmapEnrichment();

    let selfName = "我";
    try { selfName = privacyService.readLocalData("life_helper_self_name", "我") || "我"; } catch (error) {}
    const { selfSlots, combinedFriends } = loadInitialSelfAndFriends(selfName);

    const selectedIds = loadSelectedFriendIds(combinedFriends);

    const friends = combinedFriends.map((f) => ({
      id: f.id || f.name,
      name: f.name,
      slots: f.slots || [],
      isSelf: Boolean(f.isSelf),
      selected: selectedIds.includes(f.id || f.name),
    }));

    this.setData({
      scenes,
      currentPresetKey: presetKey,
      selfName,
      selfSlots,
      friends,
      selectedFriendIds: selectedIds,
    }, () => {
      if (isPageActive(this)) this.calculateHeatmap();
    });
  },

  calculateHeatmap() {
    if (!isPageActive(this)) return;
    const friends = Array.isArray(this.data.friends) ? this.data.friends : [];
    const scenes = Array.isArray(this.data.scenes) ? this.data.scenes : [];
    const activeFriends = friends.filter((f) => f.selected);
    const allVotes = getStoredVotes();

    // 预热时段计划与推荐卡券索引表 (实现 onCellTap O(1) 零延迟秒开)
    let plans = [];
    try {
      plans = planStore.getPlans() || [];
      this.planDataAvailable = true;
    } catch (err) {
      this.planDataAvailable = false;
      if (!this.hidden && !this.unloaded) {
        wx.showToast({ title: "计划读取失败，暂不能新增排期", icon: "none" });
      }
    }

    let allCoupons = [];
    try {
      allCoupons = couponStore.getAllCoupons() || [];
    } catch (error) {
      allCoupons = [];
      if (!this.hidden && !this.unloaded) {
        wx.showToast({ title: "优惠券读取失败，热力图仍可使用", icon: "none" });
      }
    }
    const planSlotMap = buildPlanSlotMap(plans, WEEKDAYS, scenes);
    const heatmapRows = calculateHeatmapMatrix(activeFriends, scenes, allVotes, planSlotMap);
    this.heatmapRowsFull = heatmapRows;
    this.planSlotMap = planSlotMap;
    this.sceneCouponCache = buildSceneCouponCache(allCoupons, scenes);

    this.setData({ heatmapRows: compactHeatmapRows(heatmapRows), selectedFriendsCount: activeFriends.length }, () => {
      if (!isPageActive(this)) return;
      if (this.data.activeDayIdx !== null && this.data.activeSceneIdx !== null) {
        this.updateActiveCell();
      }
    });
  },

  toggleFriend(e) {
    haptics.light();
    const rawId = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "";
    const id = normalizeExactId(rawId);
    if (!id || !(this.data.friends || []).some((friend) => friend && friend.id === id)) return;
    const friends = this.data.friends.map((f) => (f.id === id ? Object.assign({}, f, { selected: !f.selected }) : f));
    const selectedFriendIds = saveSelectedFriendIds(friends.filter((f) => f.selected).map((f) => f.id));
    if (!selectedFriendIds) {
      wx.showToast({ title: "好友选择保存失败，请重试", icon: "none" });
      return;
    }
    this.setData({ friends, selectedFriendIds }, this.calculateHeatmap);
  },

  onFriendTap(e) {
    this.toggleFriend(e);
  },

  toggleSelectAll() {
    haptics.light();
    const allSelected = this.data.friends.every((f) => f.selected);
    const targetState = !allSelected;
    const friends = this.data.friends.map((f) => Object.assign({}, f, { selected: targetState }));
    const selectedFriendIds = saveSelectedFriendIds(targetState ? friends.map((f) => f.id) : []);
    if (!selectedFriendIds) {
      wx.showToast({ title: "好友选择保存失败，请重试", icon: "none" });
      return;
    }
    this.setData({ friends, selectedFriendIds }, this.calculateHeatmap);
  },

  onCellTap(e) {
    haptics.light();
    const ds = e.currentTarget.dataset || {};
    const dayIdx = Number(ds.dayIdx !== undefined ? ds.dayIdx : ds.day);
    const sceneIdx = Number(ds.sceneIdx !== undefined ? ds.sceneIdx : ds.scene);

    if (!Number.isInteger(dayIdx) || !Number.isInteger(sceneIdx)
      || dayIdx < 0 || dayIdx >= WEEKDAYS.length
      || sceneIdx < 0 || sceneIdx >= (this.data.scenes || []).length) return;

    let windowWidth = 375;
    let windowHeight = 667;
    try {
      const win = (wx.getWindowInfo && typeof wx.getWindowInfo === "function")
        ? wx.getWindowInfo()
        : {};
      windowWidth = win.windowWidth || 375;
      windowHeight = win.windowHeight || 667;
    } catch (err) {}

    const centerX = windowWidth / 2;
    const centerY = windowHeight / 2;

    let touchX = centerX;
    let touchY = 220;

    if (e.detail && e.detail.x !== undefined && e.detail.y !== undefined) {
      touchX = e.detail.x;
      touchY = e.detail.y;
    } else if (e.touches && e.touches[0]) {
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
    } else {
      const dayPercent = (dayIdx + 0.5) / 7;
      touchX = 36 + dayPercent * (windowWidth - 72);
      touchY = 140 + sceneIdx * 55;
    }

    const deltaX = Math.round(touchX - centerX);
    const deltaY = Math.round(touchY - centerY);

    const activeCell = buildActiveCell({
      heatmapRows: this.heatmapRowsFull,
      scenes: this.data.scenes,
      weekdays: WEEKDAYS,
      dayIndex: dayIdx,
      sceneIndex: sceneIdx,
    });
    if (!activeCell) return;

    const slotKey = `${activeCell.day}_${activeCell.scene}`;
    const activeCellPlan = (this.planSlotMap && this.planSlotMap[slotKey]) || null;
    const recommendedCoupons = (this.sceneCouponCache && this.sceneCouponCache[activeCell.scene]) || [];

    if (this._animEndTimer) clearTimeout(this._animEndTimer);

    this.setData({
      activeDayIdx: dayIdx,
      activeSceneIdx: sceneIdx,
      modalDeltaX: deltaX,
      modalDeltaY: deltaY,
      activeCell,
      activeCellPlan,
      recommendedCoupons,
      showSlotDetailModal: true,
      isModalAnimating: true,
    });

    // Automatically recycle GPU hardware layer memory after 500ms
    this._animEndTimer = setTimeout(() => {
      this._animEndTimer = null;
      if (!this.hidden && !this.unloaded) this.setData({ isModalAnimating: false });
    }, 500);
  },

  closeSlotDetailModal() {
    haptics.light();
    if (this._animEndTimer) clearTimeout(this._animEndTimer);
    this.setData({
      showSlotDetailModal: false,
      isModalAnimating: false,
      activeDayIdx: null,
      activeSceneIdx: null,
      activeCell: null,
      activeCellPlan: null,
      recommendedCoupons: [],
    });
  },

  openCandidateDrawerFromModal() {
    this.setData({ showSlotDetailModal: false }, () => {
      if (isPageActive(this)) this.openCandidateDrawer();
    });
  },

  goToDetailPageFromModal() {
    this.setData({ showSlotDetailModal: false });
    this.goToDetailPage();
  },

  updateActiveCell() {
    if (!isPageActive(this)) return;
    const { activeDayIdx, activeSceneIdx, scenes } = this.data;
    if (activeDayIdx === null || activeSceneIdx === null) return;

    const activeCell = buildActiveCell({
      heatmapRows: this.heatmapRowsFull,
      scenes,
      weekdays: WEEKDAYS,
      dayIndex: activeDayIdx,
      sceneIndex: activeSceneIdx,
    });
    if (!activeCell) return;

    const slotKey = `${activeCell.day}_${activeCell.scene}`;
    const activeCellPlan = (this.planSlotMap && this.planSlotMap[slotKey]) || null;

    let recommendedCoupons = this.sceneCouponCache && this.sceneCouponCache[activeCell.scene]
      ? this.sceneCouponCache[activeCell.scene]
      : [];
    if (!recommendedCoupons.length && !this.sceneCouponCache) {
      try {
        recommendedCoupons = getRecommendedCoupons(couponStore.getAllCoupons() || [], activeCell.scene);
      } catch (error) {
        recommendedCoupons = [];
      }
    }

    this.setData({ activeCell, activeCellPlan, recommendedCoupons });
  },

  scheduleCouponToActiveSlot(e) {
    haptics.medium();
    if (this.planDataAvailable === false) {
      wx.showToast({ title: "计划读取失败，暂不能新增排期", icon: "none" });
      return;
    }
    const rawCouponId = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.id
      : "";
    const couponId = normalizeExactId(rawCouponId);
    const visibleCoupon = couponId
      ? (this.data.recommendedCoupons || []).find((item) => item && item.id === couponId)
      : null;
    let coupon = null;
    if (visibleCoupon) {
      try {
        coupon = couponStore.findCoupon(couponId);
      } catch (error) {}
    }
    if (!coupon) {
      wx.showToast({ title: "未找到该券", icon: "none" });
      return;
    }

    const { activeCell, friends, selectedFriendIds } = this.data;
    if (!activeCell) {
      wx.showToast({ title: "请先点击选中热力图方格", icon: "none" });
      return;
    }
    if (this.data.activeCellPlan || (this.planSlotMap && this.planSlotMap[`${activeCell.day}_${activeCell.scene}`])) {
      wx.showToast({ title: "该时段已有计划，请先处理原计划", icon: "none" });
      return;
    }
    const plan = buildCouponSlotPlan({ coupon, activeCell, friends, selectedFriendIds });
    if (!plan) {
      wx.showToast({ title: "优惠券或时段信息不完整", icon: "none" });
      return;
    }

    const savedPlan = planStore.upsertStoredPlan(plan);
    if (!savedPlan) {
      wx.showToast({ title: "日程保存失败，请重试", icon: "none" });
      return;
    }

    wx.showToast({ title: `已安排至【${activeCell.day} ${activeCell.scene}】`, icon: "success" });
    this.calculateHeatmap();
  },

  addSelectedCandidateToPlan() {
    haptics.medium();
    if (this.planDataAvailable === false) {
      wx.showToast({ title: "计划读取失败，暂不能新增排期", icon: "none" });
      return;
    }
    const selectedCoupons = this.data.heatmapCandidates.filter((c) => c.selected);
    const selectedCustomItems = this.data.customCandidates.filter((c) => c.selected);
    const selectedCount = selectedCoupons.length + selectedCustomItems.length;
    const selectedCoupon = selectedCoupons[0];
    const selectedCustom = selectedCustomItems[0];

    if (!selectedCount) {
      wx.showToast({ title: "请先勾选一个候选方案", icon: "none" });
      return;
    }
    if (selectedCount > 1) {
      wx.showToast({ title: "安排计划时请只勾选一个候选", icon: "none" });
      return;
    }

    const result = buildCandidateSlotPlan({
      selectedCoupon,
      selectedCustom,
      activeCell: this.data.activeCell,
      heatmapRows: this.heatmapRowsFull,
      friends: this.data.friends,
      selectedFriendIds: this.data.selectedFriendIds,
    });
    if (!result || result.error || !result.plan) {
      wx.showToast({ title: (result && result.error) || "候选方案无法排期", icon: "none" });
      return;
    }

    if (this.planSlotMap && this.planSlotMap[`${result.day}_${result.scene}`]) {
      wx.showToast({ title: "目标时段已有计划，请先处理原计划", icon: "none" });
      return;
    }

    const savedPlan = planStore.upsertStoredPlan(result.plan);
    if (!savedPlan) {
      wx.showToast({ title: "协同日程保存失败，请重试", icon: "none" });
      return;
    }

    // 计划已持久化后立即刷新占用索引，不能依赖弹窗 success 回调；
    // 系统弹窗若打开失败，旧索引会允许用户再次写入同一时段。
    this.closeCandidateDrawer();
    this.calculateHeatmap();

    wx.showModal({
      title: "🎉 协同安排成功！",
      content: `已将「${result.title}」排定在【${result.day} ${result.scene}】日程中，好友参与状态等待确认。`,
      showCancel: false,
      fail: () => {
        if (!this.hidden && !this.unloaded) {
          wx.showToast({ title: "计划已保存，可在计划页查看", icon: "none" });
        }
      },
    });
  },

  printAndCopySlotSchedule() {
    const text = buildSlotScheduleText(this.data);
    if (!text) return;

    wx.setClipboardData({
      data: text,
      success: () => {
        if (!this.hidden && !this.unloaded) {
          wx.showToast({ title: "活动安排单已复制", icon: "success" });
        }
      },
      fail: () => {
        if (!this.hidden && !this.unloaded) wx.showToast({ title: "活动安排单复制失败", icon: "none" });
      },
    });
  },

  goToDetailPage() {
    const activeCell = this.data.activeCell;
    if (!activeCell) return;
    wx.navigateTo({
      url: `/pages/friend-heatmap-detail/index?day=${encodeURIComponent(activeCell.day)}&scene=${encodeURIComponent(activeCell.scene)}`,
      fail: () => {
        if (!this.hidden && !this.unloaded) wx.showToast({ title: "详情页打开失败，请重试", icon: "none" });
      },
    });
  },

  stopPropagation() {},

};

Object.assign(
  pageConfig,
  managementHandlers,
  inviteHandlers,
  touchDismissHandlers,
  candidateHandlers
);

Page(pageConfig);
