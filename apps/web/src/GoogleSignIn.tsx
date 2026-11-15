import { useEffect, useState } from "react";
import { useSession, useStore } from "./lib/store";

export function GoogleSignIn() {
  const { mode } = useSession();
  const { authBackend: backend } = useStore();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (mode) return;
    let active = true;
    backend.health().then(({ features }) => { if (active) setEnabled(features.googleSignIn); }).catch(() => {});
    return () => { active = false; };
  }, [backend, mode]);
  if (mode || !enabled) return null;
  return <button type="button" className="google-sign-in" onClick={() => backend.googleStart()}>
    <img src="/google-g.png" width="20" height="20" alt="" />
    <span>Continue with Google</span>
  </button>;
}
