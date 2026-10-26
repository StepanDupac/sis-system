import { sleep } from "../core/config.js";

export const SCENARIOS = Object.freeze({
  fallback: "První termín je plný → náhradní termín",
  success: "První termín vyjde",
  delayed: "Zápis proběhne, odpověď se ztratí",
  unknown: "Výsledek se nepodaří ověřit",
  all_full: "Všechny termíny jsou plné",
  expired: "Přihlášení vypršelo",
  throttled: "Server požádá o krátké čekání",
});

// Deliberately no fetch, cookies, passwords or external network access.
// This adapter cannot enroll a student in a real university system.
export class DemoAdapter {
  id = "offline-demo";

  constructor({ slots, openAt, scenario = "fallback", delayMs = 90 }) {
    this.slots = structuredClone(slots);
    this.openAt = openAt;
    this.scenario = scenario;
    this.delayMs = delayMs;
    this.enrolled = null;
    this.calls = 0;
  }

  async prepare() {
    // Independent preparation work is genuinely concurrent.
    const [session, slots] = await Promise.all([this.checkSession(), this.loadSlots()]);
    if (!session) return { status: "auth_expired" };
    if (this.enrolled) return { status: "already_enrolled", slotId: this.enrolled };
    return { status: "ready", slotIds: slots.map((slot) => slot.id) };
  }

  async checkSession() {
    await sleep(this.delayMs);
    return this.scenario !== "expired";
  }

  async loadSlots() {
    await sleep(this.delayMs);
    return this.slots;
  }

  async submit({ slot }) {
    this.calls += 1;
    if (Date.now() < this.openAt) return { status: "not_open", final: true };
    await sleep(this.delayMs);
    if (this.scenario === "all_full" || (this.scenario === "fallback" && slot.id === this.slots[0].id)) {
      return { status: "full", final: true };
    }
    if (this.scenario === "throttled" && this.calls === 1) return { status: "rate_limited", final: true, retryAfterMs: 600 };
    if (this.scenario === "unknown") return { status: "unknown" };
    this.enrolled = slot.id;
    if (this.scenario === "delayed") throw new Error("Simulated lost response after commit");
    return { status: "accepted" };
  }

  async reconcile() {
    await sleep(this.delayMs);
    return this.enrolled ? { status: "confirmed", slotId: this.enrolled } : { status: "unknown" };
  }
}
