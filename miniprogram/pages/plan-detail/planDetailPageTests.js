const assert = require("assert");

const pageModulePath = require.resolve("./index.js");
const helper = require("./planDetailHelper.js");
const inviteService = require("../../utils/services/inviteService.js");
const planStore = require("../../utils/planStore.js");
const PAGE_INVITE_ID = "inv_pagect_abcdefghijklmnopqrstuvwxyz123456";

const previousGlobals = {
  hadWx: Object.prototype.hasOwnProperty.call(global, "wx"),
  hadPage: Object.prototype.hasOwnProperty.call(global, "Page"),
  wx: global.wx,
  Page: global.Page,
  setTimeout: global.setTimeout,
  clearTimeout: global.clearTimeout,
};
const originalActions = {
  confirmFriendAction: helper.confirmFriendAction,
  rejectFriendAction: helper.rejectFriendAction,
  getInviteById: inviteService.getInviteById,
  updateInviteStatus: inviteService.updateInviteStatus,
  findPlan: planStore.findPlan,
  savePlan: planStore.savePlan,
};

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function createPage(config) {
  const page = Object.assign({}, config, { data: cloneData(config.data || {}) });
  page.setData = function setData(patch, callback) {
    Object.assign(this.data, patch || {});
    if (typeof callback === "function") callback.call(this);
  };
  return page;
}

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function run() {
  let inviteReads = 0;
  let navigateBackCalls = 0;
  let confirmArgs = null;
  let rejectArgs = null;
  helper.confirmFriendAction = (plan, coupon) => {
    confirmArgs = { plan, coupon };
    return { success: true };
  };
  helper.rejectFriendAction = (plan, reason) => {
    rejectArgs = { plan, reason };
    return { success: true };
  };
  let fetchedInviteOverride = {
    inviteId: PAGE_INVITE_ID,
    planId: "plan_page_contract",
    status: "pending",
    planSnapshot: {
      id: "plan_page_contract",
      title: "过期邀请快照",
      statusCode: "pending",
      reservationStatus: "unknown",
      selectedTime: { date: "2026-09-01", startTime: "19:00" },
      participants: [{ id: "friend", name: "朋友" }],
    },
  };
  inviteService.getInviteById = () => {
    inviteReads += 1;
    return Promise.resolve(fetchedInviteOverride);
  };
  let localPlanOverride = null;
  planStore.findPlan = (planId) => planId === "plan_page_contract" ? localPlanOverride : null;
  planStore.savePlan = (plan) => plan;

  const toastMessages = [];
  global.wx = {
    getStorageSync() { return "self"; },
    showToast(options) { toastMessages.push(options && options.title); },
    showModal(options) { if (options.success) options.success({ confirm: false }); },
    navigateBack() { navigateBackCalls += 1; },
    switchTab() {},
  };

  let pageConfig = null;
  global.Page = (config) => { pageConfig = config; };
  delete require.cache[pageModulePath];
  require(pageModulePath);
  assert.ok(pageConfig, "plan-detail should register its Page config");

  const page = createPage(pageConfig);
  const sharedPlan = {
    plan: {
      id: "plan_page_contract",
      couponId: "coupon_page_contract",
      title: "页面契约计划",
      statusCode: "pending",
      reservationStatus: "unknown",
      selectedTime: { date: "2026-09-01", startTime: "19:00" },
      participants: [{ id: "friend", name: "朋友" }],
    },
    coupon: {
      id: "coupon_page_contract",
      title: "页面契约券",
      venue: "测试门店",
      statusCode: "planned",
    },
    invite: {
      id: PAGE_INVITE_ID,
      inviteId: PAGE_INVITE_ID,
      planId: "plan_page_contract",
      status: "pending",
      syncStatus: "local",
    },
  };

  page.onLoad({
    id: "plan_page_contract",
    inviteId: PAGE_INVITE_ID,
    role: "recipient",
    planData: JSON.stringify(sharedPlan),
  });
  page.onShow();
  await flushAsyncWork();
  assert.strictEqual(inviteReads, 1, "onLoad 后的首次 onShow 不应重复读取邀请");
  assert.strictEqual(page.data.plan.id, "plan_page_contract");
  assert.strictEqual(page.data.isRecipient, true, "缺少 inviterId 时也应保留显式 recipient 角色");
  assert.strictEqual(page.data.actionState.primaryAction.action, "acceptInvite");

  localPlanOverride = {
    id: "plan_page_contract",
    title: "本地最新计划",
    statusCode: "confirmed",
    participants: [{ id: "friend", name: "朋友" }],
  };
  const freshnessPage = createPage(pageConfig);
  freshnessPage.onLoad({
    id: "plan_page_contract",
    inviteId: PAGE_INVITE_ID,
    role: "recipient",
    planData: JSON.stringify(sharedPlan),
  });
  freshnessPage.onShow();
  await flushAsyncWork();
  assert.strictEqual(freshnessPage.data.plan.title, "本地最新计划", "本地新快照不应被旧邀请快照覆盖");
  assert.strictEqual(freshnessPage.data.plan.statusCode, "pending", "收件人未回应前应保持待确认展示状态");

  fetchedInviteOverride = null;
  localPlanOverride = {
    id: "plan_page_contract",
    title: "本地 revision 2",
    revision: 2,
    statusCode: "confirmed",
    participants: [{ id: "friend", name: "朋友" }],
  };
  const oldSharedPlanPage = createPage(pageConfig);
  oldSharedPlanPage.onLoad({
    id: "plan_page_contract",
    inviteId: PAGE_INVITE_ID,
    role: "recipient",
    planData: JSON.stringify({
      plan: Object.assign({}, sharedPlan.plan, { title: "分享 revision 1", revision: 1 }),
      coupon: sharedPlan.coupon,
      invite: sharedPlan.invite,
    }),
  });
  oldSharedPlanPage.onShow();
  await flushAsyncWork();
  assert.strictEqual(oldSharedPlanPage.data.plan.title, "本地 revision 2", "云端未找到邀请时也必须比较 planData 与本地快照");

  localPlanOverride = {
    id: "plan_page_contract",
    title: "本地 revision 2",
    revision: 2,
    statusCode: "confirmed",
    participants: [{ id: "friend", name: "朋友" }],
  };
  fetchedInviteOverride = {
    inviteId: PAGE_INVITE_ID,
    planId: "plan_page_contract",
    syncStatus: "cloud",
    planSnapshot: {
      id: "plan_page_contract",
      title: "远端 revision 3",
      revision: 3,
      statusCode: "rescheduled",
      reservationStatus: "unknown",
      selectedTime: { date: "2026-09-02", startTime: "20:00" },
      participants: [{ id: "friend", name: "朋友" }],
    },
  };
  const newerRemotePage = createPage(pageConfig);
  newerRemotePage.onLoad({
    id: "plan_page_contract",
    inviteId: PAGE_INVITE_ID,
    role: "recipient",
    planData: JSON.stringify(sharedPlan),
  });
  newerRemotePage.onShow();
  await flushAsyncWork();
  assert.strictEqual(newerRemotePage.data.plan.title, "远端 revision 3", "远端 revision 更新时不得固定偏向本地计划");

  page.confirmFriend();
  assert.strictEqual(confirmArgs.coupon.id, "coupon_page_contract", "确认好友时应传优惠券，而不是 inviteId");

  page.rejectFriend();
  assert.strictEqual(rejectArgs.reason, "朋友暂时无法参加", "拒绝原因不应误用 inviteId");

  page.inviteId = PAGE_INVITE_ID;
  page.loadPlan = () => {};
  confirmArgs = null;
  inviteService.updateInviteStatus = () => Promise.resolve({ success: false, code: "invite_changed", message: "计划已更新" });
  const staleAccept = await page.acceptInvite();
  assert.strictEqual(staleAccept, false);
  assert.strictEqual(confirmArgs.plan.id, "plan_page_contract", "stale claims must roll back the same optimistic local plan");
  assert.ok(toastMessages.includes("计划已更新"));

  inviteService.updateInviteStatus = () => Promise.resolve({ success: true, localOnly: true });
  const localAccept = await page.acceptInvite();
  assert.strictEqual(localAccept, true, "placeholder cloud mode must still allow a durable local acceptance");
  assert.strictEqual(confirmArgs.plan.id, "plan_page_contract");

  const timers = new Map();
  let nextTimerId = 1;
  global.setTimeout = (callback) => {
    const timerId = nextTimerId;
    nextTimerId += 1;
    timers.set(timerId, callback);
    return timerId;
  };
  global.clearTimeout = (timerId) => timers.delete(timerId);
  const missingPage = createPage(pageConfig);
  missingPage.onLoad({ id: "definitely_missing_plan" });
  assert.strictEqual(timers.size, 1, "缺失计划应安排一次延迟返回");
  missingPage.actionRedirectTimer = global.setTimeout(() => {
    throw new Error("action redirect should have been cleared");
  });
  missingPage.onUnload();
  assert.strictEqual(missingPage.unloaded, true);
  assert.strictEqual(timers.size, 0, "页面卸载时应清除全部导航定时器");
  Array.from(timers.values()).forEach((callback) => callback());
  assert.strictEqual(navigateBackCalls, 0, "页面卸载后不得再执行延迟返回");
  global.setTimeout = previousGlobals.setTimeout;
  global.clearTimeout = previousGlobals.clearTimeout;

  console.log("plan detail Page lifecycle tests ok");
}

run().finally(() => {
  helper.confirmFriendAction = originalActions.confirmFriendAction;
  helper.rejectFriendAction = originalActions.rejectFriendAction;
  inviteService.getInviteById = originalActions.getInviteById;
  inviteService.updateInviteStatus = originalActions.updateInviteStatus;
  planStore.findPlan = originalActions.findPlan;
  planStore.savePlan = originalActions.savePlan;
  delete require.cache[pageModulePath];
  if (previousGlobals.hadWx) global.wx = previousGlobals.wx;
  else delete global.wx;
  if (previousGlobals.hadPage) global.Page = previousGlobals.Page;
  else delete global.Page;
  global.setTimeout = previousGlobals.setTimeout;
  global.clearTimeout = previousGlobals.clearTimeout;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
