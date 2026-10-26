import { DEFAULT_POLICY, validatePlan, createClock, sleep, bounded } from "./config.js";

// Only a site-specific adapter can establish finality. A missing enrollment in
// a fresh GET is NOT proof that an earlier timed-out POST cannot still commit.
export class Executor {
  constructor({ adapter, journal, onEvent = () => {}, clock = createClock(), wait = sleep, policy = {}, canExecute = () => true }) {
    this.adapter = adapter;
    this.journal = journal;
    this.onEvent = onEvent;
    this.clock = clock;
    this.wait = wait;
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.canExecute = canExecute;
    this.running = false;
    this.state = "idle";
    this.pending = false;
    this.stopRequested = false;
  }

  emit(state, details = {}) {
    this.state = state;
    // A broken observer must never turn a committed enrollment into a retry.
    try { this.onEvent({ state, at: this.clock.now(), ...details }); } catch { /* observer only */ }
  }

  stop() {
    this.stopRequested = true;
    this.controller?.abort();
    if (this.pending) this.emit("stopping");
  }

  finish(state, details = {}) {
    this.emit(state, details);
    return { state, ...details };
  }

  async until(at) {
    while (!this.stopRequested && this.clock.now() < at) {
      if (this.clock.changed?.()) throw new Error("Změnil se čas počítače. Nastavte spuštění znovu.");
      await this.wait(Math.min(250, at - this.clock.now()), this.controller.signal);
    }
  }

  async prepare(plan) {
    const result = await bounded(this.adapter.prepare(plan), this.policy.readTimeoutMs);
    if (result?.status === "auth_expired") return this.finish("auth_expired");
    if (result?.status === "already_enrolled") {
      const slot = plan.slots.find((item) => item.id === result.slotId);
      return slot ? this.finish("success", { slotId: slot.id, alreadyEnrolled: true }) : this.finish("existing_registration");
    }
    if (result?.status !== "ready" || !Array.isArray(result.slotIds) ||
        plan.slots.some((slot) => !result.slotIds.includes(slot.id))) {
      return this.finish("failed", { message: "Přihlášení nebo vybrané termíny se nepodařilo ověřit." });
    }
    return null;
  }

  async clearPending() {
    await this.journal.clear();
    this.pending = false;
  }

  async reconcile(slot, attemptId) {
    this.emit("verifying", { slotId: slot.id });
    for (let n = 0; n < this.policy.reconciliationAttempts; n += 1) {
      let result;
      try {
        result = await bounded(this.adapter.reconcile({ slot, attemptId }), this.policy.readTimeoutMs);
      } catch { result = { status: "unknown" }; }
      if (result?.status === "confirmed" && result.slotId === slot.id) {
        await this.clearPending();
        return this.finish("success", { slotId: slot.id });
      }
      // Requires authoritative finality for THIS attempt, not merely absence.
      if (result?.status === "not_committed" && result.attemptId === attemptId && result.final === true) {
        await this.clearPending();
        return { state: "not_committed" };
      }
      if (result?.status === "confirmed" || result?.status === "auth_expired") break;
      if (n + 1 < this.policy.reconciliationAttempts) await this.wait(this.policy.reconciliationDelayMs);
    }
    return this.finish("uncertain", { slotId: slot.id });
  }

  async run(input) {
    if (this.running) throw new Error("Zápis už běží.");
    const plan = validatePlan(input, this.clock.now());
    this.running = true;
    this.stopRequested = false;
    this.controller = new AbortController();
    this.pending = false;
    let attempts = 0;
    let index = 0;
    try {
      if (await this.journal.read()) return this.finish("blocked");
      this.emit("preparing");
      const initial = await this.prepare(plan);
      if (initial) return initial;
      if (this.stopRequested) return this.finish("stopped");
      this.emit("armed", { openAt: plan.openAt });
      await this.until(plan.openAt - this.policy.refreshBeforeMs);
      if (this.stopRequested) return this.finish("stopped");
      this.emit("refreshing");
      const refreshed = await this.prepare(plan);
      if (refreshed) return refreshed;
      this.emit("armed", { openAt: plan.openAt });
      await this.until(plan.openAt);
      if (this.stopRequested) return this.finish("stopped");
      if (this.clock.now() - plan.openAt > this.policy.maxLatenessMs) return this.finish("late");

      const deadline = plan.openAt + this.policy.executionWindowMs;
      while (!this.stopRequested && attempts < this.policy.maxAttempts && this.clock.now() < deadline) {
        if (index >= plan.slots.length) return this.finish("exhausted");
        if (this.clock.changed?.()) return this.finish("failed", { message: "Změnil se čas počítače. Spusťte přípravu znovu." });
        if (!this.canExecute()) return this.finish("not_ready");
        const slot = plan.slots[index];
        const attemptId = crypto.randomUUID();
        // Persist BEFORE dispatch. Reload/close/crash must not erase ambiguity.
        await this.journal.write({ attemptId, slotId: slot.id, at: this.clock.now(), adapterId: this.adapter.id });
        this.pending = true;
        if (this.stopRequested) {
          await this.clearPending();
          return this.finish("stopped");
        }
        if (!this.canExecute() || this.clock.changed?.() || this.clock.now() >= deadline ||
            (attempts === 0 && this.clock.now() - plan.openAt > this.policy.maxLatenessMs)) {
          await this.clearPending();
          return this.finish("not_ready");
        }
        attempts += 1;
        const sentAt = this.clock.now();
        this.emit("submitting", { slotId: slot.id, attempt: attempts, dispatchDelayMs: Math.round(sentAt - plan.openAt) });
        let response;
        try {
          response = await bounded(this.adapter.submit({ slot, attemptId }), this.policy.requestTimeoutMs);
        } catch { response = { status: "unknown" }; }
        this.emit("response", { slotId: slot.id, responseStatus: response?.status || "unknown", latencyMs: Math.round(this.clock.now() - sentAt) });
        // Only adapter-certified, final rejections can advance or retry.
        const rejected = ["full", "not_open", "rate_limited", "auth_expired", "ineligible"];
        if (rejected.includes(response?.status) && response.final === true) {
          await this.clearPending();
          if (this.stopRequested) return this.finish("stopped");
          if (response.status === "auth_expired") return this.finish("auth_expired");
          if (response.status === "full" || response.status === "ineligible") {
            this.emit("fallback", { slotId: slot.id });
            index += 1;
            if (index >= plan.slots.length) return this.finish("exhausted");
            continue;
          }
          const retryAfter = response.retryAfterMs;
          const delay = Math.max(this.policy.retryDelayMs, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0);
          if (this.clock.now() + delay >= deadline) return this.finish("limit");
          this.emit("retrying", { slotId: slot.id, delayMs: delay });
          await this.wait(delay, this.controller.signal);
          continue;
        }
        const verified = await this.reconcile(slot, attemptId);
        if (verified.state !== "not_committed") return verified;
        // A known uncommitted attempt may retry the same preferred slot.
        if (!this.stopRequested) await this.wait(this.policy.retryDelayMs, this.controller.signal);
      }
      return this.finish(this.stopRequested ? "stopped" : "limit");
    } catch (error) {
      return this.finish(this.pending ? "uncertain" : "failed", {
        message: this.pending ? undefined : String(error?.message || "Přípravu se nepodařilo dokončit."),
      });
    } finally {
      this.running = false;
    }
  }
}
