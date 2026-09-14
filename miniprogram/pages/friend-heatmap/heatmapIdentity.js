const { normalizeExactId } = require("../../utils/idUtils.js");
const {
  SELF_PARTICIPANT_ID,
  LEGACY_SELF_PARTICIPANT_ID,
} = require("./heatmapConstants.js");

function normalizeParticipantId(id) {
  const value = normalizeExactId(id);
  return value === LEGACY_SELF_PARTICIPANT_ID ? SELF_PARTICIPANT_ID : value;
}

function normalizeSelfId(value) {
  const text = normalizeExactId(value);
  return /^[A-Za-z0-9_-]{6,96}$/.test(text) ? text : "";
}

function isSelfParticipant(participant = {}) {
  return participant.isSelf === true || normalizeParticipantId(participant.id) === SELF_PARTICIPANT_ID;
}

function ensureSelfParticipant(participants = [], selfFallback = {}) {
  const source = Array.isArray(participants)
    ? participants.slice(0, 101).filter((participant) => participant && typeof participant === "object")
    : [];
  const storedSelf = source.find(isSelfParticipant);
  const selfParticipant = Object.assign({}, storedSelf || {}, {
    id: SELF_PARTICIPANT_ID,
    name: String((storedSelf && storedSelf.name) || selfFallback.name || "我"),
    status: "confirmed",
    isSelf: true,
  });
  return [selfParticipant, ...source.filter((participant) => !isSelfParticipant(participant)).slice(0, 100)];
}

function resolvePlanStatus(participants = [], includeFriends = false) {
  if (!includeFriends || !Array.isArray(participants)) return "confirmed";
  const hasPendingFriend = participants.some((participant = {}) => {
    return !isSelfParticipant(participant) && participant.status === "pending";
  });
  return hasPendingFriend ? "pending" : "confirmed";
}

module.exports = {
  normalizeParticipantId,
  normalizeSelfId,
  isSelfParticipant,
  ensureSelfParticipant,
  resolvePlanStatus,
};
