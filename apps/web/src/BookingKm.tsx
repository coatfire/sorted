import { useState, type FormEvent } from "react";
import { kmInput, kmLabel, lastTravelTo, parseKm } from "@sorted/core";
import { Button, Field, Icon, Sheet } from "./components";
import type { BookingRow } from "./lib/backend";
import { useAction, useData, useStore } from "./lib/store";

/** The km for a job, on the booking page. It can be added at any stage, since the real distance is often known afterwards. */
export function BookingKm({ booking }: { booking: BookingRow }) {
  const { bookings } = useData();
  const { backend } = useStore();
  const { busy, run, error } = useAction();
  const [open, setOpen] = useState(false);
  const [km, setKm] = useState("");
  const [invalid, setInvalid] = useState(false);
  const lastTime = booking.travelMetres ? null : lastTravelTo(bookings, booking.location ?? "");

  function show() {
    setKm(kmInput(booking.travelMetres ?? lastTime));
    setInvalid(false);
    setOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const metres = parseKm(km);
    if (!metres) { setInvalid(true); return; }
    if (await run(() => backend.bookingTravel(booking.id, metres), "Km saved")) setOpen(false);
  }

  return (
    <>
      <div className="detail-line">
        <span className="detail-icon"><Icon name="map" /></span>
        <button type="button" className="detail-link km-link" onClick={show}>
          <strong>{booking.travelMetres ? `${kmLabel(booking.travelMetres)} there and back` : "Add km"}</strong>
          <span>{booking.travelMetres ? "Change km" : "For your mileage log"}</span>
        </button>
      </div>
      {open && (
        <Sheet title="Km for this job" onClose={() => setOpen(false)}>
          {error && <p className="sheet-copy" role="alert">{error}</p>}
          <form onSubmit={save} noValidate>
            <Field
              label="Km there and back"
              helper={lastTime ? "From your last job at this address. Change it if it was different." : "From where you set out, to the job and back again."}
              error={invalid ? "Enter the km as a number, like 24 or 24.5." : undefined}
            >
              <input name="km" autoFocus inputMode="decimal" value={km} onChange={(event) => { setKm(event.target.value); setInvalid(false); }} placeholder="e.g. 24" />
            </Field>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save km"}</Button>
            {booking.travelMetres != null && (
              <Button type="button" kind="quiet" disabled={busy} onClick={async () => {
                if (await run(() => backend.bookingTravel(booking.id, null), "Km removed")) setOpen(false);
              }}>Remove km</Button>
            )}
          </form>
        </Sheet>
      )}
    </>
  );
}
