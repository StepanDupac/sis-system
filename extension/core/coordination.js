// Origin-wide Web Lock: every extension tab shares this lock. No heartbeat or
// lease expiry can create overlapping writers while a slow request is pending.
export async function withExecutionLock(work, locks = navigator.locks) {
  return locks.request("sis-executor:single-writer", { ifAvailable: true }, async (lock) => {
    if (!lock) return { state: "busy" };
    return work();
  });
}

export function createJournal(storage, key = "unresolvedAttempt") {
  return {
    read: async () => (await storage.get(key))[key] ?? null,
    write: async (value) => storage.set({ [key]: value }),
    clear: async () => storage.remove(key),
  };
}
