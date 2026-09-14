const assert = require("assert");

const config = require("./config.js");

assert.strictEqual(config.QWEATHER_API_KEY, "", "a deployable client bundle must not contain a real weather credential");
assert.strictEqual(config.getWeatherApiKey(), "", "runtime key access must remain an empty client-side placeholder");
assert.strictEqual(config.QWEATHER_API_HOST, "", "the deployable client must not hard-code a legacy or account-specific API host");

console.log("config security tests ok");
