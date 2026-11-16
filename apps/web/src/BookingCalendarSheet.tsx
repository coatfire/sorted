import { useState } from "react";
import { buildCalendar, googleCalendarEventUrl } from "@sorted/core";
import { Button, Sheet } from "./components";
import type { BookingRow } from "./lib/backend";
import { download } from "./lib/image";
import { useStore } from "./lib/store";

export function BookingCalendarSheet({ booking, onClose }: { booking: BookingRow; onClose: () => void }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const appUrl = window.location.origin;
  return <Sheet title="Add to calendar" onClose={onClose}>
    <p className="sheet-copy">Add this booking to your calendar. For automatic updates, add a calendar in Settings instead.</p>
    <Button disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const content = buildCalendar({ bookings: [booking], name: "Sorted", appUrl });
        const file = new File([content], `booking-${booking.id}.ics`, { type: "text/calendar;charset=utf-8" });
        download(file, file.name);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) toast("Couldn't open the calendar file. Try again.", "error");
      } finally { setBusy(false); }
    }}>Add to phone calendar</Button>
    <a className="button button-soft" href={googleCalendarEventUrl(booking, appUrl)} target="_blank" rel="noreferrer">Google Calendar (web)</a>
    <Button kind="quiet" onClick={onClose}>Done</Button>
  </Sheet>;
}
