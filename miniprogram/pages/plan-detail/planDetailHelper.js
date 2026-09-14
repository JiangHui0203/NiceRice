const part1 = require("./planDetailBase.js");
const part2 = require("./planDetailViewHelper.js");
const part3 = require("./planDetailMutationHelper.js");
const part4 = require("./planDetailInteractionHelper.js");
const part5 = require("./planSnapshotSelector.js");
const part6 = require("./planShareCodec.js");

const parts = Object.assign({}, part1, part2, part3, part4, part5, part6);

module.exports = {
  getPlanCleanupMinutes: parts.getPlanCleanupMinutes,
  buildActionState: parts.buildActionState,
  formatPlanForView: parts.formatPlanForView,
  completePlanAction: parts.completePlanAction,
  cancelPlanAction: parts.cancelPlanAction,
  postponePlanAction: parts.postponePlanAction,
  confirmFriendAction: parts.confirmFriendAction,
  rejectFriendAction: parts.rejectFriendAction,
  markReservationConfirmedAction: parts.markReservationConfirmedAction,
  markReservationFailedAction: parts.markReservationFailedAction,
  openLocationMap: parts.openLocationMap,
  addPlanToCalendarService: parts.addPlanToCalendarService,
  requestReminderService: parts.requestReminderService,
  toggleReasonSelection: parts.toggleReasonSelection,
  submitFeedbackData: parts.submitFeedbackData,
  selectPlanSnapshot: parts.selectPlanSnapshot,
  buildSharedPlanSnapshot: parts.buildSharedPlanSnapshot,
  buildSharedCouponSnapshot: parts.buildSharedCouponSnapshot,
  buildShareDataPackage: parts.buildShareDataPackage,
  parseSharedPlanData: parts.parseSharedPlanData,
};
