const part1 = require("./inviteContext.js");
const part2 = require("./inviteNormalizer.js");
const part3 = require("./inviteLocalStore.js");
const part4 = require("./inviteCloudTransport.js");
const part5 = require("./inviteCreateRead.js");
const part6 = require("./inviteMutations.js");
const part7 = require("./inviteDeletion.js");

const parts = Object.assign({}, part1, part2, part3, part4, part5, part6, part7);

module.exports = {
  buildInvite: parts.buildInvite,
  ensureLocalInvite: parts.ensureLocalInvite,
  createInvite: parts.createInvite,
  getInvite: parts.getInvite,
  getInviteById: parts.getInvite,
  updateInvitePlan: parts.updateInvitePlan,
  proposeInviteTime: parts.proposeInviteTime,
  updateInviteStatus: parts.updateInviteStatus,
  deleteInvite: parts.deleteInvite,
  flushInviteTombstones: parts.flushInviteTombstones,
  isInviteDeleted: parts.hasInviteTombstone,
};
