const actionHandlers = require("./handlers/actionHandlers.js");
const inviteHandlers = require("./handlers/inviteHandlers.js");
const feedbackHandlers = require("./handlers/feedbackHandlers.js");
const loadHandlers = require("./handlers/loadHandlers.js");

const pageConfig = {
  data: {
    plan: null,
    coupon: null,
    currentInvite: null,
    isRecipient: false,
    actionState: {
      primaryAction: null,
      secondaryActions: [],
      hasActions: false,
      hasSecondaryActions: false,
      actionsExpanded: false,
    },
    feedbackVisible: false,
    feedbackRating: 5,
    feedbackReasons: [
      { label: "时间合适", selected: false },
      { label: "天气给力", selected: false },
      { label: "省钱划算", selected: false },
      { label: "朋友聚会尽兴", selected: false },
      { label: "交通方便", selected: false },
      { label: "用餐体验好", selected: false },
    ],
    feedbackComment: "",
  }
};

Object.assign(pageConfig, loadHandlers, actionHandlers, inviteHandlers, feedbackHandlers);

Page(pageConfig);
