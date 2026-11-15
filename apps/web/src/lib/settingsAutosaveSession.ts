import { createSettingsAutosave, type SaveState, type UserChanges } from "./settingsAutosave";

export function createSettingsAutosaveRegistry() {
  const owners = new WeakMap<object, Map<string, ReturnType<typeof createSession>>>();
  return {
    get(owner: object, userId: string, save: (patch: UserChanges) => Promise<void>, refresh: () => Promise<void>, notify: (message: string) => void) {
      const sessions = owners.get(owner) ?? new Map<string, ReturnType<typeof createSession>>();
      owners.set(owner, sessions);
      let session = sessions.get(userId);
      if (!session) { session = createSession(save, refresh, notify); sessions.set(userId, session); }
      session.configure(save, refresh, notify);
      return session;
    },
    notifySaved(owner: object, userId: string, patch: UserChanges) {
      owners.get(owner)?.get(userId)?.savedElsewhere(patch);
    },
  };
}

function createSession(save: (patch: UserChanges) => Promise<void>, refresh: () => Promise<void>, notify: (message: string) => void) {
  let actions = { save, refresh, notify };
  let states: Record<string, SaveState> = {};
  const listeners = new Set<(states: Record<string, SaveState>) => void>();
  const ownWrites = new Set<UserChanges>();
  const saver = createSettingsAutosave(async patch => {
    ownWrites.add(patch);
    try { await actions.save(patch); }
    finally { ownWrites.delete(patch); }
  }, () => actions.refresh(), (section, state) => {
    states = { ...states, [section]: state };
    for (const listener of listeners) listener(states);
    if (state.phase === "error" && !listeners.size) actions.notify(state.committed
      ? "Your Settings changes were saved, but the screen couldn't update. Open Settings and reload."
      : "Some Settings changes couldn't be saved. They're kept in this tab. Open Settings to try again.");
  });
  return {
    saver,
    savedElsewhere(patch: UserChanges) {
      if (!ownWrites.has(patch)) saver.discardSuperseded(Object.entries(patch).filter(([, value]) => value !== undefined).map(([key]) => key as keyof UserChanges));
    },
    getStates: () => states,
    configure(nextSave: typeof save, nextRefresh: typeof refresh, nextNotify: typeof notify) { actions = { save: nextSave, refresh: nextRefresh, notify: nextNotify }; },
    subscribe(listener: (states: Record<string, SaveState>) => void) { listeners.add(listener); listener(states); return () => { listeners.delete(listener); }; },
  };
}

export const settingsAutosaveRegistry = createSettingsAutosaveRegistry();

export function watchSettingsAutosave(session: ReturnType<ReturnType<typeof createSettingsAutosaveRegistry>["get"]>, listener: (states: Record<string, SaveState>) => void, page: EventTarget, document: EventTarget & { visibilityState: string }) {
  const unsubscribe = session.subscribe(listener);
  const flush = () => { void session.saver.flushAll(); };
  const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
  page.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", onVisibility);
  flush();
  return () => {
    unsubscribe();
    page.removeEventListener("pagehide", flush);
    document.removeEventListener("visibilitychange", onVisibility);
    flush();
  };
}
