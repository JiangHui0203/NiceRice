const TouchDismissHelper = require("../../../utils/touchDismissHelper.js");

module.exports = {
  onModalTouchStart(e) {
    if (!this.modalDismissHelper) this.modalDismissHelper = new TouchDismissHelper({ thresholdY: 70 });
    const result = this.modalDismissHelper.onTouchStart(e);
    if (result) this.setData({ modalDragY: result.dragOffsetY });
  },

  onModalTouchMove(e) {
    if (!this.modalDismissHelper) return;
    const result = this.modalDismissHelper.onTouchMove(e);
    if (result) this.setData({ modalDragY: result.dragOffsetY });
  },

  onModalTouchEnd(e) {
    if (!this.modalDismissHelper) return;
    this.modalDismissHelper.onTouchEnd(e, () => this.closeSlotDetailModal());
    this.setData({ modalDragY: 0 });
  },

  onDrawerTouchStart(e) {
    if (!this.drawerDismissHelper) this.drawerDismissHelper = new TouchDismissHelper({ thresholdY: 80 });
    const result = this.drawerDismissHelper.onTouchStart(e);
    if (result) this.setData({ drawerDragY: result.dragOffsetY });
  },

  onDrawerTouchMove(e) {
    if (!this.drawerDismissHelper) return;
    const result = this.drawerDismissHelper.onTouchMove(e);
    if (result) this.setData({ drawerDragY: result.dragOffsetY });
  },

  onDrawerTouchEnd(e) {
    if (!this.drawerDismissHelper) return;
    this.drawerDismissHelper.onTouchEnd(e, () => {
      if (this.data.showSettingsDrawer) this.closeSettingsDrawer();
      else if (this.data.showFriendDrawer) this.closeFriendDrawer();
      else if (this.data.showBulkExportDrawer) this.closeBulkExportDrawer();
      else if (this.data.showCandidateDrawer) this.closeCandidateDrawer();
      else if (this.data.showInviteShareDrawer) this.closeInviteShareDrawer();
    });
    this.setData({ drawerDragY: 0 });
  },
};
