import { useEffect, useState } from "react";
import { FollowUpLater } from "../FollowUp";
import { Link, useNavigate, useParams } from "react-router-dom";
import { bookingStage, missingBookingDetails, type DocumentKind, type MessageLogEntry, type Payment } from "@sorted/core";
import { ConfirmBookingSheet } from "../ConfirmBookingSheet";
import { BackButton, Button, Card, EmptyState, Icon, MoneyText, Sheet, StatusChip } from "../components";
import { PaymentActions } from "../PaymentActions";
import { BookingMessageSheet } from "../BookingMessageSheet";
import { RecordPaymentSheet } from "../RecordPaymentSheet";
import { PaymentCorrectionSheet } from "../PaymentCorrectionSheet";
import { BookingCalendarSheet } from "../BookingCalendarSheet";
import { BookingSteps } from "../BookingSteps";
import { bookingPaymentPhrase, unpaidDepositCents, type BookingDetailAction } from "../lib/bookingDetail";
import {
  euros, formatPhone, kindLabel, longDay, messageLabel, methodLabel, stamp, time,
  noTime,
} from "../lib/format";
import { useAction, useData, useStore, useSession } from "../lib/store";
import { buildDocumentFile, shareOrDownload } from "../lib/documentFile";

export function BookingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { bookings, payments, features, user } = useData();
  const { backend, toast, refresh } = useStore();
  const { mode } = useSession();
  const [documentBusy, setDocumentBusy] = useState(false);
  const [chooseReceipt, setChooseReceipt] = useState(false);
  const [recordPayment, setRecordPayment] = useState(false);
  const [correctPayment, setCorrectPayment] = useState<Payment | null>(null);
  const [followUp, setFollowUp] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const { busy, run } = useAction();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDetails, setConfirmDetails] = useState(false);
  const [message, setMessage] = useState<"confirmation" | "payment_request" | null>(null);
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
    .filter((payment) => payment.bookingId === booking.id && (payment.status !== "cancelled" || payment.paidAt !== null))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const paid = bookingPayments
    .filter((payment) => payment.status === "paid")
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  const paidPayments = bookingPayments.filter((payment) => payment.status === "paid");
  const hasPaidPayment = paidPayments.length > 0;
  const { stage, owedCents } = bookingStage(booking, payments, new Date());
  const depositDue = unpaidDepositCents(booking, owedCents);
  const paymentPhrase = bookingPaymentPhrase(stage, owedCents, depositDue);

  async function document(kind: DocumentKind, paymentId?: string) {
    if (!booking) return;
    setDocumentBusy(true);
    try {
      const outcome = await shareOrDownload(await buildDocumentFile(backend, user, booking, payments, kind, paymentId));
      if (outcome === "downloaded") toast("PDF downloaded");
      void refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't create that PDF. Try again.", "error");
    } finally { setDocumentBusy(false); }
  }

  function action(action: BookingDetailAction) {
    if (!booking) return;
    switch (action) {
      case "confirm": if (missingBookingDetails(booking).length) setConfirmDetails(true); else void run(() => backend.confirmBooking(booking.id), "Booking confirmed"); break;
      case "complete": void run(() => backend.completeBooking(booking.id), "Marked complete"); break;
      case "invoice": case "quote": void document(action); break;
      case "receipt":
        if (paidPayments.length === 1) void document("receipt", paidPayments[0].id);
        else setChooseReceipt(true);
        break;
      case "followUp": setFollowUp(true); break;
      case "calendar": setCalendar(true); break;
      case "confirmation": setMessage("confirmation"); break;
      case "again": navigate(`/bookings/new?again=${booking.id}`); break;
      case "edit": navigate(`/bookings/${booking.id}/edit`); break;
      case "cancel": setConfirmCancel(true); break;
      case "payment": setRecordPayment(true); break;
      case "ask": setMessage("payment_request"); break;
    }
  }

  return (
    <div className="page detail-page">
      <BackButton />
      <div className="detail-hero">
        <div>
          <p className="eyebrow">{client.name}</p>
          <h1>{booking.service}</h1>
        </div>
        <div className="booking-status">
          <StatusChip status={booking.status} />
          {paymentPhrase && <span className="booking-payment-phrase">· {paymentPhrase}</span>}
        </div>
      </div>

      <Card className="detail-card">
        <div className="detail-line">
          <span className="detail-icon"><Icon name="calendar" /></span>
          <div>
            <strong>{longDay(booking.startAt)}</strong>
            <span>{booking.timeTbc ? noTime(booking) : time(booking.startAt)}</span>
          </div>
        </div>
        {booking.location && (
          <div className="detail-line">
            <span className="detail-icon"><Icon name="map" /></span>
            <a className="detail-link calendar-directions" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(booking.location)}`} target="_blank" rel="noreferrer"><strong>{booking.location}</strong><span>Get directions</span></a>
          </div>
        )}
        <div className="detail-line">
          <span className="detail-icon"><Icon name="user" /></span>
          <Link to={`/clients/${client.id}`} className="detail-link">
            <strong>{client.name}</strong>
            <span>{formatPhone(client.phone) || "No mobile added — tap to add one"}</span>
          </Link>
        </div>
      </Card>

      <BookingSteps booking={booking} stage={stage} owedCents={owedCents} depositCents={depositDue}
        hasPaidPayment={hasPaidPayment} automation={features.automation} busy={busy}
        documentBusy={documentBusy} onAction={action} />

      {booking.notes && (
        <Card className="notes-card">
          <p className="eyebrow">Notes</p>
          <p>{booking.notes}</p>
        </Card>
      )}

      <section className="detail-section">
        <div className="section-heading compact">
          <div><p className="eyebrow">Money</p><h2>Payment</h2></div>
          {booking.priceCents !== null && <span className="paid-summary">
            <MoneyText cents={paid} /> of <MoneyText cents={booking.priceCents} /> paid
          </span>}
        </div>
        <Card className="payment-card">
          <div className="price-total">
            <span>Price{booking.depositCents > 0 && <> · deposit <MoneyText cents={booking.depositCents} /></>}</span>
            <MoneyText cents={booking.priceCents} />
          </div>
          {bookingPayments.length ? (
            bookingPayments.map((payment) => (
              <div className="payment-row" key={payment.id}>
                {payment.status === "paid" && payment.method !== "stripe" ? <button type="button" className="payment-edit-row" aria-label={`Edit ${euros(payment.amountCents)} payment`} onClick={() => setCorrectPayment(payment)}>
                  <span><strong>{kindLabel(payment.kind)}</strong><span>{[methodLabel(payment.method), payment.paidAt && stamp(payment.paidAt)].filter(Boolean).join(" · ")}</span></span>
                  <span className="payment-amount"><MoneyText cents={payment.amountCents} /><span>Edit payment</span></span>
                </button> : <><div>
                  <strong>{kindLabel(payment.kind)}</strong>
                  <span>
                    {payment.status === "paid"
                      ? [methodLabel(payment.method), payment.paidAt && stamp(payment.paidAt)].filter(Boolean).join(" · ")
                      : payment.status === "cancelled" ? "Payment undone" : payment.linkUrl ? "Payment link created — not paid yet" : "Not paid yet"}
                    {payment.status === "paid" && payment.method === "stripe" && " · Paid by card"}
                  </span>
                </div>
                <div className="payment-amount">
                  <MoneyText cents={payment.amountCents} />
                  {payment.status === "cancelled" ? <span>Undone</span> : <StatusChip status={payment.status} />}
                </div></>}
                {payment.receiptVoidedAt && <Button kind="quiet" disabled={documentBusy} onClick={() => { void document("receipt", payment.id); }}>Voided receipt</Button>}
                {payment.status === "pending" && features.paymentLinks && <PaymentActions payment={payment} booking={booking} showMarkPaid={false} />}
              </div>
            ))
          ) : (
            <p className="empty-inline">
              {booking.status === "completed"
                ? stage === "owing" ? "The balance is still to pay." : "Nothing is due."
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
        {owedCents === 0 && booking.priceCents !== null && booking.status !== "enquiry" && <p className="sheet-copy"><strong>Paid in full</strong></p>}
      </section>

      <section className="detail-section">
        <div className="section-heading compact">
          <div><p className="eyebrow">{mode === "demo" ? "Sample activity" : "Sent for you"}</p><h2>Client messages</h2></div>
        </div>
        <Card className="timeline-card">
          {mode === "demo" && <p className="sheet-copy">Sample activity — nothing was sent</p>}
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
            <EmptyState icon="message" title="No messages recorded" small>
              Open a draft with Send confirmation or Ask for payment, then tap I sent it after sending. Closing a draft records nothing.
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
      {followUp && <FollowUpLater booking={booking} onClose={() => setFollowUp(false)} />}
      {message && <BookingMessageSheet booking={booking} kind={message} requestLabel="Ask for payment" onClose={() => setMessage(null)} />}
      {calendar && <BookingCalendarSheet booking={booking} onClose={() => setCalendar(false)} />}
      {recordPayment && <RecordPaymentSheet bookingId={booking.id} outstanding={owedCents} onClose={() => setRecordPayment(false)} />}
      {confirmDetails && <ConfirmBookingSheet booking={booking} onClose={() => setConfirmDetails(false)} />}
      {correctPayment && <PaymentCorrectionSheet payment={correctPayment} maximum={(booking.priceCents ?? 0) - paid + correctPayment.amountCents} onClose={() => setCorrectPayment(null)} />}
      {chooseReceipt && <Sheet title="Choose a payment" onClose={() => setChooseReceipt(false)}>
        <p className="sheet-copy">Each payment has its own receipt number.</p>
        {paidPayments.map((payment) => <Button key={payment.id} kind="quiet" onClick={() => {
          setChooseReceipt(false);
          void document("receipt", payment.id);
        }}>
          <MoneyText cents={payment.amountCents} /> · {stamp(payment.paidAt ?? payment.createdAt)} · {methodLabel(payment.method)}
        </Button>)}
      </Sheet>}
    </div>
  );
}
