const assert = require("assert");

const actionHandlers = require("./handlers/actionHandlers.js");
const inviteHandlers = require("./handlers/inviteHandlers.js");
const feedbackHandlers = require("./handlers/feedbackHandlers.js");

const handlerGroups = [actionHandlers, inviteHandlers, feedbackHandlers];
const exportedNames = handlerGroups.flatMap((handlers) => Object.keys(handlers));
assert.strictEqual(new Set(exportedNames).size, exportedNames.length, "handler groups must not overwrite each other");

const routedActions = [
  "completePlan",
  "cancelPlan",
  "confirmFriend",
  "rejectFriend",
  "acceptInvite",
  "rejectInvite",
  "changeTime",
  "postponePlan",
  "markReserved",
  "reservationFailed",
  "addToCalendar",
  "requestReminder",
  "recipientReschedule",
];
const routedCalls = [];
const routerPage = {};
routedActions.forEach((name) => {
  routerPage[name] = (event) => routedCalls.push({ name, event });
});

routedActions.forEach((action) => {
  const event = { currentTarget: { dataset: { action } } };
  actionHandlers.handleActionTap.call(routerPage, event);
});
actionHandlers.handleActionTap.call(routerPage, { currentTarget: { dataset: { action: "reschedulePlan" } } });
actionHandlers.handleActionTap.call(routerPage, { currentTarget: { dataset: {} } });

assert.deepStrictEqual(
  routedCalls.map((item) => item.name),
  routedActions.concat("changeTime"),
  "dynamic action ids must preserve their Page method routing"
);
assert.strictEqual(routedCalls.find((item) => item.name === "postponePlan").event.currentTarget.dataset.action, "postponePlan");

const feedbackPage = {
  data: {
    feedbackRating: 5,
    feedbackComment: "",
    feedbackReasons: [{ label: "时间合适", selected: false }],
  },
  setData(patch) {
    Object.assign(this.data, patch);
  },
};
feedbackHandlers.selectFeedbackRating.call(feedbackPage, { currentTarget: { dataset: { value: "5" } } });
feedbackHandlers.toggleFeedbackReason.call(feedbackPage, { currentTarget: { dataset: { label: "时间合适" } } });
feedbackHandlers.onFeedbackComment.call(feedbackPage, { detail: { value: "体验不错" } });
assert.strictEqual(feedbackPage.data.feedbackRating, 5);
assert.strictEqual(feedbackPage.data.feedbackReasons[0].selected, true);
assert.strictEqual(feedbackPage.data.feedbackComment, "体验不错");

[
  "confirmFriend",
  "rejectFriend",
  "recipientReschedule",
  "acceptInvite",
  "rejectInvite",
  "copyInviteText",
  "prepareFriendInvite",
  "onShareAppMessage",
  "onShareTimeline",
].forEach((name) => assert.strictEqual(typeof inviteHandlers[name], "function", `missing invite handler: ${name}`));

const timelinePlan = { id: "plan_timeline", title: "跨设备聚餐", selectedTime: { label: "周日晚餐" } };
const timelineShare = inviteHandlers.onShareTimeline.call({
  planId: "",
  data: {
    plan: timelinePlan,
    coupon: null,
    currentInvite: { inviteId: "invite_timeline", syncStatus: "cloud", planSnapshot: timelinePlan },
  },
  setData(patch) { Object.assign(this.data, patch); },
});
assert.ok(timelineShare.query.includes("id=plan_timeline"));
assert.ok(timelineShare.query.includes("inviteId=invite_timeline"));
assert.ok(timelineShare.query.includes("planData="), "timeline share must carry a cross-device plan snapshot");

async function runInviteContracts() {
  const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));
  const inviteService = require("../../utils/services/inviteService.js");
  const planStore = require("../../utils/planStore.js");
  const eventLogger = require("../../utils/eventLogger.js");
  const persistedInvite = inviteService.ensureLocalInvite({
    id: "plan_service_persistence_contract",
    title: "同步持久化契约",
    selectedTime: { date: "2026-09-01", startTime: "18:00" },
  }, "好友");
  const repeatedInvite = inviteService.ensureLocalInvite({
    id: "plan_service_persistence_contract",
    title: "同步持久化契约",
    selectedTime: { date: "2026-09-01", startTime: "18:00" },
  }, "好友", persistedInvite);
  assert.strictEqual(repeatedInvite.inviteId, persistedInvite.inviteId, "local invite id must stay stable across repeated ensures");
  const storedInvite = await inviteService.getInviteById(persistedInvite.inviteId);
  assert.strictEqual(storedInvite.inviteId, persistedInvite.inviteId, "ensureLocalInvite must persist before returning");

  const oldPlan = {
    id: "plan_service_reshare_contract",
    title: "改期前",
    selectedTime: { date: "2026-09-05", label: "周六 18:00", startTime: "18:00" },
  };
  const oldInvite = inviteService.ensureLocalInvite(oldPlan, "好友");
  const syncedOldInvite = inviteService.ensureLocalInvite(oldPlan, "好友", Object.assign({}, oldInvite, {
    syncStatus: "cloud",
  }));
  const refreshedInvite = inviteService.ensureLocalInvite({
    id: oldPlan.id,
    title: "改期后",
    selectedTime: { date: "2026-09-06", label: "周日 19:30", startTime: "19:30" },
    inviteId: oldInvite.inviteId,
    inviteSnapshot: oldInvite,
  }, "好友", syncedOldInvite);
  assert.strictEqual(refreshedInvite.inviteId, oldInvite.inviteId, "re-sharing after reschedule must retain the invite id");
  assert.strictEqual(refreshedInvite.title, "改期后");
  assert.strictEqual(refreshedInvite.selectedTime.startTime, "19:30");
  assert.strictEqual(refreshedInvite.planSnapshot.title, "改期后", "reused invite must snapshot the current plan");
  assert.strictEqual(refreshedInvite.planSnapshot.inviteSnapshot, undefined, "refreshed snapshots must not recursively embed old invites");
  assert.ok(refreshedInvite.updatedAt, "refreshing a reused invite must record its freshness");
  assert.strictEqual(refreshedInvite.syncStatus, "local", "a changed cloud invite must become pending local sync again");
  assert.strictEqual(refreshedInvite.status, "pending", "a changed invite snapshot must require recipient confirmation again");
  const storedRefreshedInvite = await inviteService.getInviteById(oldInvite.inviteId);
  assert.strictEqual(storedRefreshedInvite.planSnapshot.selectedTime.startTime, "19:30", "refreshed invite must be persisted before sharing");
  await inviteService.updateInvitePlan(oldInvite.inviteId, Object.assign({}, refreshedInvite.planSnapshot, {
    selectedTime: { date: "2026-09-06", label: "周日 20:00", startTime: "20:00" },
  }));
  const queuedInviteUpdate = await inviteService.getInviteById(oldInvite.inviteId);
  assert.strictEqual(queuedInviteUpdate.planSnapshot.selectedTime.startTime, "20:00");
  assert.strictEqual(queuedInviteUpdate.syncStatus, "local", "a failed or local-only plan update must remain queued for cloud sync");

  const originalEnsureLocalInvite = inviteService.ensureLocalInvite;
  const originalCreateInvite = inviteService.createInvite;
  const originalAttachInvite = planStore.attachInvite;
  const originalLogEvent = eventLogger.logEvent;
  const previousWx = global.wx;
  const hadWx = Object.prototype.hasOwnProperty.call(global, "wx");
  const attached = [];
  const cloudRequests = [];
  const clipboardValues = [];

  function createPage(planId) {
    return {
      planId,
      data: {
        plan: {
          id: planId,
          title: "分享竞态",
          statusCode: "pending",
          selectedTime: { date: "2026-09-01", startTime: "19:00" },
          participants: [{ id: "friend", name: "好友" }],
        },
        coupon: null,
        currentInvite: null,
        isRecipient: false,
        actionState: { actionsExpanded: false },
      },
      setData(patch) { Object.assign(this.data, patch); },
    };
  }

  try {
    inviteService.ensureLocalInvite = (plan, friendName, existingInvite) => {
      if (existingInvite && (existingInvite.inviteId || existingInvite.id)) {
        return plan.title === "改期后分享"
          ? Object.assign({}, existingInvite, {
            syncStatus: "local",
            planSnapshot: Object.assign({}, plan),
            planUpdatedAt: "2026-08-30T20:00:00.000Z",
          })
          : existingInvite;
      }
      return Object.assign(inviteService.buildInvite(plan, friendName), { syncStatus: "local" });
    };
    inviteService.createInvite = (plan, friendName, options) => {
      cloudRequests.push({ plan, friendName, invite: options.localInvite });
      return new Promise(() => {});
    };
    planStore.attachInvite = (planId, invite) => {
      attached.push({ planId, inviteId: invite.inviteId || invite.id });
      return {
        id: planId,
        title: "分享竞态",
        statusCode: "pending",
        participants: [{ id: "friend", name: "好友" }],
        inviteId: invite.inviteId || invite.id,
        inviteSnapshot: invite,
      };
    };
    eventLogger.logEvent = () => {};
    global.wx = {
      setClipboardData(options) {
        clipboardValues.push(options.data);
        if (options.success) options.success();
      },
      showToast() {},
    };

    const appSharePage = createPage("plan_direct_app_share");
    const immediateShare = inviteHandlers.onShareAppMessage.call(appSharePage);
    const appInviteId = appSharePage.data.currentInvite.inviteId;
    await Promise.resolve();
    assert.ok(immediateShare.path.includes(`inviteId=${appInviteId}`), "direct app share must synchronously create a local invite");
    assert.strictEqual(attached[0].inviteId, appInviteId, "plan must be attached before the cloud promise settles");
    assert.strictEqual(cloudRequests[0].invite.inviteId, appInviteId, "cloud sync must reuse the already-shared local id");
    appSharePage.unloaded = true;
    appSharePage.inviteRequestId += 1;
    assert.strictEqual(appSharePage.data.plan.inviteId, appInviteId, "rapid unload must leave the plan linked to its local invite");

    const repeatedShare = inviteHandlers.onShareAppMessage.call(appSharePage);
    assert.ok(repeatedShare.path.includes(`inviteId=${appInviteId}`));
    assert.strictEqual(cloudRequests.length, 1, "repeated share callbacks must not start duplicate cloud creates");

    const timelinePage = createPage("plan_direct_timeline_share");
    const timeline = inviteHandlers.onShareTimeline.call(timelinePage);
    const timelineInviteId = timelinePage.data.currentInvite.inviteId;
    assert.ok(timeline.query.includes(`inviteId=${timelineInviteId}`), "timeline share must also synchronously create its invite");

    const clipboardPage = createPage("plan_direct_clipboard_share");
    inviteHandlers.copyInviteText.call(clipboardPage);
    const clipboardInviteId = clipboardPage.data.currentInvite.inviteId;
    assert.ok(clipboardValues[0].includes(`#YS_INVITE#${clipboardInviteId}#`), "clipboard entry must use its persisted local invite id");
    assert.strictEqual(attached.length, 3, "each fresh entry point must synchronously attach exactly one invite");

    const resharePage = createPage("plan_cloud_reshare");
    resharePage.data.plan.title = "改期后分享";
    resharePage.data.currentInvite = {
      inviteId: "inv_existc_abcdefghijklmnopqrstuvwxyz123456",
      syncStatus: "cloud",
      planSnapshot: { id: "plan_cloud_reshare", title: "改期前" },
    };
    inviteHandlers.onShareAppMessage.call(resharePage);
    await flushAsyncWork();
    assert.strictEqual(cloudRequests.length, 4, "snapshot refresh must decide cloud sync from the ensured local invite");
    assert.strictEqual(cloudRequests[3].invite.syncStatus, "local");

    inviteService.createInvite = (plan, friendName, options) => {
      cloudRequests.push({ plan, friendName, invite: options.localInvite });
      return Promise.resolve(options.localInvite);
    };
    const retryPage = createPage("plan_cloud_retry");
    retryPage.data.plan.title = "改期后分享";
    retryPage.data.currentInvite = {
      inviteId: "inv_retryc_abcdefghijklmnopqrstuvwxyz123456",
      syncStatus: "cloud",
      planSnapshot: { id: "plan_cloud_retry", title: "改期前" },
    };
    inviteHandlers.onShareAppMessage.call(retryPage);
    await flushAsyncWork();
    assert.strictEqual(retryPage.inviteSyncInviteId, "", "a local fallback must clear the in-flight marker");
    inviteHandlers.onShareAppMessage.call(retryPage);
    await flushAsyncWork();
    assert.strictEqual(cloudRequests.length, 6, "a later share must be able to retry a failed cloud sync");

    const queuedResolvers = [];
    inviteService.createInvite = (plan, friendName, options) => {
      cloudRequests.push({ plan, friendName, invite: options.localInvite });
      return new Promise((resolve) => queuedResolvers.push(resolve));
    };
    const queuedPage = createPage("plan_cloud_queued_revision");
    queuedPage.data.plan.title = "首次分享";
    inviteHandlers.onShareAppMessage.call(queuedPage);
    await flushAsyncWork();
    const requestsBeforeReshare = cloudRequests.length;
    queuedPage.data.plan.title = "改期后分享";
    inviteHandlers.onShareAppMessage.call(queuedPage);
    assert.strictEqual(cloudRequests.length, requestsBeforeReshare, "same-id re-share should wait for its older in-flight revision");
    const queuedLatestInvite = queuedPage.data.currentInvite;
    queuedResolvers[0](queuedLatestInvite);
    await flushAsyncWork();
    assert.strictEqual(cloudRequests.length, requestsBeforeReshare + 1, "the newer revision must automatically sync after the old request settles");
    assert.strictEqual(cloudRequests[cloudRequests.length - 1].invite.planSnapshot.title, "改期后分享");
  } finally {
    inviteService.ensureLocalInvite = originalEnsureLocalInvite;
    inviteService.createInvite = originalCreateInvite;
    planStore.attachInvite = originalAttachInvite;
    eventLogger.logEvent = originalLogEvent;
    if (hadWx) global.wx = previousWx;
    else delete global.wx;
  }
}

runInviteContracts().then(() => {
  console.log("plan detail handler contract tests ok");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
