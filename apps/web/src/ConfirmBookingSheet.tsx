import { useState } from "react";
import { bookingAtDublinTime, CalendarDate, dublinDateTime } from "@sorted/core";
import { Button, Field, Sheet } from "./components";
import type { BookingRow } from "./lib/backend";
import { centsToInput, parseEuros } from "./lib/format";
import { useAction, useStore } from "./lib/store";
import { useValidation } from "./lib/useValidation";

export function ConfirmBookingSheet({ booking, onClose }: { booking: BookingRow; onClose: () => void }) {
  const { backend } = useStore();
  const { busy, committed, error, run } = useAction();
  const existing = booking.startAt ? dublinDateTime(booking.startAt) : null;
  const [date, setDate] = useState(existing?.date ?? "");
  const [time, setTime] = useState(booking.timeTbc ? "" : existing?.time ?? "");
  const [price, setPrice] = useState(centsToInput(booking.priceCents));
  const validation = useValidation({
    date: () => CalendarDate.safeParse(date).success ? undefined : "Add the booking date to confirm.",
    time: () => /^\d{2}:\d{2}$/.test(time) ? undefined : "Add the booking time to confirm.",
    price: () => parseEuros(price) !== null ? undefined : "Add the price to confirm.",
  });
  return <Sheet title="Confirm booking" onClose={onClose}>
    <p className="sheet-copy">Just the missing details, then you’re ready to confirm.</p>
    <form className="action-stack" noValidate onSubmit={async event => {
      event.preventDefault();
      if (busy || committed || !validation.validate(event.currentTarget)) return;
      const priceCents = parseEuros(price);
      if (priceCents === null) return;
      const details = {
        ...(!booking.startAt || booking.timeTbc ? { startAt: bookingAtDublinTime(date, time, booking.startAt ?? undefined).toISOString(), timeTbc: false } : {}),
        ...(booking.priceCents === null ? { priceCents } : {}),
      };
      if (await run(() => backend.confirmBooking(booking.id, details), "Booking confirmed")) onClose();
    }}>
      {!booking.startAt && <Field label="Date" {...validation.field("date")}><input name="date" type="date" required value={date} onChange={event => setDate(event.target.value)} /></Field>}
      {(!booking.startAt || booking.timeTbc) && <Field label="Time" {...validation.field("time")}><input name="time" type="time" required value={time} onChange={event => setTime(event.target.value)} /></Field>}
      {booking.priceCents === null && <Field label="Price (€)" {...validation.field("price")}><input name="price" inputMode="decimal" required value={price} onChange={event => setPrice(event.target.value)} /></Field>}
      {error && <p role="alert" className="sheet-copy">{error}</p>}
      {error && committed && <Button type="button" kind="soft" onClick={() => window.location.reload()}>Reload</Button>}
      <Button type="submit" disabled={busy || committed}>{busy ? "Confirming…" : "Confirm booking"}</Button>
      <Button type="button" kind="quiet" disabled={busy} onClick={onClose}>Close</Button>
    </form>
  </Sheet>;
}
