import { useEffect, useState } from "react";
import { irelandToday, calendarDaysBetween } from "@sorted/core";
import { Button, Card } from "./components";
import { useData, useSession, useStore } from "./lib/store";
import { DriveError, driveErrorMessage } from "./lib/driveErrors";

export function DriveSettings() {
  const { user, features } = useData();
  const { mode } = useSession();
  const { backend, toast, patchUser } = useStore();
  const [drive, setDrive] = useState<{ requestToken: () => Promise<string>; backUp: typeof import("./lib/driveBackup").backUpToDrive }>();
  const [attempt, setAttempt] = useState(0);
  const [prepareError, setPrepareError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>();
  const last = user.driveBackedUpAt;
  const enabled = mode === "api" && features.googleDrive;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setPrepareError(undefined);
    Promise.all([backend.health(), import("./lib/driveBackup")]).then(async ([health, module]) => {
      if (!live) return;
      if (!health.features.googleDrive || !health.googleClientId) throw new DriveError("not_configured");
      const requestToken = await module.prepareDriveBackup(health.googleClientId);
      if (live) setDrive({ requestToken, backUp: module.backUpToDrive });
    }).catch(error => { if (live) setPrepareError(driveErrorMessage(error)); });
    return () => { live = false; };
  }, [backend, enabled, attempt]);
  if (!enabled) return null;
  const days = last ? Math.max(0, calendarDaysBetween(irelandToday(new Date(last)), irelandToday())) : null;
  return <section className="settings-section">
    <h2>Save a copy to Google Drive</h2>
    <Card className="settings-card">
      <p className="sheet-copy">Keep a copy of your issued invoices, receipts, quotes, expense photos and yearly money files in a Sorted folder in your Google Drive. Only when you choose — never automatically.</p>
      {last && <p className="sheet-copy">Last copy saved: {days === 0 ? "today" : `${days} ${days === 1 ? "day" : "days"} ago`}</p>}
      <Button disabled={busy || (!drive && !prepareError)} onClick={async () => {
        if (!drive) { setAttempt((value) => value + 1); return; }
        setBusy(true); setSaveError(undefined); setProgress("Opening Google…");
        try {
          const result = await drive.backUp(drive.requestToken(), backend, (done, total) => setProgress(`Saving ${done} of ${total}…`));
          if (result.driveBackedUpAt) { patchUser(user.id, { driveBackedUpAt: result.driveBackedUpAt }); toast("Copy saved to Google Drive"); }
          else toast("No files to save yet.");
        } catch (error) { setSaveError(driveErrorMessage(error)); }
        finally { setBusy(false); setProgress(undefined); }
      }}>{busy ? "Saving your copy…" : drive ? "Save a copy to Google Drive" : prepareError ? "Try again" : "Getting ready…"}</Button>
      {(prepareError || saveError) && <p className="sheet-copy" role="alert">{prepareError || saveError}</p>}
      {progress && <p className="sheet-copy" role="status" aria-live="polite">{progress}</p>}
    </Card>
  </section>;
}
