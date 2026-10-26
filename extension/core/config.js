export const DEFAULT_POLICY = Object.freeze({
  maxAttempts: 8,
  retryDelayMs: 250,
  executionWindowMs: 15_000,
  requestTimeoutMs: 2_000,
  readTimeoutMs: 2_000,
  reconciliationAttempts: 3,
  reconciliationDelayMs: 300,
  refreshBeforeMs: 1_000,
  maxLatenessMs: 1_500,
});

export function validatePlan(plan, now) {
  if (!plan || !Array.isArray(plan.slots) || !plan.slots.length) {
    throw new Error("Vyberte alespoň jeden termín.");
  }
  if (plan.slots.length > 10) throw new Error("Lze vybrat nejvýše 10 termínů.");
  if (!Number.isFinite(plan.openAt) || plan.openAt < now) {
    throw new Error("Čas spuštění musí být v budoucnosti.");
  }
  if (plan.openAt - now > 86_400_000) {
    throw new Error("Spusťte přípravu nejdříve 24 hodin před otevřením zápisu.");
  }
  const ids = new Set();
  const examIds = new Set();
  const slots = plan.slots.map((slot) => {
    if (!slot || typeof slot.id !== "string" || !slot.id || ids.has(slot.id)) {
      throw new Error("Termíny musí mít různá, neprázdná ID.");
    }
    if (typeof slot.examId !== "string" || !slot.examId || !Number.isFinite(slot.date)) {
      throw new Error("U termínu chybí předmět nebo datum.");
    }
    if (slot.date <= plan.openAt) throw new Error("Zkouška musí být později než otevření zápisu.");
    ids.add(slot.id);
    examIds.add(slot.examId);
    return Object.freeze({ id: slot.id, examId: slot.examId, date: slot.date, label: String(slot.label || slot.id) });
  });
  if (examIds.size !== 1) throw new Error("Náhradní termíny musí patřit ke stejné zkoušce.");
  return Object.freeze({ slots: Object.freeze(slots), openAt: plan.openAt });
}

export function createClock() {
  const wall = Date.now();
  const mono = performance.now();
  return {
    now: () => wall + performance.now() - mono,
    changed: () => Math.abs(Date.now() - (wall + performance.now() - mono)) > 2_000,
  };
}

export function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    signal?.addEventListener("abort", done, { once: true });
  });
}

export async function bounded(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
