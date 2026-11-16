import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { documentNumber, moneyOwed, normaliseClientPhone, UpdateClientInput, type IssuedDocument } from "@sorted/core";
import { BackButton, Button, Card, EmptyState, Field, Icon, MoneyText, Sheet } from "../components";
import { dayMonth, formatPhone, whatsappLink } from "../lib/format";
import { useAction, useData, useStore } from "../lib/store";
import { BookingRow } from "./Home";
import { useValidation } from "../lib/useValidation";
import { useNow } from "../lib/useNow";
import { DocumentSendSheet } from "../DocumentSendSheet";
import { buildDocumentFile, shareOrDownload } from "../lib/documentFile";

const DOCUMENT_TITLE = { invoice: "Invoice", receipt: "Receipt", quote: "Quote" } as const;

export function ClientDetail() {
  const now = useNow();
  const { id } = useParams();
  const { clients, bookings, payments, documents, user } = useData();
  const { backend, toast } = useStore();
  const [sending, setSending] = useState<IssuedDocument | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const { busy, run } = useAction();
  const navigate = useNavigate();
  const client = clients.find((item) => item.id === id);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ name: client?.name ?? "", phone: formatPhone(client?.phone), email: client?.email ?? "", notes: client?.notes ?? "" });
  const validation = useValidation({
    email: () => form.email.trim() && !UpdateClientInput.shape.email.safeParse(form.email.trim()).success
      ? "Enter a valid email address." : undefined,
    phone: () => form.phone.trim() && !normaliseClientPhone(form.phone)
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
    .sort((a, b) => (b.startAt ?? "").localeCompare(a.startAt ?? ""));
  const ids = new Set(theirs.map((booking) => booking.id));
  const issued = documents.flatMap((document) => {
    const booking = theirs.find((item) => item.id === document.bookingId);
    return booking ? [{ document, booking }] : [];
  });
  const sendingBooking = sending && theirs.find((booking) => booking.id === sending.bookingId);
  async function open(document: IssuedDocument) {
    const booking = theirs.find((item) => item.id === document.bookingId);
    if (!booking || opening) return;
    setOpening(document.id);
    try {
      const outcome = await shareOrDownload(await buildDocumentFile(backend, user, booking, payments, document.kind, document.paymentId ?? undefined));
      if (outcome === "downloaded") toast("PDF downloaded");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't create that PDF. Try again.", "error");
    } finally { setOpening(null); }
  }
  const hasPaymentHistory = payments.some((payment) => ids.has(payment.bookingId) && (payment.status === "paid" || payment.paidAt !== null));
  const hasOpenBookings = theirs.some((booking) => booking.status === "enquiry" || booking.status === "confirmed");
  const { dueNowCents, comingUpCents } = moneyOwed(theirs, payments, now);
  const paidToDate =
    payments
      .filter((payment) => ids.has(payment.bookingId) && payment.status === "paid")
      .reduce((total, payment) => total + payment.amountCents, 0);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validation.validate(event.currentTarget)) return;
    const phone = form.phone.trim() ? normaliseClientPhone(form.phone) : null;
    if (await run(() => backend.updateClient(client!.id, { name: form.name.trim(), phone, email: form.email.trim() || null, notes: form.notes.trim() || null }), "Client saved")) {
      setEditing(false);
    }
  }

  async function remove() {
    if (await run(() => backend.deleteClient(client!.id), hasPaymentHistory ? "Client anonymised" : "Client deleted")) {
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
            <Field label="Mobile" helper="For WhatsApp drafts you send yourself." {...validation.field("phone")}>
              <input
                type="tel"
                inputMode="tel"
                value={form.phone}
                name="phone"
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                placeholder="087 123 4567"
              />
            </Field>
            <Field label="Email (optional)" {...validation.field("email")}>
              <input name="email" type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </Field>
            <Field label="Notes (optional)" helper="Only you see these.">
              <textarea name="notes" rows={3} maxLength={2000} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
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
              <strong>{formatPhone(client.phone) || "No mobile added"}</strong>
              <span>{client.phone ? "Mobile" : "Add one to open WhatsApp drafts"}</span>
            </div>
            {client.phone && (
              <a className="chip-link" href={whatsappLink(client.phone, "")} target="_blank" rel="noreferrer">
                WhatsApp
              </a>
            )}
          </div>
          <div className="detail-line">
            <div><strong>{client.email ?? "No email added"}</strong><span>Email</span></div>
          </div>
          {client.notes && <div className="detail-line">
            <div><strong className="client-notes">{client.notes}</strong><span>Notes</span></div>
          </div>}
          <div className="detail-line">
            <button className="text-link" onClick={() => { validation.clear(); setForm({ name: client.name, phone: formatPhone(client.phone), email: client.email ?? "", notes: client.notes ?? "" }); setEditing(true); }}>
              <Icon name="edit" size={16} /> Edit client details
            </button>
          </div>
        </Card>
      )}

      <Card className="year-card">
        <div className="year-stats">
          <div><span>Paid to date</span><MoneyText cents={paidToDate} /></div>
          <div><span>Owes you now</span><MoneyText cents={dueNowCents} className={dueNowCents ? "due-text" : ""} /></div>
          {comingUpCents > 0 && <div className="wide-stat"><span>Coming up, for future jobs</span><MoneyText cents={comingUpCents} /></div>}
        </div>
      </Card>

      {issued.length > 0 && (
        <section className="list-section">
          <div className="section-heading">
            <div><p className="eyebrow">Issued</p><h2>Invoices &amp; receipts</h2></div>
          </div>
          <Card className="list-card">
            {issued.map(({ document, booking }) => {
              const number = documentNumber(document.kind, document.number);
              return (
                <div className="document-row" key={document.id}>
                  <button type="button" className="document-open" disabled={opening !== null} onClick={() => { void open(document); }} aria-label={`Open ${DOCUMENT_TITLE[document.kind].toLowerCase()} ${number}`}>
                    <span className="row-icon"><Icon name="receipt" size={18} /></span>
                    <span>
                      <strong>{DOCUMENT_TITLE[document.kind]} {number}</strong>
                      <small>{booking.service} · {dayMonth(document.issuedAt)}</small>
                      <small className={`document-status${document.voidedAt || document.sentAt ? "" : " is-unsent"}`}>{document.voidedAt ? "Void" : document.sentAt ? `Sent ${dayMonth(document.sentAt)}` : "Not sent yet"}</small>
                    </span>
                  </button>
                  {!document.voidedAt && <Button kind={document.sentAt ? "quiet" : "soft"} onClick={() => setSending(document)}>{document.sentAt ? "Send again" : "Send"}</Button>}
                </div>
              );
            })}
          </Card>
        </section>
      )}

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
      {sending && sendingBooking && <DocumentSendSheet document={sending} booking={sendingBooking} onClose={() => setSending(null)} />}
      {deleting && (
        <Sheet title="Delete client?" onClose={() => setDeleting(false)}>
          {hasOpenBookings ? (
            <p>Cancel or complete their open bookings first.</p>
          ) : hasPaymentHistory ? (
            <p>This client has payment records. Their name will become “Deleted client”. Their phone, email and notes, messages, and booking notes and locations will be removed. Bookings and payments will be kept for your tax records. Receipts won’t be changed. This can’t be undone.</p>
          ) : (
            <p>This client has no paid payments. The client, all their messages, payments and bookings will be permanently deleted. Receipts won’t be changed. This can’t be undone.</p>
          )}
          {!hasOpenBookings && (
            <Button kind="danger" disabled={busy} onClick={remove}>
              {busy ? "Removing…" : hasPaymentHistory ? "Remove personal data" : "Delete client"}
            </Button>
          )}
          <Button kind="quiet" onClick={() => setDeleting(false)}>Cancel</Button>
        </Sheet>
      )}
    </div>
  );
}
