const base = require("./inviteProtocolBase.js");
const snapshot = require("./inviteSnapshotProtocol.js");
const version = require("./inviteVersionProtocol.js");

module.exports = Object.assign({}, base, snapshot, version);
