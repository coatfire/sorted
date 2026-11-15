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
  };
}

function createSession(save: (patch: UserChanges) => Promise<void>, refresh: () => Promise<void>, notify: (message: string) => void) {
  let actions = { save, refresh, notify };
  let states: Record<string, SaveState> = {};
  const listeners = new Set<(states: Record<string, SaveState>) => void>();
  const saver = createSettingsAutosave(patch => actions.save(patch), () => actions.refresh(), (section, state) => {
    states = { ...states, [section]: state };
    for (const listener of listeners) listener(states);
    if (state.phase === "error" && !listeners.size) actions.notify(state.committed
      ? "Your Settings changes were saved, but the screen couldn't update. Open Settings and reload."
      : "Some Settings changes couldn't be saved. They're kept in this tab. Open Settings to try again.");
  });
  return {
    saver,
    getStates: () => states,
    configure(nextSave: typeof save, nextRefresh: typeof refresh, nextNotify: typeof notify) { actions = { save: nextSave, refresh: nextRefresh, notify: nextNotify }; },
    subscribe(listener: (states: Record<string, SaveState>) => void) { listeners.add(listener); listener(states); return () => { listeners.delete(listener); }; },
  };
}

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
