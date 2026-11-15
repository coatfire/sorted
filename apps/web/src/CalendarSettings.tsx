import { useEffect, useState } from "react";
import type { CalendarLinks } from "@sorted/core";
import { Button, Card, Sheet } from "./components";
import { useAction, useSession, useStore } from "./lib/store";

export function CalendarSettings() {
  const { backend } = useStore();
  const { mode } = useSession();
  const { busy, run } = useAction();
  const [links, setLinks] = useState<CalendarLinks | null>(null);
  const [error, setError] = useState(false);
  const [reset, setReset] = useState(false);
  useEffect(() => {
    if (mode !== "api") return;
    let live = true;
    backend.calendar().then((result) => { if (live) setLinks(result); }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [backend, mode]);
  return <section className="settings-section">
    <h2>Add bookings to your calendar</h2>
    <p className="sheet-copy">Keep these links private — they include your clients’ booking details.</p>
    {mode === "demo" && <p className="sheet-copy">Available when you sign in</p>}
    {(["confirmed", "enquiries"] as const).map((kind) => <Card className="settings-card" key={kind}>
      <h3>{kind === "confirmed" ? "Confirmed" : "Enquiries"}</h3>
      <div className="action-pair">
        {links ? <>
          <a className="button button-soft" href={links[kind].webcal}>iPhone / Mac</a>
          <a className="button button-soft" href={links[kind].google} target="_blank" rel="noreferrer">Google</a>
        </> : <><Button kind="soft" disabled>iPhone / Mac</Button><Button kind="soft" disabled>Google</Button></>}
      </div>
    </Card>)}
    <p className="sheet-copy">Pick a colour for each calendar in your calendar app. Changes can take a few hours to show in Google.</p>
    {mode === "api" && !links && <p className="sheet-copy" role="status">{error ? "Couldn't load your calendar links." : "Loading your calendar links…"}</p>}
    {error && <Button kind="quiet" disabled={busy} onClick={() => run(async () => { setLinks(await backend.calendar()); setError(false); })}>Try again</Button>}
    <Button kind="quiet" disabled={!links || busy} onClick={() => setReset(true)}>Reset links</Button>
    {reset && <Sheet title="Reset calendar links?" onClose={() => setReset(false)}>
      <p className="sheet-copy">Old links will stop working. Add the new links to your calendar app afterwards.</p>
      <Button kind="danger" disabled={busy} onClick={async () => {
        if (await run(async () => { setLinks(await backend.resetCalendar()); }, "Calendar links reset")) setReset(false);
      }}>Reset links</Button>
      <Button kind="quiet" disabled={busy} onClick={() => setReset(false)}>Keep current links</Button>
    </Sheet>}
  </section>;
}
