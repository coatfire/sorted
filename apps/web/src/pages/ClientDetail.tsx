import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { normalisePhone } from "@sorted/core";
import { BackButton, Button, Card, EmptyState, Field, Icon, MoneyText } from "../components";
import { dayMonth, whatsappLink } from "../lib/format";
import { useAction, useData, useStore } from "../lib/store";
import { BookingRow } from "./Home";

export function ClientDetail() {
  const { id } = useParams();
  const { clients, bookings, payments } = useData();
  const { backend } = useStore();
  const { busy, run } = useAction();
  const client = clients.find((item) => item.id === id);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: client?.name ?? "", phone: client?.phone ?? "" });
  const [error, setError] = useState("");

  if (!client) {
    return (
      <div className="page">
        <Card><EmptyState icon="user" title="Client not found" /></Card>
        <Link className="text-link" to="/">Back to today</Link>
      </div>
    );
  }

  const theirs = bookings
    .filter((booking) => booking.clientId === client.id)
    .sort((a, b) => b.startAt.localeCompare(a.startAt));
  const ids = new Set(theirs.map((booking) => booking.id));
  const sum = (status: "paid" | "pending") =>
    payments
      .filter((payment) => ids.has(payment.bookingId) && payment.status === status)
      .reduce((total, payment) => total + payment.amountCents, 0);

  async function save(event: FormEvent) {
    event.preventDefault();
    const phone = form.phone.trim() ? normalisePhone(form.phone) : null;
    if (form.phone.trim() && !phone) {
      return setError("That mobile number doesn’t look right. Try it like 087 123 4567.");
    }
    if (await run(() => backend.updateClient(client!.id, { name: form.name.trim(), phone }), "Client saved")) {
      setEditing(false);
    }
  }

  return (
    <div className="page detail-page">
      <BackButton />
      <div className="detail-hero">
        <div>
          <p className="eyebrow">Client</p>
          <h1>{client.name}</h1>
        </div>
      </div>

      {editing ? (
        <form onSubmit={save}>
          <Card className="form-card">
            <Field label="Name">
              <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <Field label="Mobile" helper="Sorted sends confirmations and reminders to this number.">
              <input
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(event) => { setError(""); setForm({ ...form, phone: event.target.value }); }}
                placeholder="087 123 4567"
              />
            </Field>
            {error && <p className="form-error" role="alert">{error}</p>}
          </Card>
          <div className="action-pair">
            <Button type="button" kind="quiet" onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>Save client</Button>
          </div>
        </form>
      ) : (
        <Card className="detail-card">
          <div className="detail-line">
            <span className="detail-icon"><Icon name="message" /></span>
            <div>
              <strong>{client.phone ?? "No mobile added"}</strong>
              <span>{client.phone ? "Mobile" : "Add one so Sorted can message them for you"}</span>
            </div>
            {client.phone && (
              <a className="chip-link" href={whatsappLink(client.phone, "")} target="_blank" rel="noreferrer">
                WhatsApp
              </a>
            )}
          </div>
          <div className="detail-line">
            <button className="text-link" onClick={() => { setForm({ name: client.name, phone: client.phone ?? "" }); setEditing(true); }}>
              <Icon name="edit" size={16} /> Edit name or mobile
            </button>
          </div>
        </Card>
      )}

      <Card className="year-card">
        <div className="year-stats">
          <div><span>Paid to date</span><MoneyText cents={sum("paid")} /></div>
          <div><span>Owes you</span><MoneyText cents={sum("pending")} className={sum("pending") ? "due-text" : ""} /></div>
        </div>
      </Card>

      <section className="list-section">
        <div className="section-heading">
          <div><p className="eyebrow">History</p><h2>Bookings</h2></div>
          <Link className="text-link" to="/bookings/new"><Icon name="plus" size={16} /> New</Link>
        </div>
        <Card className="list-card">
          {theirs.length ? (
            theirs.map((booking) => (
              <BookingRow key={booking.id} booking={booking} lead={dayMonth(booking.startAt)} />
            ))
          ) : (
            <EmptyState icon="calendar" title="No bookings yet" small />
          )}
        </Card>
      </section>
    </div>
  );
}
