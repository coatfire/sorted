import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isNetworkError, session } from "./api";
import { apiBackend } from "./apiBackend";
import type { Backend, Snapshot } from "./backend";
import { demoBackend, resetDemo } from "./demoBackend";

type Mode = "api" | "demo";
const MODE_KEY = "sorted_mode";
const CACHE_KEY = "sorted_last_snapshot";

const initialMode = (): Mode | null =>
  session.get() ? "api" : localStorage.getItem(MODE_KEY) === "demo" ? "demo" : null;

interface SessionValue {
  mode: Mode | null;
  signIn: (jwt: string) => void;
  startDemo: () => void;
  signOut: () => void;
}

interface DataValue {
  data: Snapshot | null;
  /** First load failed and there is nothing cached to show. */
  loadError: string | null;
  /** Showing the last snapshot we managed to load (offline / API down). */
  stale: boolean;
  backend: Backend;
  refresh: () => Promise<void>;
  resetDemo: () => Promise<void>;
  toast: (message: string, tone?: "ok" | "error") => void;
}

const SessionContext = createContext<SessionValue | null>(null);
const DataContext = createContext<DataValue | null>(null);

function readCache(): Snapshot | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Snapshot | null;
  } catch {
    return null;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode | null>(initialMode);
  const [data, setData] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [toastState, setToast] = useState<{ message: string; tone: "ok" | "error"; key: number } | null>(null);
  const backend = mode === "demo" ? demoBackend : apiBackend;
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (!mode) return;
    const mine = ++generation.current;
    try {
      const snapshot = await backend.load();
      if (mine !== generation.current) return; // a newer load superseded this one
      setData(snapshot);
      setLoadError(null);
      setStale(false);
      if (mode === "api") {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot));
        } catch {
          /* cache is best-effort */
        }
      }
    } catch (err) {
      if (mine !== generation.current) return;
      const cached = mode === "api" && isNetworkError(err) ? readCache() : null;
      if (cached) {
        setData((current) => current ?? cached);
        setStale(true);
      } else {
        setLoadError(err instanceof Error ? err.message : "Couldn't load your data.");
      }
    }
  }, [backend, mode]);

  useEffect(() => {
    setData(null);
    setLoadError(null);
    setStale(false);
    void refresh();
  }, [refresh]);

  // Come back online / back to the tab → make sure what's on screen is current.
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [refresh]);

  useEffect(() => {
    if (!toastState) return;
    const timer = setTimeout(() => setToast(null), toastState.tone === "error" ? 5000 : 2600);
    return () => clearTimeout(timer);
  }, [toastState]);

  const sessionValue = useMemo<SessionValue>(
    () => ({
      mode,
      signIn(jwt) {
        session.set(jwt);
        localStorage.removeItem(MODE_KEY);
        setMode("api");
      },
      startDemo() {
        localStorage.setItem(MODE_KEY, "demo");
        setMode("demo");
      },
      signOut() {
        session.clear();
        localStorage.removeItem(MODE_KEY);
        localStorage.removeItem(CACHE_KEY);
        setMode(null);
      },
    }),
    [mode],
  );

  const dataValue = useMemo<DataValue>(
    () => ({
      data,
      loadError,
      stale,
      backend,
      refresh,
      async resetDemo() {
        resetDemo();
        await refresh();
      },
      toast: (message, tone = "ok") => setToast({ message, tone, key: Date.now() }),
    }),
    [backend, data, loadError, refresh, stale],
  );

  return (
    <SessionContext.Provider value={sessionValue}>
      <DataContext.Provider value={dataValue}>
        {children}
        {toastState && (
          <div
            key={toastState.key}
            className={`toast toast-${toastState.tone}`}
            role={toastState.tone === "error" ? "alert" : "status"}
          >
            {toastState.message}
          </div>
        )}
      </DataContext.Provider>
    </SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside StoreProvider");
  return value;
}

export function useStore() {
  const value = useContext(DataContext);
  if (!value) throw new Error("useStore must be used inside StoreProvider");
  return value;
}

/** Loaded data for pages rendered inside AppShell (which waits for it). */
export function useData(): Snapshot {
  const { data } = useStore();
  if (!data) throw new Error("useData used before data loaded");
  return data;
}

/**
 * Run a mutation: disables the UI while it's in flight, reloads data after,
 * and says what happened in a toast. Returns true on success.
 */
export function useAction() {
  const { refresh, toast } = useStore();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (work: () => Promise<unknown>, done?: string) => {
      setBusy(true);
      try {
        await work();
        await refresh();
        if (done) toast(done);
        return true;
      } catch (err) {
        toast(
          isNetworkError(err)
            ? "You're offline — that didn't save. Try again when you're connected."
            : err instanceof Error
              ? err.message
              : "That didn't work. Try again.",
          "error",
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh, toast],
  );
  return { busy, run };
}
