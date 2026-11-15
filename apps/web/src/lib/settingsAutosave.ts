import type { Backend } from "./backend";

export type UserChanges = Parameters<Backend["updateUser"]>[0];
export interface SaveState { phase: "saving" | "saved" | "error" | "invalid"; message?: string; committed?: boolean }

export function createSettingsAutosave(save: (patch: UserChanges) => Promise<void>, refresh: () => Promise<void>, report: (section: string, state: SaveState) => void, delay = 600) {
  const pending = new Map<string, Map<string, UserChanges>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const versions = new Map<string, number>();
  const invalid = new Map<string, Set<string>>();
  const failed = new Map<string, UserChanges>();
  let queue = Promise.resolve();
  let blocked = false;
  const reload = "Saved, but the screen couldn't update. Reload before making more changes.";
  function flush(section: string) {
    clearTimeout(timers.get(section)); timers.delete(section);
    const fields = pending.get(section);
    if (!fields?.size && !failed.has(section)) return queue;
    const changes = Object.assign({}, ...(fields?.values() ?? [])) as UserChanges;
    pending.delete(section);
    const version = versions.get(section);
    queue = queue.then(async () => {
      if (blocked) { report(section, { phase: "error", message: reload, committed: true }); return; }
      const patch = { ...failed.get(section), ...changes };
      try {
        await save(patch);
      } catch (error) {
        failed.set(section, patch);
        report(section, { phase: "error", message: error instanceof TypeError ? "Couldn't save that. Check your connection and try again." : error instanceof Error ? error.message : "That didn't save. Please try again." });
        return;
      }
      failed.delete(section);
      try { await refresh(); }
      catch { blocked = true; report(section, { phase: "error", message: reload, committed: true }); return; }
      if (versions.get(section) === version) report(section, { phase: invalid.get(section)?.size ? "invalid" : "saved" });
    });
    return queue;
  }
  return {
    change(section: string, field: string, patch: UserChanges | null, immediate = false) {
      if (blocked) return;
      versions.set(section, (versions.get(section) ?? 0) + 1);
      const fields = pending.get(section) ?? new Map<string, UserChanges>();
      const invalidFields = invalid.get(section) ?? new Set<string>();
      if (patch) invalidFields.delete(field); else invalidFields.add(field);
      invalid.set(section, invalidFields);
      if (patch) fields.set(field, patch); else fields.delete(field);
      pending.set(section, fields);
      report(section, { phase: patch ? "saving" : "invalid" });
      clearTimeout(timers.get(section));
      if (immediate) void flush(section);
      else timers.set(section, setTimeout(() => { void flush(section); }, delay));
    },
    flush,
    flushAll() { for (const section of new Set([...pending.keys(), ...failed.keys()])) void flush(section); return queue.then(() => !blocked && !failed.size); },
  };
}
