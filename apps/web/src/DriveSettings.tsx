import { useEffect, useState } from "react";
import { irelandToday, calendarDaysBetween } from "@sorted/core";
import { Button, Card } from "./components";
import { useData, useSession, useStore } from "./lib/store";

export function DriveSettings() {
  const { user, features } = useData();
  const { mode } = useSession();
  const { backend, toast } = useStore();
  const [clientId, setClientId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [last, setLast] = useState(user.driveBackedUpAt);
  const enabled = mode === "api" && features.googleDrive;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    backend.health().then((health) => { if (live && health.features.googleDrive) setClientId(health.googleClientId); }).catch(() => {});
    return () => { live = false; };
  }, [backend, enabled]);
  if (!enabled) return null;
  const days = last ? Math.max(0, calendarDaysBetween(irelandToday(new Date(last)), irelandToday())) : null;
  return <section className="settings-section">
    <h2>Back up to Google Drive</h2>
    <Card className="settings-card">
      <p className="sheet-copy">Save your issued invoices, receipts, quotes, expense photos and yearly CSVs in a Sorted folder in your Google Drive. Only when you choose.</p>
      {last && <p className="sheet-copy">Last backed up: {days === 0 ? "today" : `${days} ${days === 1 ? "day" : "days"} ago`}</p>}
      <Button disabled={busy} onClick={async () => {
        setBusy(true); setProgress("Connecting to Google…");
        try {
          const id = clientId ?? (await backend.health()).googleClientId;
          if (!id) throw new Error("Unavailable");
          const { backUpToDrive } = await import("./lib/driveBackup");
          const result = await backUpToDrive(id, backend, (done, total) => setProgress(`Backing up ${done} of ${total}…`));
          if (result.driveBackedUpAt) { setLast(result.driveBackedUpAt); toast("Backup finished"); }
          else toast("No files to back up yet.");
        } catch { toast("Backup didn't finish. Nothing was lost — try again.", "error"); }
        finally { setBusy(false); setProgress(undefined); }
      }}>{busy ? "Backing up…" : "Back up to Google Drive"}</Button>
      {progress && <p className="sheet-copy" role="status" aria-live="polite">{progress}</p>}
    </Card>
  </section>;
}
