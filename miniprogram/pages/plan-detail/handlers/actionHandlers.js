const basicHandlers = require("./actionBasicHandlers.js");
const completionHandlers = require("./actionCompletionHandlers.js");

module.exports = Object.assign({}, basicHandlers, completionHandlers);
