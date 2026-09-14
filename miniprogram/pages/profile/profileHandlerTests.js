const assert = require("assert");

const preferenceStore = require("../../utils/preferenceStore.js");
const preferenceHandlerPath = require.resolve("./handlers/preferenceHandlers.js");
const originalSavePreferences = preferenceStore.savePreferences;
const originalReadPreferences = preferenceStore.readPreferences;
const originalBuildGroups = preferenceStore.buildGroups;

let savedPreferences = null;
preferenceStore.savePreferences = (preferences) => {
  savedPreferences = JSON.parse(JSON.stringify(preferences));
  return true;
};
preferenceStore.readPreferences = () => JSON.parse(JSON.stringify(
  savedPreferences || preferenceStore.defaultPreferences,
));
preferenceStore.buildGroups = (preferences) => [{ transportMode: preferences.transportMode }];
delete require.cache[preferenceHandlerPath];
const preferenceHandlers = require(preferenceHandlerPath);

const page = {
  data: {
    preferences: {
      transportMode: "transit",
      maxTravelDuration: 30,
      priceSensitivity: "medium",
      homeCity: "",
    },
    transportModes: [
      { id: "transit" },
      { id: "walking" },
      { id: "driving" },
    ],
  },
  summaryUpdates: 0,
  setData(patch, callback) {
    Object.assign(this.data, patch);
    if (typeof callback === "function") callback();
  },
  updateSummaries() {
    this.summaryUpdates += 1;
  },
};

preferenceHandlers.onTransportModeChange.call(page, { detail: { value: "2" } });
assert.strictEqual(page.data.preferences.transportMode, "driving");
assert.strictEqual(savedPreferences.transportMode, "driving", "must persist the newly constructed preference object");
assert.strictEqual(page.data.transportModeIndex, 2);

preferenceHandlers.onMaxTravelDurationChange.call(page, { detail: { value: "75" } });
assert.strictEqual(page.data.preferences.maxTravelDuration, 75);
assert.strictEqual(savedPreferences.maxTravelDuration, 75);

preferenceHandlers.setPriceSensitivity.call(page, { currentTarget: { dataset: { val: "high" } } });
preferenceHandlers.onHomeCityInput.call(page, { detail: { value: "上海" } });
assert.strictEqual(savedPreferences.priceSensitivity, "high");
assert.strictEqual(savedPreferences.homeCity, "上海");
assert.strictEqual(page.summaryUpdates, 4);

const handlerGroups = [
  preferenceHandlers,
  require("./handlers/privacyHandlers.js"),
  require("./handlers/locationHandlers.js"),
  require("./handlers/scheduleHandlers.js"),
  require("./handlers/friendHandlers.js"),
  require("./handlers/accountBackupHandlers.js"),
  require("./handlers/weatherHandlers.js"),
];
const handlerNames = handlerGroups.flatMap((handlers) => Object.keys(handlers));
assert.strictEqual(new Set(handlerNames).size, handlerNames.length, "profile handler groups must not overwrite each other");

const { formatFriendsForView } = require("./profileHelper.js");
const friendView = formatFriendsForView([{ name: "小王", availableSlots: ["周五晚"], foodPreferences: { dietaryRestrictions: ["不吃辣"] } }])[0];
assert.strictEqual(friendView.avatarChar, "小");
assert.deepStrictEqual(friendView.slots, ["周五晚"]);
assert.deepStrictEqual(friendView.restrictions, ["不吃辣"]);

preferenceStore.savePreferences = originalSavePreferences;
preferenceStore.readPreferences = originalReadPreferences;
preferenceStore.buildGroups = originalBuildGroups;
delete require.cache[preferenceHandlerPath];

console.log("profile handler contract tests ok");
