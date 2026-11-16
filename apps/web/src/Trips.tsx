import { useState, type FormEvent } from "react";
import { irelandToday, kmInput, kmLabel, mileageLog, mileageMetres, parseKm, yearRange, type Trip } from "@sorted/core";
import { Button, Card, EmptyState, Field, Icon, Sheet } from "./components";
import { dayMonth } from "./lib/format";
import { useAction, useData, useStore } from "./lib/store";

/** Business trips that aren't bookings, listed on Expenses. Km only: they never count as an expense. */
export function TripList({ onOpen }: { onOpen: (trip: Trip) => void }) {
  const { bookings, trips } = useData();
  const today = irelandToday();
  const year = Number(today.slice(0, 4));
  const yearMetres = mileageMetres(mileageLog(bookings, trips, yearRange(year), today));
  const listed = [...trips].sort((a, b) => b.tripDate.localeCompare(a.tripDate) || b.createdAt.localeCompare(a.createdAt));
  return (
    <section className="list-section">
      <div className="section-heading">
        <div><p className="eyebrow">Mileage</p><h2>Your trips</h2></div>
        {yearMetres > 0 && <span className="expected-total">{kmLabel(yearMetres)} in {year}</span>}
      </div>
      <Card className="expense-list">
        {listed.length ? listed.map((trip) => (
          <div key={trip.id}>
            <button className="expense-row" onClick={() => onOpen(trip)}>
              <span className="expense-icon"><Icon name="map" /></span>
              <div>
                <strong>{trip.destination}</strong>
                <span>{trip.purpose} · {dayMonth(`${trip.tripDate}T12:00:00Z`)}</span>
              </div>
              <span className="trip-km">{kmLabel(trip.travelMetres)}</span>
            </button>
          </div>
        )) : (
          <EmptyState icon="map" title="No trips yet" small>
            Add a trip for business driving that isn’t a booking, like a run to the wholesaler.
          </EmptyState>
        )}
      </Card>
      <p className="field-helper trip-note">
        Km for a job goes on the booking itself{yearMetres > 0 ? `, and is included in the ${year} figure above` : ""}. Km is kept for your accountant and is never added to your expenses.
      </p>
    </section>
  );
}

export function TripSheet({ trip, onClose }: { trip: Trip | "new"; onClose: () => void }) {
  const { backend } = useStore();
  const { busy, run, error } = useAction();
  const editing = trip === "new" ? null : trip;
  const today = irelandToday();
  const [form, setForm] = useState({
    date: editing?.tripDate ?? today, destination: editing?.destination ?? "", purpose: editing?.purpose ?? "", km: kmInput(editing?.travelMetres),
  });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const metres = parseKm(form.km);
    const found = {
      date: !form.date ? "Add the date of the trip." : form.date > today ? "A trip can’t be in the future." : undefined,
      destination: !form.destination.trim() ? "Add where you went." : undefined,
      purpose: !form.purpose.trim() ? "Add what the trip was for." : undefined,
      km: !metres ? "Enter the km as a number, like 24 or 24.5." : undefined,
    };
    setErrors(found);
    if (!metres || Object.values(found).some(Boolean)) return;
    const draft = { tripDate: form.date, destination: form.destination.trim(), purpose: form.purpose.trim(), travelMetres: metres };
    if (await run(() => editing ? backend.updateTrip(editing.id, draft) : backend.createTrip(draft), editing ? "Trip updated" : "Trip saved")) onClose();
  }

  if (confirmDelete && editing) {
    return (
      <Sheet title="Delete this trip?" onClose={() => setConfirmDelete(false)}>
        <p className="sheet-copy">{editing.destination} · {kmLabel(editing.travelMetres)}. It comes out of your km total and export.</p>
        <Button kind="danger" disabled={busy} onClick={async () => { if (await run(() => backend.deleteTrip(editing.id), "Trip deleted")) onClose(); }}>Delete trip</Button>
        <Button kind="quiet" onClick={() => setConfirmDelete(false)}>Keep it</Button>
      </Sheet>
    );
  }

  return (
    <Sheet title={editing ? "Edit trip" : "Add a trip"} onClose={onClose}>
      {error && <p className="sheet-copy" role="alert">{error}</p>}
      {!editing && <p className="sheet-copy">For business driving that isn’t a booking. Km for a job goes on the booking.</p>}
      <form onSubmit={save} noValidate>
        <Field label="Date" error={errors.date}>
          <input name="date" type="date" max={today} value={form.date} onChange={(event) => set("date", event.target.value)} />
        </Field>
        <Field label="Where to" error={errors.destination}>
          <input name="destination" autoFocus={!editing} maxLength={500} value={form.destination} onChange={(event) => set("destination", event.target.value)} placeholder="e.g. Salon Services, Cork" />
        </Field>
        <Field label="What for" error={errors.purpose}>
          <input name="purpose" maxLength={200} value={form.purpose} onChange={(event) => set("purpose", event.target.value)} placeholder="e.g. Stock from the wholesaler" />
        </Field>
        <Field label="Km there and back" error={errors.km}>
          <input name="km" inputMode="decimal" value={form.km} onChange={(event) => set("km", event.target.value)} placeholder="e.g. 24" />
        </Field>
        <Button type="submit" disabled={busy}><Icon name="check" /> {busy ? "Saving…" : editing ? "Save changes" : "Save trip"}</Button>
        <div className="form-footer">
          <button type="button" className="text-link" onClick={onClose}>{editing ? "Close" : "Discard"}</button>
          {editing && <button type="button" className="text-link danger" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={16} /> Delete</button>}
        </div>
      </form>
    </Sheet>
  );
}
