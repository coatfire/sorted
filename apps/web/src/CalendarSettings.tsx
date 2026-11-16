import { useEffect, useState } from "react";
import { externalCalendarLabel, EXTERNAL_CALENDAR_LIMIT, type CalendarLinks, type ExternalCalendar } from "@sorted/core";
import { Button, Card, Field, Sheet } from "./components";
import { useAction, useSession, useStore } from "./lib/store";

/** The trader's own Google/Apple calendars, read for grey Busy blocks on the Calendar screen. */
export function ExternalCalendars() {
  const { backend } = useStore();
  const { mode } = useSession();
  const { busy, error, run } = useAction();
  const [calendars, setCalendars] = useState<ExternalCalendar[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [url, setUrl] = useState("");
  useEffect(() => {
    let live = true;
    backend.externalCalendars().then((result) => { if (live) setCalendars(result); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [backend]);
  const full = (calendars?.length ?? 0) >= EXTERNAL_CALENDAR_LIMIT;
  return <section className="settings-section">
    <h2>See your own calendar in Sorted</h2>
    <p className="sheet-copy">Paste a private link to your Google or Apple calendar. Its entries show on the Calendar screen as grey Busy blocks, so you don’t double-book.</p>
    <p className="sheet-copy">Sorted only reads them. It never changes your calendar, and they never change a booking.</p>
    <Card className="settings-card">
      {calendars?.map((calendar) => <div className="external-calendar" key={calendar.id}>
        <strong>{externalCalendarLabel(calendar.provider)} calendar{mode === "demo" ? " (sample)" : ""}</strong>
        {mode === "api" && <Button kind="quiet" disabled={busy} onClick={() => run(async () => {
          await backend.removeExternalCalendar(calendar.id);
          setCalendars((current) => current?.filter((item) => item.id !== calendar.id) ?? null);
        }, "Calendar removed")}>Remove</Button>}
      </div>)}
      {calendars?.length === 0 && <p className="sheet-copy">No calendar added yet.</p>}
      {!calendars && <p className="sheet-copy" role="status">{failed ? "Couldn't load your calendars." : "Loading your calendars…"}</p>}
      {mode === "demo" ? <p className="sheet-copy">Add your own when you sign in</p> : <form onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const added = await backend.addExternalCalendar(url);
          setCalendars((current) => [...(current ?? []).filter((item) => item.id !== added.id), added]);
          setUrl("");
        }, "Calendar added");
      }}>
        <Field label="Private calendar link" error={error ?? undefined} helper={full ? `You can add up to ${EXTERNAL_CALENDAR_LIMIT}. Remove one first.` : undefined}>
          <input name="externalCalendarUrl" type="url" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="https://calendar.google.com/calendar/ical/…"
            value={url} onChange={(event) => setUrl(event.target.value)} disabled={full || !calendars} />
        </Field>
        <Button type="submit" kind="soft" disabled={busy || full || !calendars || !url.trim()}>Add calendar</Button>
      </form>}
    </Card>
    <details className="tax-workings">
      <summary>Where do I find the link?</summary>
      <p className="sheet-copy"><strong>Google:</strong> on a computer, open Google Calendar, then Settings, then your calendar. Copy “Secret address in iCal format”.</p>
      <p className="sheet-copy"><strong>Apple:</strong> in the Calendar app, tap Calendars, then the info button beside your calendar. Turn on Public Calendar and tap Share Link to copy it. Anyone with that link can see the calendar, so keep it to yourself.</p>
    </details>
  </section>;
}

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
          <a className="button button-primary" href={links[kind].webcal}>Add to phone calendar</a>
          <a className="button button-soft" href={links[kind].google} target="_blank" rel="noreferrer">Google Calendar (web)</a>
        </> : <><Button disabled>Add to phone calendar</Button><Button kind="soft" disabled>Google Calendar (web)</Button></>}
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
