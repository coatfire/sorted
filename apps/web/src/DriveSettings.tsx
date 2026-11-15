import { useEffect, useState } from "react";
import { irelandToday, calendarDaysBetween } from "@sorted/core";
import { Button, Card } from "./components";
import { useData, useSession, useStore } from "./lib/store";

export function DriveSettings() {
  const { user, features } = useData();
  const { mode } = useSession();
  const { backend, toast, refresh } = useStore();
  const [drive, setDrive] = useState<{ requestToken: () => Promise<string>; backUp: typeof import("./lib/driveBackup").backUpToDrive }>();
  const [attempt, setAttempt] = useState(0);
  const [prepareError, setPrepareError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>();
  const last = user.driveBackedUpAt;
  const enabled = mode === "api" && features.googleDrive;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setPrepareError(false);
    Promise.all([backend.health(), import("./lib/driveBackup")]).then(async ([health, module]) => {
      if (!live || !health.features.googleDrive || !health.googleClientId) return;
      const requestToken = await module.prepareDriveBackup(health.googleClientId);
      if (live) setDrive({ requestToken, backUp: module.backUpToDrive });
    }).catch(() => { if (live) setPrepareError(true); });
    return () => { live = false; };
  }, [backend, enabled, attempt]);
  if (!enabled) return null;
  const days = last ? Math.max(0, calendarDaysBetween(irelandToday(new Date(last)), irelandToday())) : null;
  return <section className="settings-section">
    <h2>Back up to Google Drive</h2>
    <Card className="settings-card">
      <p className="sheet-copy">Save your issued invoices, receipts, quotes, expense photos and yearly CSVs in a Sorted folder in your Google Drive. Only when you choose.</p>
      {last && <p className="sheet-copy">Last backed up: {days === 0 ? "today" : `${days} ${days === 1 ? "day" : "days"} ago`}</p>}
      <Button disabled={busy || (!drive && !prepareError)} onClick={async () => {
        if (!drive) { setAttempt((value) => value + 1); return; }
        setBusy(true); setProgress("Connecting to Google…");
        try {
          const result = await drive.backUp(drive.requestToken(), backend, (done, total) => setProgress(`Backing up ${done} of ${total}…`));
          if (result.driveBackedUpAt) { await refresh(); toast("Backup finished"); }
          else toast("No files to back up yet.");
        } catch { toast("Backup didn't finish. Nothing was lost — try again.", "error"); }
        finally { setBusy(false); setProgress(undefined); }
      }}>{busy ? "Backing up…" : drive ? "Back up to Google Drive" : prepareError ? "Try again" : "Getting ready…"}</Button>
      {prepareError && <p className="sheet-copy" role="alert">Backup didn't finish. Nothing was lost — try again.</p>}
      {progress && <p className="sheet-copy" role="status" aria-live="polite">{progress}</p>}
    </Card>
  </section>;
}
