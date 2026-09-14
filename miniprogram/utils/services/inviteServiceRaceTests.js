const assert = require("assert");

const storage = new Map();
const cloudRequests = [];
global.wx = {
  getStorageSync(key) {
    return storage.get(key);
  },
  setStorageSync(key, value) {
    storage.set(key, value);
  },
  showToast() {},
  cloud: {
    callFunction(options) {
      cloudRequests.push(options);
    },
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
  const respondToCreate = (index, path) => {
    const payload = cloudRequests[index].data.data;
    cloudRequests[index].success({
      result: Object.assign({ success: true, path }, payload),
    });
  };
  const firstPlan = {
    id: "plan_race",
    title: "版本一",
    selectedTime: { date: "2026-09-01", startTime: "18:00" },
  };
  const firstLocal = inviteService.ensureLocalInvite(firstPlan, "朋友");
  const firstSync = inviteService.createInvite(firstPlan, "朋友", { localInvite: firstLocal });

  const secondPlan = {
    id: "plan_race",
    title: "版本二",
    selectedTime: { date: "2026-09-01", startTime: "20:00" },
  };
  const secondLocal = inviteService.ensureLocalInvite(secondPlan, "朋友", { ...firstLocal });
  const secondSync = inviteService.createInvite(secondPlan, "朋友", { localInvite: secondLocal });

  assert.strictEqual(cloudRequests.length, 2);
  respondToCreate(1, "/latest");
  await secondSync;
  respondToCreate(0, "/stale");
  await firstSync;

  const finalInvite = await inviteService.getInvite(firstLocal.inviteId);
  assert.strictEqual(finalInvite.planSnapshot.title, "版本二");
  assert.strictEqual(finalInvite.planSnapshot.selectedTime.startTime, "20:00");
  assert.strictEqual(finalInvite.sharePath, secondLocal.sharePath);
  assert.strictEqual(finalInvite.syncStatus, "cloud");

  privacyService.isCloudUploadAllowed = originalCloudAllowed;
  cloudService.getCloudUnavailableError = originalCloudError;
  console.log("invite service race tests ok");
}

run().catch((error) => {
  privacyService.isCloudUploadAllowed = originalCloudAllowed;
  cloudService.getCloudUnavailableError = originalCloudError;
  console.error(error);
  process.exitCode = 1;
});
