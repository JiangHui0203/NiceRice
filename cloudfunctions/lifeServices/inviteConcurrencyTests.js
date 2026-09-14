const assert = require("assert");
const Module = require("module");

function clone(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).reduce((result, key) => {
    result[key] = clone(value[key]);
    return result;
  }, {});
}

function comparable(value) {
  return value instanceof Date ? value.getTime() : value;
}

function createFakeDatabase() {
  const rows = new Map();
  let sequence = 0;
  const hooks = { beforeWhereUpdate: null, beforeWhereRemove: null };
  const command = {
    exists(value) { return { __operator: "exists", value }; },
    in(values) { return { __operator: "in", values }; },
    neq(value) { return { __operator: "neq", value }; },
    gt(value) { return { __operator: "gt", value }; },
  };

  function matches(row, condition = {}) {
    return Object.keys(condition).every((key) => {
      const expected = condition[key];
      if (expected && expected.__operator === "exists") {
        return Object.prototype.hasOwnProperty.call(row, key) === expected.value;
      }
      if (expected && expected.__operator === "in") {
        return expected.values.some((value) => comparable(value) === comparable(row[key]));
      }
      if (expected && expected.__operator === "neq") {
        return comparable(row[key]) !== comparable(expected.value);
      }
      if (expected && expected.__operator === "gt") {
        return comparable(row[key]) > comparable(expected.value);
      }
      return comparable(row[key]) === comparable(expected);
    });
  }

  function query(condition) {
    let limitValue = Infinity;
    return {
      limit(value) { limitValue = value; return this; },
      async get() {
        return { data: Array.from(rows.values()).filter((row) => matches(row, condition)).slice(0, limitValue).map(clone) };
      },
      async update(options = {}) {
        if (hooks.beforeWhereUpdate) {
          const hook = hooks.beforeWhereUpdate;
          hooks.beforeWhereUpdate = null;
          hook(rows);
        }
        let updated = 0;
        rows.forEach((row, id) => {
          if (!matches(row, condition)) return;
          rows.set(id, Object.assign({}, row, clone(options.data || {})));
          updated += 1;
        });
        return { stats: { updated } };
      },
      async remove() {
        if (hooks.beforeWhereRemove) {
          const hook = hooks.beforeWhereRemove;
          hooks.beforeWhereRemove = null;
          hook(rows);
        }
        let removed = 0;
        Array.from(rows.entries()).forEach(([id, row]) => {
          if (!matches(row, condition)) return;
          rows.delete(id);
          removed += 1;
        });
        return { stats: { removed } };
      },
    };
  }

  return {
    rows,
    hooks,
    command,
    collection() {
      return {
        async add(options = {}) {
          const data = clone(options.data || options);
          const id = data._id || `generated_${sequence += 1}`;
          if (rows.has(id)) throw Object.assign(new Error("duplicate _id"), { code: "duplicate" });
          data._id = id;
          rows.set(id, data);
          return { _id: id };
        },
        where: query,
        doc(id) {
          return {
            async get() { return { data: rows.has(id) ? clone(rows.get(id)) : null }; },
            async update(options = {}) {
              if (!rows.has(id)) return { stats: { updated: 0 } };
              rows.set(id, Object.assign({}, rows.get(id), clone(options.data || {})));
              return { stats: { updated: 1 } };
            },
            async remove() {
              const removed = rows.delete(id) ? 1 : 0;
              return { stats: { removed } };
            },
          };
        },
      };
    },
  };
}

const fakeDb = createFakeDatabase();
let currentOpenid = "owner";
const originalLoad = Module._load;
Module._load = function mockCloud(request, parent, isMain) {
  if (request !== "wx-server-sdk") return originalLoad.call(this, request, parent, isMain);
  return {
    DYNAMIC_CURRENT_ENV: "test",
    init() {},
    database() { return fakeDb; },
    getWXContext() { return { OPENID: currentOpenid, APPID: "test" }; },
    openapi: {},
  };
};

const service = require("./index.js");
Module._load = originalLoad;

function createEvent(version, title, inviteId = "inv_concurrency_abcdefghijklmnopqrstuvwx") {
  const selectedTime = {
    date: "2026-09-01",
    startTime: "18:00",
    label: title,
  };
  return {
    type: "createPlanInvite",
    data: {
      inviteId,
      planId: "plan_concurrency_contract",
      title,
      selectedTime,
      planSnapshot: {
        id: "plan_concurrency_contract",
        title,
        statusCode: "confirmed",
        reservationStatus: "unknown",
        selectedTime,
      },
      status: "pending",
      planUpdatedAt: version,
    },
  };
}

async function run() {
  const v1 = "2026-09-01T10:00:00.000Z";
  const v2 = "2026-09-01T11:00:00.000Z";
  const v25 = "2026-09-01T11:30:00.000Z";
  const v3 = "2026-09-01T12:00:00.000Z";
  const v4 = "2026-09-01T13:00:00.000Z";
  const inviteId = "inv_concurrency_abcdefghijklmnopqrstuvwx";

  assert.strictEqual((await service.main(createEvent(v1, "v1"))).success, true);
  assert.strictEqual((await service.main(createEvent(v2, "v2"))).success, true);
  const staleCreate = await service.main(createEvent(v1, "v1-stale"));
  assert.strictEqual(staleCreate.success, false);
  assert.strictEqual(staleCreate.code, "invite_changed", "a late old create must be rejected as stale");
  assert.strictEqual(fakeDb.rows.get(inviteId).planSnapshot.title, "v2");

  fakeDb.hooks.beforeWhereUpdate = (rows) => {
    const row = rows.get(inviteId);
    rows.set(inviteId, Object.assign({}, row, {
      title: "v3",
      planSnapshot: Object.assign({}, row.planSnapshot, { id: row.planId, title: "v3" }),
      planUpdatedAt: v3,
      updatedAt: new Date("2026-09-01T12:00:00.000Z"),
    }));
  };
  await service.main(createEvent(v25, "v2.5"));
  assert.strictEqual(fakeDb.rows.get(inviteId).planSnapshot.title, "v3", "CAS retry must not overwrite a version committed during the update");

  currentOpenid = "recipient-a";
  const oldCardClaim = await service.main({
    type: "updatePlanInvite",
    data: { inviteId, status: "confirmed", planUpdatedAt: v2 },
  });
  assert.strictEqual(oldCardClaim.success, false);
  assert.strictEqual(oldCardClaim.code, "invite_changed");

  const currentClaim = await service.main({
    type: "updatePlanInvite",
    data: { inviteId, status: "confirmed", planUpdatedAt: v3 },
  });
  assert.strictEqual(currentClaim.success, true);
  currentOpenid = "recipient-b";
  const secondClaim = await service.main({
    type: "updatePlanInvite",
    data: { inviteId, status: "rejected", planUpdatedAt: v3 },
  });
  assert.strictEqual(secondClaim.success, false);
  assert.strictEqual(secondClaim.code, "invite_already_claimed");

  currentOpenid = "owner";
  await service.main(createEvent(v4, "v4"));
  assert.strictEqual(fakeDb.rows.get(inviteId).status, "pending");
  assert.strictEqual(fakeDb.rows.get(inviteId).responderOpenid, "", "a new plan revision must reopen recipient confirmation");

  const expiringId = "inv_expiry_zyxwvutsrqponmlkjihgfedc";
  await service.main(createEvent(v1, "expired", expiringId));
  const expired = fakeDb.rows.get(expiringId);
  expired.expiresAt = new Date(Date.now() - 1000);
  expired.updatedAt = new Date("2026-09-01T09:00:00.000Z");
  fakeDb.rows.set(expiringId, expired);
  fakeDb.hooks.beforeWhereRemove = (rows) => {
    const row = rows.get(expiringId);
    rows.set(expiringId, Object.assign({}, row, {
      expiresAt: new Date(Date.now() + 60000),
      updatedAt: new Date("2026-09-01T09:30:00.000Z"),
    }));
  };
  const firstRead = await service.main({ type: "getPlanInvite", data: { inviteId: expiringId } });
  assert.strictEqual(firstRead.invite, null);
  assert.strictEqual(fakeDb.rows.has(expiringId), true, "expired cleanup must preserve a durable revocation record");
  const secondRead = await service.main({ type: "getPlanInvite", data: { inviteId: expiringId } });
  assert.strictEqual(secondRead.invite, null, "an expired capability must remain revoked on later reads");

  console.log("lifeServices invite concurrency tests ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
