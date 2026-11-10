import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { MessageLogEntry } from "@sorted/core";
import { BackButton, Button, Card, EmptyState, Icon, MoneyText, Sheet, StatusChip } from "../components";
import { PaymentActions } from "../PaymentActions";
import {
  confirmCopy, firstName, kindLabel, longDay, messageLabel, methodLabel, stamp, time, whatsappLink,
} from "../lib/format";
import { useAction, useData, useStore } from "../lib/store";

export function BookingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { bookings, payments, features, user } = useData();
  const { backend } = useStore();
  const { busy, run } = useAction();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [messages, setMessages] = useState<MessageLogEntry[] | null>(null);
  const booking = bookings.find((item) => item.id === id);

  // Re-read the message log whenever the booking changes state.
  const status = booking?.status;
  useEffect(() => {
    if (!id || !status) return;
    let live = true;
    backend
      .messages(id)
      .then((log) => live && setMessages(log))
      .catch(() => live && setMessages([]));
    return () => {
      live = false;
    };
  }, [backend, id, status, payments]);

  if (!booking) {
    return (
      <div className="page">
        <Card><EmptyState icon="calendar" title="Booking not found" /></Card>
        <Link className="text-link" to="/">Back to today</Link>
      </div>
    );
  }

  const client = booking.client;
  const bookingPayments = payments
    .filter((payment) => payment.bookingId === booking.id && payment.status !== "cancelled")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const paid = bookingPayments
    .filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  const open = booking.status === "enquiry" || booking.status === "confirmed";
  const confirm = confirmCopy(client, features.automation);
  const hello =
    `Hi ${firstName(client.name)}, ` +
    (booking.status === "enquiry"
      ? `about your ${booking.service} on ${longDay(booking.startAt)} at ${time(booking.startAt)}`
      : `you're booked in for ${booking.service} on ${longDay(booking.startAt)} at ${time(booking.startAt)}` +
        (booking.location ? ` (${booking.location})` : "")) +
    (user.businessName ? ` — ${user.businessName}` : "");

  return (
    <div className="page detail-page">
      <BackButton />
      <div className="detail-hero">
        <div>
          <p className="eyebrow">{client.name}</p>
          <h1>{booking.service}</h1>
        </div>
        <StatusChip status={booking.status} />
      </div>

      <Card className="detail-card">
        <div className="detail-line">
          <span className="detail-icon"><Icon name="calendar" /></span>
          <div>
            <strong>{longDay(booking.startAt)}</strong>
            <span>{time(booking.startAt)}</span>
          </div>
        </div>
        {booking.location && (
          <div className="detail-line">
            <span className="detail-icon"><Icon name="map" /></span>
            <div><strong>{booking.location}</strong><span>Location</span></div>
          </div>
        )}
        <div className="detail-line">
          <span className="detail-icon"><Icon name="user" /></span>
          <Link to={`/clients/${client.id}`} className="detail-link">
            <strong>{client.name}</strong>
            <span>{client.phone || "No mobile added — tap to add one"}</span>
          </Link>
          {client.phone && (
            <a
              className="chip-link"
              href={whatsappLink(client.phone, hello)}
              target="_blank"
              rel="noreferrer"
              aria-label={`Message ${client.name} on WhatsApp`}
            >
              <Icon name="message" size={16} /> WhatsApp
            </a>
          )}
        </div>
      </Card>

      {booking.notes && (
        <Card className="notes-card">
          <p className="eyebrow">Notes</p>
          <p>{booking.notes}</p>
        </Card>
      )}

      {open && (
        <div className="action-stack">
          {booking.status === "enquiry" ? (
            <>
              <Button disabled={busy} onClick={() => run(() => backend.confirmBooking(booking.id), "Booking confirmed")}>
                <Icon name={confirm.caption ? "check" : "message"} /> {confirm.label}
              </Button>
              {confirm.caption && <p className="button-caption">{confirm.caption}</p>}
            </>
          ) : (
            <Button disabled={busy} onClick={() => run(() => backend.completeBooking(booking.id), "Marked complete")}>
              <Icon name="check" /> Mark complete
            </Button>
          )}
          <div className="action-pair">
            <Button kind="quiet" onClick={() => navigate(`/bookings/${booking.id}/edit`)}>
              <Icon name="edit" size={17} /> Edit
            </Button>
            <Button kind="danger" onClick={() => setConfirmCancel(true)}>
              Cancel {booking.status === "enquiry" ? "enquiry" : "booking"}
            </Button>
          </div>
        </div>
      )}

      <section className="detail-section">
        <div className="section-heading compact">
          <div><p className="eyebrow">Money</p><h2>Payment</h2></div>
          <span className="paid-summary">
            <MoneyText cents={paid} /> of <MoneyText cents={booking.priceCents} /> paid
          </span>
        </div>
        <Card className="payment-card">
          <div className="price-total">
            <span>Price{booking.depositCents > 0 && <> · deposit <MoneyText cents={booking.depositCents} /></>}</span>
            <MoneyText cents={booking.priceCents} />
          </div>
          {bookingPayments.length ? (
            bookingPayments.map((payment) => (
              <div className="payment-row" key={payment.id}>
                <div>
                  <strong>{kindLabel(payment.kind)}</strong>
                  <span>
                    {payment.status === "paid"
                      ? [methodLabel(payment.method), payment.paidAt && stamp(payment.paidAt)].filter(Boolean).join(" · ")
                      : payment.linkUrl ? "Payment link created — not paid yet" : "Not paid yet"}
                  </span>
                </div>
                <div className="payment-amount">
                  <MoneyText cents={payment.amountCents} />
                  <StatusChip status={payment.status} />
                </div>
                {payment.status === "pending" && <PaymentActions payment={payment} booking={booking} />}
              </div>
            ))
          ) : (
            <p className="empty-inline">
              {booking.status === "completed"
                ? "Nothing is due."
                : booking.status === "cancelled"
                  ? "Cancelled — nothing is due."
                  : booking.status === "enquiry"
                    ? booking.depositCents > 0
                      ? "The deposit is requested when you confirm."
                      : "The payment is requested when you mark the job complete."
                    : "The payment is requested when you mark the job complete."}
            </p>
          )}
        </Card>
      </section>

      <section className="detail-section">
        <div className="section-heading compact">
          <div><p className="eyebrow">Sent for you</p><h2>Client messages</h2></div>
        </div>
        <Card className="timeline-card">
          {messages === null ? (
            <div className="skeleton skeleton-row" />
          ) : messages.length ? (
            messages.map((message) => (
              <div className={`timeline-row ${message.status === "failed" ? "failed" : ""}`} key={message.id}>
                <span className="timeline-check">
                  <Icon name={message.status === "failed" ? "alert" : "check"} size={14} />
                </span>
                <div>
                  <strong>{messageLabel(message)}</strong>
                  <span>{stamp(message.sentAt)}</span>
                </div>
              </div>
            ))
          ) : (
            <EmptyState icon="message" title="No messages sent" small>
              {!features.automation
                ? "Automatic WhatsApp messages aren’t connected yet. Use the WhatsApp button above to message from your own phone."
                : !client.phone
                  ? `Add a mobile for ${firstName(client.name)} and Sorted will send confirmations and reminders.`
                  : "Confirmations, reminders and payment requests will show here as they’re sent."}
            </EmptyState>
          )}
        </Card>
      </section>

      {confirmCancel && (
        <Sheet title={`Cancel this ${booking.status === "enquiry" ? "enquiry" : "booking"}?`} onClose={() => setConfirmCancel(false)}>
          <p className="sheet-copy">
            {client.name} · {booking.service}. Any payment that’s still due is voided
            {features.automation ? " and it’s removed from your calendar" : ""}. Money already paid stays on record.
          </p>
          <Button
            kind="danger"
            disabled={busy}
            onClick={async () => {
              if (await run(() => backend.cancelBooking(booking.id), "Booking cancelled")) setConfirmCancel(false);
            }}
          >
            Yes, cancel it
          </Button>
          <Button kind="quiet" onClick={() => setConfirmCancel(false)}>Keep it</Button>
        </Sheet>
      )}
    </div>
  );
}
