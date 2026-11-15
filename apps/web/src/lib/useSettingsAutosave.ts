import { useEffect, useState } from "react";
import { useData, useSession, useStore } from "./store";
import { session as authSession } from "./api";
import { createSettingsAutosaveRegistry, watchSettingsAutosave } from "./settingsAutosaveSession";

const registry = createSettingsAutosaveRegistry();

export function useSettingsAutosave() {
  const { backend, refresh, toast } = useStore();
  const { user } = useData();
  const { mode } = useSession();
  const token = mode === "api" ? authSession.get() : null;
  const session = registry.get(backend, user.id, async patch => {
    if (mode === "api" && authSession.get() !== token) throw new Error("Sign back in before saving Settings.");
    await backend.updateUser(patch);
  }, () => refresh(true), message => toast(message, "error"));
  const [states, setStates] = useState(session.getStates);
  useEffect(() => watchSettingsAutosave(session, setStates, window, document), [session]);
  return { saver: session.saver, restoredChanges: session.saver.getChanges(), states, blocked: Object.values(states).some(state => state.committed) };
}
