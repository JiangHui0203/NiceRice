const responseHandlers = require("./inviteResponseHandlers.js");
const shareHandlers = require("./inviteShareHandlers.js");

module.exports = Object.assign({}, responseHandlers, shareHandlers);
