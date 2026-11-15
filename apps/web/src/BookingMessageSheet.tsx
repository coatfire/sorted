import {
  DEFAULT_BOOKING_CONFIRMATION_TEMPLATE, DEFAULT_PAYMENT_REQUEST_TEMPLATE, renderBookingMessage, bookingMessagePayLink,
} from "@sorted/core";
import { useState } from "react";
import { Button, Field, Sheet } from "./components";
import type { BookingRow } from "./lib/backend";
import { centsToInput, parseEuros, longDay, time, whatsappLink } from "./lib/format";
import { useValidation } from "./lib/useValidation";
import { useAction, useData, useStore } from "./lib/store";

export function BookingMessageSheet({ booking, kind, onClose, initialAmountCents, requestLabel = "Request payment" }: {
  booking: BookingRow;
  kind: "confirmation" | "payment_request";
  onClose: () => void;
  initialAmountCents?: number;
  requestLabel?: string;
}) {
  const { user, payments, features } = useData();
  const { backend } = useStore();
  const { run, busy, error, committed } = useAction();
  const [draftOpened, setDraftOpened] = useState(false);
  const openedDraft = () => { if (kind === "payment_request") setDraftOpened(true); };
  const client = booking.client;
  const theirs = payments.filter((payment) => payment.bookingId === booking.id && payment.status !== "cancelled");
  const paid = theirs.filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + payment.amountCents, 0);
  const balanceCents = Math.max(0, booking.priceCents - paid);
  const confirmation = kind === "confirmation";
  const [amount, setAmount] = useState(centsToInput(initialAmountCents ?? balanceCents));
  const requested = parseEuros(amount);
  const validAmount = confirmation || (requested !== null && requested > 0 && requested <= balanceCents);
  const validation = useValidation({ amount: () => validAmount ? undefined : "Enter an amount from €0.01 up to the balance due." });
  const template = confirmation
    ? user.bookingConfirmationTemplate ?? DEFAULT_BOOKING_CONFIRMATION_TEMPLATE
    : user.paymentRequestTemplate ?? DEFAULT_PAYMENT_REQUEST_TEMPLATE;
  const message = renderBookingMessage(template, {
    kind, revolutLink: user.revolutLink,
    client: client.name,
    business: user.businessName || user.name || "your trader",
    date: longDay(booking.startAt),
    time: time(booking.startAt),
    service: booking.service,
    priceCents: booking.priceCents,
    depositCents: booking.depositCents,
    balanceCents: confirmation ? balanceCents : requested ?? 0,
    iban: user.iban,
    bic: user.bic,
    payLink: features.paymentLinks && validAmount ? bookingMessagePayLink(theirs, kind, confirmation ? balanceCents : requested!) : null,
  });
  const subject = `${confirmation ? "Booking confirmation" : "Payment request"} — ${booking.service}`;
  const email = client.email ? `mailto:${encodeURIComponent(client.email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}` : null;

  return (
    <Sheet title={confirmation ? "Send confirmation" : requestLabel} onClose={onClose}>
      <p className="sheet-copy">Opens a draft in your app. Review it and tap send there.{!confirmation && " Come back here to confirm whether you sent it."}</p>
      {!confirmation && <Field label="Amount to request" {...validation.field("amount")}>
        <div className="money-input"><span>€</span><input name="amount" inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
      </Field>}
      <p className="sheet-copy message-preview">{message || "Your template is empty. Add a message in Settings."}</p>
      {client.phone && validAmount ? (
        <a className="button button-primary" href={whatsappLink(client.phone, message)} onClick={openedDraft} target="_blank" rel="noreferrer">WhatsApp</a>
      ) : (
        <>
          <Button disabled aria-describedby="confirmation-no-phone">WhatsApp</Button>
          <p className="sheet-copy" id="confirmation-no-phone">{!validAmount ? "Enter a valid amount to open a draft." : "No mobile number added for this client. Add one in their details."}</p>
        </>
      )}
      {email && validAmount ? (
        <a className="button button-soft" href={email} onClick={openedDraft}>Email</a>
      ) : (
        <>
          <Button kind="soft" disabled aria-describedby="confirmation-no-email">Email</Button>
          <p className="sheet-copy" id="confirmation-no-email">{!validAmount ? "Enter a valid amount to open a draft." : "No email address added for this client. Add one in their details."}</p>
        </>
      )}
      {draftOpened && <>
        <h3>Did you send it?</h3>
        {error && <p className="sheet-copy" role="alert">{error}</p>}
        {committed && error && <Button kind="soft" onClick={() => window.location.reload()}>Reload</Button>}
        <Button disabled={busy || committed} onClick={async () => {
          if (await run(() => backend.paymentRequested(booking.id), "Marked as asked")) onClose();
        }}>Yes, I sent it</Button>
        <Button kind="quiet" disabled={busy} onClick={onClose}>Not yet</Button>
      </>}
      {!draftOpened && <Button kind="quiet" onClick={onClose}>Done</Button>}
    </Sheet>
  );
}
