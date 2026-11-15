import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { createSettingsAutosave, type SaveState } from "./settingsAutosave";

export function useSettingsAutosave() {
  const { backend, refresh } = useStore();
  const [states, setStates] = useState<Record<string, SaveState>>({});
  const live = useRef(true);
  const store = useRef({ backend, refresh }); store.current = { backend, refresh };
  const saver = useRef<ReturnType<typeof createSettingsAutosave>>();
  saver.current ??= createSettingsAutosave(patch => store.current.backend.updateUser(patch), () => store.current.refresh(true), (section, state) => {
    if (live.current) setStates(current => ({ ...current, [section]: state }));
  });
  useEffect(() => { live.current = true; return () => { live.current = false; void saver.current?.flushAll(); }; }, []);
  return { saver: saver.current, states, blocked: Object.values(states).some(state => state.committed) };
}
