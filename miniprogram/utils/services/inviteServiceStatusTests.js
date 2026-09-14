const assert = require("assert");

const storage = new Map();
const cloudRequests = [];
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  showToast() {},
  cloud: {
    callFunction(options) { cloudRequests.push(options); },
  },
};

const privacyService = require("../privacyService.js");
const cloudService = require("./cloudService.js");
const originalCloudAllowed = privacyService.isCloudUploadAllowed;
const originalCloudError = cloudService.getCloudUnavailableError;
privacyService.isCloudUploadAllowed = () => true;
cloudService.getCloudUnavailableError = () => null;

const inviteService = require("./inviteService.js");

async function run() {
  const local = inviteService.ensureLocalInvite({
    id: "plan_status_contract",
    title: "版本确认契约",
    selectedTime: { date: "2026-09-01", startTime: "19:00", internal: "drop" },
    note: "private-note",
    dishes: "private-dishes",
    participants: [{ id: "secret", name: "private-name" }],
    recommendationSnapshot: { score: 99 },
  }, "朋友");
  assert.ok(local);
  assert.strictEqual(local.planSnapshot.note, undefined);
  assert.strictEqual(local.planSnapshot.dishes, undefined);
  assert.strictEqual(local.planSnapshot.participants, undefined);
  assert.strictEqual(local.planSnapshot.recommendationSnapshot, undefined);
  assert.strictEqual(local.planSnapshot.selectedTime.internal, undefined);

  const confirmedRequest = inviteService.updateInviteStatus(local.inviteId, "confirmed");
  assert.strictEqual(cloudRequests.length, 1);
  assert.strictEqual(cloudRequests[0].data.data.planUpdatedAt, local.planUpdatedAt, "recipient decisions must bind to the displayed plan revision");
  assert.strictEqual((await inviteService.getInvite(local.inviteId)).status, "pending", "local UI must not commit before the cloud claim succeeds");
  cloudRequests[0].success({ result: {
    success: true,
    inviteId: local.inviteId,
    status: "confirmed",
  } });
  const confirmed = await confirmedRequest;
  assert.strictEqual(confirmed.success, true);
  assert.strictEqual((await inviteService.getInvite(local.inviteId)).status, "confirmed");

  const changedLocal = inviteService.ensureLocalInvite({
    id: "plan_status_contract",
    title: "改期后的版本",
    selectedTime: { date: "2026-09-02", startTime: "20:00" },
  }, "朋友", local);
  const staleRequest = inviteService.updateInviteStatus(local.inviteId, "rejected");
  assert.strictEqual(cloudRequests.length, 2);
  cloudRequests[1].success({ result: { success: false, code: "invite_changed", message: "计划已更新" } });
  const staleResult = await staleRequest;
  assert.strictEqual(staleResult.success, false);
  assert.strictEqual(staleResult.code, "invite_changed");
  assert.strictEqual((await inviteService.getInvite(local.inviteId)).status, "pending", "a rejected stale claim must not fork local status");
  assert.ok(changedLocal.planUpdatedAt > local.planUpdatedAt);

  cloudService.getCloudUnavailableError = () => Object.assign(new Error("placeholder"), { code: "cloud_unavailable" });
  const localOnly = await inviteService.updateInviteStatus(local.inviteId, "confirmed");
  assert.strictEqual(localOnly.success, true, "placeholder cloud mode must keep the recipient flow usable locally");
  assert.strictEqual(localOnly.localOnly, true);
  assert.strictEqual((await inviteService.getInvite(local.inviteId)).status, "confirmed");

  console.log("invite service status tests ok");
}

run().finally(() => {
  privacyService.isCloudUploadAllowed = originalCloudAllowed;
  cloudService.getCloudUnavailableError = originalCloudError;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
