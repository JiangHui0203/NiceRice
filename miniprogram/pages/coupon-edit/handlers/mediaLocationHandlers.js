const ocrService = require("../../../utils/services/ocrService.js");
const screenshotService = require("../../../utils/services/screenshotService.js");
const locationService = require("../../../utils/services/locationService.js");
const { hasCoordinates } = require("../../../utils/locationUtils.js");
const {
  chooseCouponLocation,
  estimateCouponRoute,
  applyParsedOcrResult,
  handleAddScreenshot,
  handleRemoveScreenshot,
  resolveScreenshotPreviews,
  parseDishesList,
} = require("../couponEditHelper.js");

function nextPreviewRequest(page) {
  page.screenshotPreviewRequestId = (page.screenshotPreviewRequestId || 0) + 1;
  return page.screenshotPreviewRequestId;
}

function canApplyAsyncResult(page, requestId) {
  return !page.hidden && !page.unloaded && requestId === page.screenshotPreviewRequestId;
}

function releasePagePreviews(page) {
  const screenshots = page.data && page.data.form && page.data.form.screenshots || [];
  return screenshotService.releaseScreenshotPreviews(screenshots, page.screenshotPreviewOwner).catch(() => false);
}

module.exports = {
  addScreenshot() {
    if (this.screenshotMutationPending) return Promise.resolve(this.data.form.screenshots || []);
    const mutationId = (this.screenshotMutationId || 0) + 1;
    this.screenshotMutationId = mutationId;
    this.screenshotMutationPending = true;
    const beforeIds = new Set((this.data.form.screenshots || []).map((item) => item && item.id).filter(Boolean));
    this.setData({ screenshotUploading: true });
    return handleAddScreenshot(this.data.form.screenshots, 6).then((screenshots) => {
      if (this.hidden || this.unloaded || mutationId !== this.screenshotMutationId) {
        const added = (screenshots || []).filter((item) => item && !beforeIds.has(item.id));
        return Promise.all(added.map((item) => screenshotService.deleteScreenshot(item))).then(() => this.data.form.screenshots || []);
      }
      (screenshots || []).forEach((item) => {
        if (item && item.id && !beforeIds.has(item.id)) this.sessionAddedScreenshots[item.id] = item;
      });
      this.setData({ "form.screenshots": screenshots, screenshotUploading: false }, () => {
        this.refreshScreenshotPreviews();
      });
      wx.showToast({ title: "已添加截图", icon: "success" });
      return screenshots;
    }).catch(() => {
      if (!this.hidden && !this.unloaded && mutationId === this.screenshotMutationId) this.setData({ screenshotUploading: false });
      return this.data.form.screenshots || [];
    }).then((result) => {
      if (mutationId === this.screenshotMutationId) this.screenshotMutationPending = false;
      return result;
    });
  },

  removeScreenshot(e) {
    const index = Number(e.currentTarget.dataset.index);
    const removed = (this.data.form.screenshots || [])[index];
    this.screenshotMutationId = (this.screenshotMutationId || 0) + 1;
    // Cancelling the current attachment mutation must release the UI lock.
    // Any late upload result sees the generation mismatch and deletes itself.
    this.screenshotMutationPending = false;
    nextPreviewRequest(this);
    const screenshots = handleRemoveScreenshot(this.data.form.screenshots, index);
    if (removed && removed.id && this.sessionAddedScreenshots[removed.id]) {
      delete this.sessionAddedScreenshots[removed.id];
      screenshotService.deleteScreenshot(removed).catch(() => false);
    } else if (removed && removed.id && this.originalScreenshotIds.has(removed.id)) {
      this.pendingDeletedScreenshots[removed.id] = removed;
    } else if (removed) {
      screenshotService.deleteScreenshot(removed).catch(() => false);
    }
    this.setData({ "form.screenshots": screenshots, screenshotUploading: false }, () => {
      this.refreshScreenshotPreviews();
    });
  },

  previewScreenshot(e) {
    const index = Number(e.currentTarget.dataset.index) || 0;
    const requestId = (this.screenshotDirectPreviewRequestId || 0) + 1;
    this.screenshotDirectPreviewRequestId = requestId;
    return Promise.resolve(screenshotService.previewScreenshots(
      this.data.form.screenshots,
      index,
      { isActive: () => !this.hidden
        && !this.unloaded
        && requestId === this.screenshotDirectPreviewRequestId },
    )).catch(() => false);
  },

  refreshScreenshotPreviews() {
    const requestId = nextPreviewRequest(this);
    const source = (this.data.form.screenshots || []).slice();
    return resolveScreenshotPreviews(source).then((resolved) => {
      if (!canApplyAsyncResult(this, requestId)) {
        return this.data.form.screenshots || [];
      }
      screenshotService.retainScreenshotPreviews(resolved, this.screenshotPreviewOwner);
      this.setData({ "form.screenshots": resolved });
      return resolved;
    }).catch(() => this.data.form.screenshots || []);
  },

  onShow() {
    if (this.unloaded) return;
    this.hidden = false;
    const resetPatch = {};
    if (this.data.ocrRecognizing) resetPatch.ocrRecognizing = false;
    if (this.data.screenshotUploading) resetPatch.screenshotUploading = false;
    if (this.data.routeEstimating) resetPatch.routeEstimating = false;
    if (Object.keys(resetPatch).length) this.setData(resetPatch);
    if (this.missingCoupon && typeof this.scheduleMissingCouponReturn === "function") {
      this.scheduleMissingCouponReturn();
    }
    if (this.data && this.data.form && (this.data.form.screenshots || []).some((item) => item && item.encrypted)) {
      this.refreshScreenshotPreviews();
    }
  },

  onHide() {
    this.hidden = true;
    if (this.missingCouponTimer !== null && this.missingCouponTimer !== undefined) {
      clearTimeout(this.missingCouponTimer);
      this.missingCouponTimer = null;
    }
    this.screenshotMutationId = (this.screenshotMutationId || 0) + 1;
    this.screenshotMutationPending = false;
    this.ocrRequestId = (this.ocrRequestId || 0) + 1;
    this.locationRequestId = (this.locationRequestId || 0) + 1;
    this.routeRequestId = (this.routeRequestId || 0) + 1;
    this.clipboardRequestId = (this.clipboardRequestId || 0) + 1;
    this.screenshotDirectPreviewRequestId = (this.screenshotDirectPreviewRequestId || 0) + 1;
    nextPreviewRequest(this);
    return releasePagePreviews(this);
  },

  onUnload() {
    this.unloaded = true;
    this.hidden = true;
    if (this.missingCouponTimer !== null && this.missingCouponTimer !== undefined) {
      clearTimeout(this.missingCouponTimer);
      this.missingCouponTimer = null;
    }
    this.screenshotMutationId = (this.screenshotMutationId || 0) + 1;
    this.screenshotMutationPending = false;
    this.ocrRequestId = (this.ocrRequestId || 0) + 1;
    this.locationRequestId = (this.locationRequestId || 0) + 1;
    this.routeRequestId = (this.routeRequestId || 0) + 1;
    this.clipboardRequestId = (this.clipboardRequestId || 0) + 1;
    this.screenshotDirectPreviewRequestId = (this.screenshotDirectPreviewRequestId || 0) + 1;
    nextPreviewRequest(this);
    const abandonedFiles = Object.keys(this.sessionAddedScreenshots || {})
      .map((id) => this.sessionAddedScreenshots[id]);
    this.sessionAddedScreenshots = Object.create(null);
    const cleanup = Promise.all(abandonedFiles.map((item) => screenshotService.deleteScreenshot(item).catch(() => false)));
    return Promise.all([releasePagePreviews(this), cleanup]);
  },

  commitScreenshotEdits() {
    const pendingDeletes = Object.keys(this.pendingDeletedScreenshots || {})
      .map((id) => this.pendingDeletedScreenshots[id]);
    const currentScreenshots = this.data && this.data.form && this.data.form.screenshots || [];
    this.originalScreenshotIds = new Set(currentScreenshots.map((item) => item && item.id).filter(Boolean));
    this.couponSaveCommitted = true;
    this.pendingDeletedScreenshots = Object.create(null);
    this.sessionAddedScreenshots = Object.create(null);
    pendingDeletes.forEach((item) => screenshotService.deleteScreenshot(item).catch(() => false));
  },

  refreshLocationSummary(form = {}) {
    if (this.hidden || this.unloaded) return false;
    const coordinatesSaved = hasCoordinates(form);
    const name = form.locationName || form.venue;
    const address = form.locationAddress || form.address;
    let locationSummary = "还没有选择位置";
    let locationBadge = "待选择";
    if (name || address) {
      locationSummary = [name, address].filter(Boolean).join(" · ");
      locationBadge = coordinatesSaved
        ? (form.locationSource === "wx.chooseLocation" ? "地图精确定位" : "坐标已保存")
        : "文本地址";
    }
    this.setData({ locationSummary, locationBadge });
    return true;
  },

  chooseLocation() {
    const requestId = (this.locationRequestId || 0) + 1;
    this.locationRequestId = requestId;
    const isActive = () => !this.hidden && !this.unloaded && requestId === this.locationRequestId;
    return chooseCouponLocation(this.data.form).then((nextForm) => {
      if (!isActive()) return null;
      this.setData({ form: nextForm }, () => {
        this.refreshLocationSummary(nextForm);
      });
      wx.showToast({ title: "已获取地点", icon: "success" });
      return nextForm;
    }).catch((error) => {
      if (!isActive()) return null;
      if (locationService.isCancelError(error)) return null;
      if (locationService.isPermissionError(error)) {
        wx.showModal({
          title: "需要位置权限",
          content: "地图选点需要允许位置权限，也可以继续手动填写地址。",
          showCancel: false,
        });
        return null;
      }
      wx.showToast({ title: (error && error.message) || "选点失败，可手动填写", icon: "none" });
      return null;
    });
  },

  estimateRoute() {
    const requestId = (this.routeRequestId || 0) + 1;
    this.routeRequestId = requestId;
    const isActive = () => !this.hidden && !this.unloaded && requestId === this.routeRequestId;
    this.setData({ routeEstimating: true });
    return estimateCouponRoute(this.data.form).then((res) => {
      if (!isActive()) return null;
      this.setData({
        routeEstimating: false,
        form: res.form,
        routeOrigin: res.origin,
      }, () => {
        this.refreshLocationSummary(res.form);
      });
      wx.showToast({ title: `估算约 ${res.form.travelTime}`, icon: "success" });
      return res;
    }).catch((err) => {
      if (!isActive()) return null;
      this.setData({ routeEstimating: false });
      wx.showToast({ title: (err && err.message) || "无法估算路程", icon: "none" });
      return null;
    });
  },

  pasteFromClipboard() {
    const requestId = (this.clipboardRequestId || 0) + 1;
    this.clipboardRequestId = requestId;
    const isActive = () => !this.hidden && !this.unloaded && requestId === this.clipboardRequestId;
    wx.getClipboardData({
      success: (res) => {
        if (!isActive()) return;
        const text = (res.data || "").trim();
        if (!text) {
          wx.showToast({ title: "剪贴板没有可识别内容", icon: "none" });
          return;
        }
        this.applyParsedText(text);
      },
      fail: () => {
        if (isActive()) wx.showToast({ title: "无法读取剪贴板", icon: "none" });
      },
    });
  },

  onPasteInput(e) {
    this.setData({ pasteInputText: e.detail.value });
  },

  smartParseText() {
    const text = (this.data.pasteInputText || "").trim();
    if (!text) {
      wx.showToast({ title: "请输入或粘贴需要解析的文本", icon: "none" });
      return;
    }
    this.applyParsedText(text);
  },

  clearPasteInput() {
    this.setData({ pasteInputText: "" });
  },

  recognizeScreenshot() {
    const requestId = (this.ocrRequestId || 0) + 1;
    this.ocrRequestId = requestId;
    this.setData({ ocrRecognizing: true });
    const isActive = () => !this.hidden && !this.unloaded && requestId === this.ocrRequestId;
    const stop = () => {
      if (isActive()) this.setData({ ocrRecognizing: false });
    };
    ocrService.recognizeCouponScreenshot().then((result) => {
      if (!isActive()) return;
      const text = (result.text || result.rawText || "").trim();
      if (!text) {
        wx.showToast({ title: "没有识别到文字", icon: "none" });
        stop();
        return;
      }
      this.applyParsedText(text);
      if (result.tempFilePath && this.data.form.screenshots.length < 6) {
        const attachmentMutationId = (this.screenshotMutationId || 0) + 1;
        this.screenshotMutationId = attachmentMutationId;
        this.screenshotMutationPending = true;
        this.setData({ screenshotUploading: true });
        screenshotService.persistTempScreenshot(result.tempFilePath).then((screenshot) => {
          if (!isActive() || attachmentMutationId !== this.screenshotMutationId) {
            screenshotService.deleteScreenshot(screenshot).catch(() => false);
            return;
          }
          const screenshots = screenshotService.normalizeScreenshots(this.data.form.screenshots.concat([screenshot])).slice(0, 6);
          if (screenshot && screenshot.id) this.sessionAddedScreenshots[screenshot.id] = screenshot;
          this.setData({ "form.screenshots": screenshots, screenshotUploading: false }, () => {
            this.refreshScreenshotPreviews();
          });
        }).catch(() => {
          if (!isActive() || attachmentMutationId !== this.screenshotMutationId) return;
          this.setData({ screenshotUploading: false });
          wx.showToast({ title: "文字已识别，截图保存失败", icon: "none" });
        }).then(() => {
          if (attachmentMutationId === this.screenshotMutationId) {
            this.screenshotMutationPending = false;
          }
        });
      }
      wx.showToast({ title: "截图已识别", icon: "success" });
      stop();
    }).catch((error) => {
      if (!isActive()) return;
      const code = error && error.code;
      wx.showModal({
        title: code === "privacy_local_only" ? "OCR 已保护" : code === "ocr_unsupported" ? "OCR 未开通" : "截图识别失败",
        content: (error && error.message) || "可以先用粘贴识别或手动添加。",
        showCancel: false,
      });
      stop();
    });
  },

  applyParsedText(text) {
    const res = applyParsedOcrResult(text, this.data.form, this.data.typeOptions, this.data.peopleOptions, this.data.platformOptions);
    if (!res || !res.success) {
      wx.showToast({ title: "解析失败", icon: "none" });
      return;
    }
    const nextData = {
      defaultTags: res.defaultTags,
      selectedTags: res.selectedTags,
      lifeTagOptions: res.lifeTagOptions,
      reservationIndex: res.reservationIndex,
      refundIndex: res.refundIndex,
      form: res.form,
      parsedDishes: parseDishesList(res.form.dishes),
    };
    if (res.typeIndex !== undefined) nextData.typeIndex = res.typeIndex;
    if (res.platformIndex !== undefined) nextData.platformIndex = res.platformIndex;
    if (res.peopleIndex !== undefined) nextData.peopleIndex = res.peopleIndex;

    this.setData(nextData, () => {
      this.refreshLocationSummary(res.form);
    });
    wx.showToast({ title: "已识别并填入", icon: "success" });
  },
};
