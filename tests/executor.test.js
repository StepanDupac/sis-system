import test from "node:test";
import assert from "node:assert/strict";
import { Executor } from "../extension/core/executor.js";
import { validatePlan } from "../extension/core/config.js";
import { createJournal, withExecutionLock } from "../extension/core/coordination.js";

const slots = ["a", "b", "c"].map((id, index) => ({ id, examId: "math", date: 10_000 + index * 1_000, label: id }));

function fixture(overrides = {}) {
  let now = 0;
  let stored = null;
  let inFlight = 0;
  let maxInFlight = 0;
  const calls = [];
  const events = [];
  const journal = {
    read: async () => stored,
    write: async (record) => { stored = structuredClone(record); },
    clear: async () => { stored = null; },
  };
  const adapter = {
    id: "test",
    prepare: async () => ({ status: "ready", slotIds: slots.map((slot) => slot.id) }),
    submit: async ({ slot }) => ({ status: "accepted", slotId: slot.id }),
    reconcile: async ({ slot }) => ({ status: "confirmed", slotId: slot.id }),
    ...overrides.adapter,
  };
  const submit = adapter.submit;
  adapter.submit = async (args) => {
    assert.equal(stored?.attemptId, args.attemptId, "write intent must precede dispatch");
    assert.ok(now >= 100, "never submit before opening");
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    calls.push({ ...args, at: now });
    try { return await submit(args); }
    finally { inFlight -= 1; }
  };
  const executor = new Executor({
    adapter,
    journal,
    clock: { now: () => now, changed: () => false },
    wait: async (ms) => { now += ms; },
    onEvent: (event) => events.push(event),
    policy: { refreshBeforeMs: 20, retryDelayMs: 10, reconciliationDelayMs: 10, ...overrides.policy },
    ...overrides.executor,
  });
  return { executor, adapter, journal, calls, events, run: () => executor.run({ slots, openAt: 100 }),
    stored: () => stored, setStored: (record) => { stored = record; },
    advance: (ms) => { now += ms; }, maxInFlight: () => maxInFlight };
}

test("confirmed full advances immediately, then verified success stops all writes", async () => {
  const f = fixture({ adapter: { submit: async ({ slot }) => slot.id === "a" ? { status: "full", final: true } : { status: "accepted" } } });
  assert.deepEqual(await f.run(), { state: "success", slotId: "b" });
  assert.deepEqual(f.calls.map((call) => call.slot.id), ["a", "b"]);
  assert.equal(f.calls[0].at, f.calls[1].at, "no artificial delay on definitive fallback");
  assert.equal(f.maxInFlight(), 1);
  assert.equal(f.stored(), null);
});

test("lost response after commit reconciles success without a duplicate", async () => {
  const f = fixture({ adapter: { submit: async () => { throw new Error("connection lost"); } } });
  assert.equal((await f.run()).state, "success");
  assert.equal(f.calls.length, 1);
  assert.equal(f.stored(), null);
});

test("request timeout can still commit; reconciliation observes it and no fallback occurs", async () => {
  let committed = false;
  const f = fixture({ policy: { requestTimeoutMs: 2 }, adapter: {
    submit: async () => { await new Promise((resolve) => setTimeout(resolve, 12)); committed = true; return { status: "accepted" }; },
    reconcile: async ({ slot }) => { await new Promise((resolve) => setTimeout(resolve, 20)); return committed ? { status: "confirmed", slotId: slot.id } : { status: "unknown" }; },
  } });
  assert.equal((await f.run()).state, "success");
  assert.equal(f.calls.length, 1);
});

test("absence alone after timeout never licenses a second write", async () => {
  const f = fixture({ adapter: { submit: async () => ({ status: "unknown" }), reconcile: async () => ({ status: "not_enrolled" }) } });
  assert.equal((await f.run()).state, "uncertain");
  assert.equal(f.calls.length, 1);
  assert.ok(f.stored());
  f.advance(-100);
  assert.equal((await f.run()).state, "blocked");
  assert.equal(f.calls.length, 1);
});

test("apparent full without finality requires reconciliation", async () => {
  const f = fixture({ adapter: { submit: async () => ({ status: "full" }), reconcile: async () => ({ status: "unknown" }) } });
  assert.equal((await f.run()).state, "uncertain");
  assert.equal(f.calls.length, 1);
});

test("a mismatched confirmation never reports the requested slot as successful", async () => {
  const f = fixture({ adapter: { reconcile: async () => ({ status: "confirmed", slotId: "different-slot" }) } });
  assert.equal((await f.run()).state, "uncertain");
  assert.equal(f.calls.length, 1);
  assert.ok(f.stored());
});

test("definitive not-committed result retries same priority before falling back", async () => {
  let reconciliations = 0;
  const f = fixture({ adapter: {
    reconcile: async ({ slot, attemptId }) => ++reconciliations === 1
      ? { status: "not_committed", attemptId, final: true }
      : { status: "confirmed", slotId: slot.id },
  } });
  assert.equal((await f.run()).state, "success");
  assert.deepEqual(f.calls.map((call) => call.slot.id), ["a", "a"]);
});

test("not-committed for a different request leaves the journal unresolved", async () => {
  const f = fixture({ adapter: { reconcile: async () => ({ status: "not_committed", attemptId: "wrong-id", final: true }) } });
  assert.equal((await f.run()).state, "uncertain");
  assert.equal(f.calls.length, 1);
});

test("not-open retries are bounded and do not skip the preferred date", async () => {
  const f = fixture({ policy: { maxAttempts: 3 }, adapter: { submit: async () => ({ status: "not_open", final: true }) } });
  assert.equal((await f.run()).state, "limit");
  assert.deepEqual(f.calls.map((call) => call.slot.id), ["a", "a", "a"]);
  assert.equal(f.stored(), null);
});

test("server retry-after is honored", async () => {
  let count = 0;
  const f = fixture({ adapter: { submit: async () => ++count === 1 ? { status: "rate_limited", final: true, retryAfterMs: 700 } : { status: "accepted" } } });
  assert.equal((await f.run()).state, "success");
  assert.ok(f.calls[1].at - f.calls[0].at >= 700);
});

test("retry-after past deadline stops instead of flooding the server", async () => {
  const f = fixture({ adapter: { submit: async () => ({ status: "rate_limited", final: true, retryAfterMs: 60_000 }) } });
  assert.equal((await f.run()).state, "limit");
  assert.equal(f.calls.length, 1);
});

test("session expiry during preflight dispatches nothing", async () => {
  const f = fixture({ adapter: { prepare: async () => ({ status: "auth_expired" }) } });
  assert.equal((await f.run()).state, "auth_expired");
  assert.equal(f.calls.length, 0);
});

test("session expiry during a definitive rejection stops", async () => {
  const f = fixture({ adapter: { submit: async () => ({ status: "auth_expired", final: true }) } });
  assert.equal((await f.run()).state, "auth_expired");
  assert.equal(f.calls.length, 1);
  assert.equal(f.stored(), null);
});

test("changed or unavailable slot IDs during preparation prevent dispatch", async () => {
  const f = fixture({ adapter: { prepare: async () => ({ status: "ready", slotIds: ["other"] }) } });
  assert.equal((await f.run()).state, "failed");
  assert.equal(f.calls.length, 0);
});

test("an existing different enrollment is never automatically replaced", async () => {
  const f = fixture({ adapter: { prepare: async () => ({ status: "already_enrolled", slotId: "other" }) } });
  assert.equal((await f.run()).state, "existing_registration");
  assert.equal(f.calls.length, 0);
});

test("an existing selected enrollment is confirmed without submitting again", async () => {
  const f = fixture({ adapter: { prepare: async () => ({ status: "already_enrolled", slotId: "b" }) } });
  assert.equal((await f.run()).state, "success");
  assert.equal(f.calls.length, 0);
});

test("stop before dispatch prevents all writes", async () => {
  const f = fixture();
  f.adapter.prepare = async () => { f.executor.stop(); return { status: "ready", slotIds: ["a", "b", "c"] }; };
  assert.equal((await f.run()).state, "stopped");
  assert.equal(f.calls.length, 0);
});

test("stop during accepted request still reconciles its success", async () => {
  let stop;
  const f = fixture({ adapter: { submit: async () => { stop(); return { status: "accepted" }; } } });
  stop = () => f.executor.stop();
  assert.equal((await f.run()).state, "success");
  assert.equal(f.calls.length, 1);
});

test("stop during full response never moves to backup", async () => {
  let stop;
  const f = fixture({ adapter: { submit: async () => { stop(); return { status: "full", final: true }; } } });
  stop = () => f.executor.stop();
  assert.equal((await f.run()).state, "stopped");
  assert.equal(f.calls.length, 1);
});

test("stop while persisting intent clears it without dispatching", async () => {
  const f = fixture();
  const write = f.journal.write;
  f.journal.write = async (record) => { await write(record); f.executor.stop(); };
  assert.equal((await f.run()).state, "stopped");
  assert.equal(f.calls.length, 0);
  assert.equal(f.stored(), null);
});

test("closing or reloading after dispatch retains an unresolved journal", async () => {
  const f = fixture();
  f.setStored({ attemptId: "previous", slotId: "a", adapterId: "test" });
  assert.equal((await f.run()).state, "blocked");
  assert.equal(f.calls.length, 0);
});

test("write-intent persistence failure prevents network mutation", async () => {
  const f = fixture();
  f.journal.write = async () => { throw new Error("storage unavailable"); };
  assert.equal((await f.run()).state, "failed");
  assert.equal(f.calls.length, 0);
});

test("journal clear failure after confirmed commit does not retry", async () => {
  const f = fixture();
  f.journal.clear = async () => { throw new Error("storage unavailable"); };
  assert.equal((await f.run()).state, "uncertain");
  assert.equal(f.calls.length, 1);
});

test("all-full terminates at the last selected slot", async () => {
  const f = fixture({ adapter: { submit: async () => ({ status: "full", final: true }) } });
  assert.equal((await f.run()).state, "exhausted");
  assert.deepEqual(f.calls.map((call) => call.slot.id), ["a", "b", "c"]);
});

test("late wakeup does not dispatch a stale run", async () => {
  let advance;
  const f = fixture({ executor: { wait: async (ms) => advance(ms + 2_000) } });
  advance = f.advance;
  assert.equal((await f.run()).state, "late");
  assert.equal(f.calls.length, 0);
});

test("execution readiness gate is rechecked after journal persistence", async () => {
  let ready = true;
  const f = fixture({ executor: { canExecute: () => ready } });
  const write = f.journal.write;
  f.journal.write = async (record) => { await write(record); ready = false; };
  assert.equal((await f.run()).state, "not_ready");
  assert.equal(f.calls.length, 0);
  assert.equal(f.stored(), null);
});

test("an observer exception cannot trigger duplicate enrollment", async () => {
  const f = fixture({ executor: { onEvent: () => { throw new Error("UI broken"); } } });
  assert.equal((await f.run()).state, "success");
  assert.equal(f.calls.length, 1);
});

test("plan is snapshotted before asynchronous preparation", async () => {
  const f = fixture();
  const input = { openAt: 100, slots: structuredClone(slots) };
  const promise = f.executor.run(input);
  input.slots[0].id = "tampered";
  input.slots.reverse();
  assert.equal((await promise).state, "success");
  assert.equal(f.calls[0].slot.id, "a");
});

test("duplicate invocation of same executor cannot start a second run", async () => {
  const f = fixture();
  const first = f.run();
  await assert.rejects(f.run(), /už běží/);
  assert.equal((await first).state, "success");
  assert.equal(f.calls.length, 1);
});

test("invalid priorities and dates are rejected", () => {
  for (const plan of [
    { openAt: 100, slots: [] },
    { openAt: 100, slots: [slots[0], slots[0]] },
    { openAt: 100, slots: [slots[0], { ...slots[1], examId: "other" }] },
    { openAt: -1, slots },
    { openAt: Number.NaN, slots },
    { openAt: 100, slots: [{ ...slots[0], date: 50 }] },
    { openAt: 86_400_001, slots },
  ]) assert.throws(() => validatePlan(plan, 0));
});

test("coordination refuses another writer without queueing it for later execution", async () => {
  let ran = false;
  const locks = { request: async (key, options, callback) => {
    assert.equal(key, "sis-executor:single-writer");
    assert.equal(options.ifAvailable, true);
    return callback(null);
  } };
  assert.deepEqual(await withExecutionLock(() => { ran = true; }, locks), { state: "busy" });
  assert.equal(ran, false);
});

test("storage journal survives creation of a new executor context", async () => {
  const data = {};
  const storage = { get: async (key) => ({ [key]: data[key] }), set: async (values) => Object.assign(data, values), remove: async (key) => { delete data[key]; } };
  const first = createJournal(storage);
  await first.write({ attemptId: "x", slotId: "a" });
  const reopened = createJournal(storage);
  assert.equal((await reopened.read()).attemptId, "x");
  await reopened.clear();
  assert.equal(await first.read(), null);
});
