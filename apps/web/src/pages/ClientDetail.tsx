import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { normalisePhone } from "@sorted/core";
import { BackButton, Button, Card, EmptyState, Field, Icon, MoneyText, Sheet } from "../components";
import { dayMonth, whatsappLink } from "../lib/format";
import { useAction, useData, useStore } from "../lib/store";
import { BookingRow } from "./Home";
import { useValidation } from "../lib/useValidation";

export function ClientDetail() {
  const { id } = useParams();
  const { clients, bookings, payments } = useData();
  const { backend } = useStore();
  const { busy, run } = useAction();
  const navigate = useNavigate();
  const client = clients.find((item) => item.id === id);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ name: client?.name ?? "", phone: client?.phone ?? "" });
  const validation = useValidation({
    phone: () => form.phone.trim() && !normalisePhone(form.phone)
      ? "That mobile number doesn’t look right. Try it like 087 123 4567." : undefined,
  });

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
  const hasPaid = payments.some((payment) => ids.has(payment.bookingId) && payment.status === "paid");
  const hasOpenBookings = theirs.some((booking) => booking.status === "enquiry" || booking.status === "confirmed");
  const sum = (status: "paid" | "pending") =>
    payments
      .filter((payment) => ids.has(payment.bookingId) && payment.status === status)
      .reduce((total, payment) => total + payment.amountCents, 0);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validation.validate(event.currentTarget)) return;
    const phone = form.phone.trim() ? normalisePhone(form.phone) : null;
    if (await run(() => backend.updateClient(client!.id, { name: form.name.trim(), phone }), "Client saved")) {
      setEditing(false);
    }
  }

  async function remove() {
    if (await run(() => backend.deleteClient(client!.id), hasPaid ? "Client anonymised" : "Client deleted")) {
      navigate("/", { replace: true });
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
        <form onSubmit={save} noValidate>
          <Card className="form-card">
            <Field label="Name" {...validation.field("name")}>
              <input name="name" required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <Field label="Mobile" helper="Sorted sends confirmations and reminders to this number." {...validation.field("phone")}>
              <input
                type="tel"
                inputMode="tel"
                value={form.phone}
                name="phone"
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                placeholder="087 123 4567"
              />
            </Field>
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
            <button className="text-link" onClick={() => { validation.clear(); setForm({ name: client.name, phone: client.phone ?? "" }); setEditing(true); }}>
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
      <Button kind="danger" onClick={() => setDeleting(true)}>
        <Icon name="trash" /> Delete client
      </Button>
      {deleting && (
        <Sheet title="Delete client?" onClose={() => setDeleting(false)}>
          {hasOpenBookings ? (
            <p>Cancel or complete their open bookings first.</p>
          ) : hasPaid ? (
            <p>This client has paid payments. Their name will become “Deleted client”. Their phone, email and notes, messages, and booking notes and locations will be removed. Bookings and payments will be kept for your tax records. Receipts won’t be changed. This can’t be undone.</p>
          ) : (
            <p>This client has no paid payments. The client, all their messages, payments and bookings will be permanently deleted. Receipts won’t be changed. This can’t be undone.</p>
          )}
          {!hasOpenBookings && (
            <Button kind="danger" disabled={busy} onClick={remove}>
              {busy ? "Removing…" : hasPaid ? "Remove personal data" : "Delete client"}
            </Button>
          )}
          <Button kind="quiet" onClick={() => setDeleting(false)}>Cancel</Button>
        </Sheet>
      )}
    </div>
  );
}
