import {
  DEFAULT_BOOKING_CONFIRMATION_TEMPLATE, DEFAULT_PAYMENT_REQUEST_TEMPLATE, renderBookingMessage, bookingMessagePayLink,
} from "@sorted/core";
import { Button, Sheet } from "./components";
import type { BookingRow } from "./lib/backend";
import { longDay, time, whatsappLink } from "./lib/format";
import { useData } from "./lib/store";

export function BookingMessageSheet({ booking, kind, onClose }: {
  booking: BookingRow;
  kind: "confirmation" | "payment_request";
  onClose: () => void;
}) {
  const { user, payments, features } = useData();
  const client = booking.client;
  const theirs = payments.filter((payment) => payment.bookingId === booking.id && payment.status !== "cancelled");
  const paid = theirs.filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + payment.amountCents, 0);
  const balanceCents = Math.max(0, booking.priceCents - paid);
  const confirmation = kind === "confirmation";
  const template = confirmation
    ? user.bookingConfirmationTemplate ?? DEFAULT_BOOKING_CONFIRMATION_TEMPLATE
    : user.paymentRequestTemplate ?? DEFAULT_PAYMENT_REQUEST_TEMPLATE;
  const message = renderBookingMessage(template, {
    client: client.name,
    business: user.businessName || user.name || "your trader",
    date: longDay(booking.startAt),
    time: time(booking.startAt),
    service: booking.service,
    priceCents: booking.priceCents,
    depositCents: booking.depositCents,
    balanceCents,
    iban: user.iban,
    bic: user.bic,
    payLink: features.paymentLinks ? bookingMessagePayLink(theirs, kind, balanceCents) : null,
  });
  const subject = `${confirmation ? "Booking confirmation" : "Payment request"} — ${booking.service}`;
  const email = client.email ? `mailto:${encodeURIComponent(client.email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}` : null;

  return (
    <Sheet title={confirmation ? "Send confirmation" : "Request payment"} onClose={onClose}>
      <p className="sheet-copy">Opens a draft in your app. Review it and tap send there. Sorted won’t mark it as sent.</p>
      <p className="sheet-copy message-preview">{message || "Your template is empty. Add a message in Settings."}</p>
      {client.phone ? (
        <a className="button button-primary" href={whatsappLink(client.phone, message)} target="_blank" rel="noreferrer">WhatsApp</a>
      ) : (
        <>
          <Button disabled aria-describedby="confirmation-no-phone">WhatsApp</Button>
          <p className="sheet-copy" id="confirmation-no-phone">No mobile number added for this client. Add one in their details.</p>
        </>
      )}
      {email ? (
        <a className="button button-soft" href={email}>Email</a>
      ) : (
        <>
          <Button kind="soft" disabled aria-describedby="confirmation-no-email">Email</Button>
          <p className="sheet-copy" id="confirmation-no-email">No email address added for this client. Add one in their details.</p>
        </>
      )}
      <Button kind="quiet" onClick={onClose}>Done</Button>
    </Sheet>
  );
}
