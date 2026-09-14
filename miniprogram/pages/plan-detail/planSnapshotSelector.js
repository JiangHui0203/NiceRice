const SNAPSHOT_STATUS_PRIORITY = {
  draft: 0,
  pending: 1,
  risky: 1,
  confirmed: 2,
  rescheduled: 3,
  completed: 4,
  cancelled: 4,
  expired: 4,
  rejected: 4,
};

function snapshotRevision(candidate) {
  const plan = candidate.plan || {};
  const envelope = candidate.envelope || {};
  const values = [plan.revision, plan.version, envelope.planRevision, envelope.snapshotRevision]
    .map((value) => (value === null || value === undefined || value === "" ? null : Number(value)))
    .filter((value) => value !== null && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

function timestampValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 100000000000 ? value * 1000 : value;
  }
  if (typeof value !== "string" || value.length > 80) return null;
  const calendarMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (calendarMatch) {
    const year = Number(calendarMatch[1]);
    const month = Number(calendarMatch[2]);
    const day = Number(calendarMatch[3]);
    const exactDate = new Date(year, month - 1, day);
    if (exactDate.getFullYear() !== year || exactDate.getMonth() !== month - 1 || exactDate.getDate() !== day) {
      return null;
    }
  }
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
    ? value.replace(" ", "T")
    : value;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function snapshotUpdatedAt(candidate) {
  const plan = candidate.plan || {};
  const envelope = candidate.envelope || {};
  const changeLogTimes = [];
  (Array.isArray(plan.changeLogs) ? plan.changeLogs.slice(-100) : []).forEach((item) => {
    changeLogTimes.push(item && item.updatedAt, item && item.createdAt);
  });
  const values = [
    plan.updatedAt,
    plan.modifiedAt,
    plan.lastModifiedAt,
    envelope.planUpdatedAt,
    envelope.createdAt,
    plan.createdAt,
  ].concat(changeLogTimes).map(timestampValue).filter((value) => value !== null);
  return values.length ? Math.max(...values) : null;
}

function snapshotEnvelopeUpdatedAt(candidate) {
  const envelope = candidate.envelope || {};
  return timestampValue(envelope.planUpdatedAt);
}

function snapshotStatusPriority(candidate) {
  const status = String((candidate.plan && (candidate.plan.statusCode || candidate.plan.status)) || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(SNAPSHOT_STATUS_PRIORITY, status)
    ? SNAPSHOT_STATUS_PRIORITY[status]
    : 0;
}

function snapshotSourcePriority(candidate) {
  if (candidate.source === "remote") {
    // getInviteById can resolve from the local cache. In that case the plan
    // store is at least as authoritative as the cached invite snapshot.
    return candidate.envelope && candidate.envelope.syncStatus === "local" ? 2 : 3;
  }
  if (candidate.source === "local") return 2;
  return 1;
}

function comparePlanSnapshotCandidates(left, right) {
  const leftRevision = snapshotRevision(left);
  const rightRevision = snapshotRevision(right);
  if (leftRevision !== null && rightRevision !== null && leftRevision !== rightRevision) {
    return leftRevision > rightRevision ? 1 : -1;
  }

  // For two snapshots of the same shared invitation, planUpdatedAt is the
  // content-version clock. Local collaboration/status writes may legitimately
  // update plan.updatedAt later without changing the scheduled content, so the
  // generic timestamp must not make an older local time beat a newer invite.
  const leftEnvelopeUpdatedAt = snapshotEnvelopeUpdatedAt(left);
  const rightEnvelopeUpdatedAt = snapshotEnvelopeUpdatedAt(right);
  if (leftEnvelopeUpdatedAt !== null
    && rightEnvelopeUpdatedAt !== null
    && leftEnvelopeUpdatedAt !== rightEnvelopeUpdatedAt) {
    return leftEnvelopeUpdatedAt > rightEnvelopeUpdatedAt ? 1 : -1;
  }

  const leftUpdatedAt = snapshotUpdatedAt(left);
  const rightUpdatedAt = snapshotUpdatedAt(right);
  if (leftUpdatedAt !== null && rightUpdatedAt !== null && leftUpdatedAt !== rightUpdatedAt) {
    return leftUpdatedAt > rightUpdatedAt ? 1 : -1;
  }

  // Legacy snapshots often have no version metadata. Status progression is a
  // safer fallback than always trusting either the device or the invite.
  const leftStatus = snapshotStatusPriority(left);
  const rightStatus = snapshotStatusPriority(right);
  if (leftStatus !== rightStatus) return leftStatus > rightStatus ? 1 : -1;

  const leftSource = snapshotSourcePriority(left);
  const rightSource = snapshotSourcePriority(right);
  if (leftSource !== rightSource) return leftSource > rightSource ? 1 : -1;
  return 0;
}

function selectPlanSnapshot(options = {}) {
  const candidates = [];
  if (options.sharedPlan) {
    candidates.push({ plan: options.sharedPlan, source: "shared", envelope: options.sharedInvite || null });
  }
  const remotePlan = options.remotePlan || (options.fetchedInvite && options.fetchedInvite.planSnapshot);
  if (remotePlan) {
    candidates.push({ plan: remotePlan, source: "remote", envelope: options.fetchedInvite || null });
  }
  // First reconcile the two representations carried by the invitation, then
  // compare that result with the device snapshot. This prevents an older
  // fetched invite from re-entering after a newer shared payload already won.
  if (options.localPlan) {
    candidates.push({
      plan: options.localPlan,
      source: "local",
      envelope: options.localInvite || options.localPlan.inviteSnapshot || null,
    });
  }
  if (!candidates.length) return { plan: null, source: "none" };

  // Explicit revisions form a single authoritative version domain. Select
  // the global maximum before applying timestamp/status/source fallbacks so
  // an unversioned middle candidate cannot make the pairwise comparison
  // non-transitive (for example rev3 -> unversioned -> rev2).
  const revisionedCandidates = candidates
    .map((candidate) => ({ candidate, revision: snapshotRevision(candidate) }))
    .filter((item) => item.revision !== null);
  let eligibleCandidates = candidates;
  if (revisionedCandidates.length) {
    const highestRevision = Math.max(...revisionedCandidates.map((item) => item.revision));
    eligibleCandidates = revisionedCandidates
      .filter((item) => item.revision === highestRevision)
      .map((item) => item.candidate);
  }

  const selected = eligibleCandidates.slice(1).reduce((best, candidate) => (
    comparePlanSnapshotCandidates(candidate, best) > 0 ? candidate : best
  ), eligibleCandidates[0]);
  return { plan: selected.plan, source: selected.source };
}

module.exports = {
  snapshotRevision,
  timestampValue,
  snapshotUpdatedAt,
  snapshotEnvelopeUpdatedAt,
  snapshotStatusPriority,
  snapshotSourcePriority,
  comparePlanSnapshotCandidates,
  selectPlanSnapshot,
};
