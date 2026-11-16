import { missingBookingDetails, type BookingStage } from "@sorted/core";
import { Button, Card, Icon } from "./components";
import type { BookingRow } from "./lib/backend";
import { type BookingDetailAction } from "./lib/bookingDetail";
import { confirmCopy, euros, longDay } from "./lib/format";

export function BookingSteps({ booking, stage, owedCents, depositCents, hasPaidPayment, automation, busy, documentBusy, onAction }: {
  booking: BookingRow;
  stage: BookingStage;
  owedCents: number;
  depositCents: number;
  hasPaidPayment: boolean;
  automation: boolean;
  busy: boolean;
  documentBusy: boolean;
  onAction: (action: BookingDetailAction) => void;
}) {
  const confirm = confirmCopy(booking.client, automation);
  const noPrice = booking.priceCents === null;
  const paymentInNextStep = owedCents > 0 && (stage === "upcoming" || stage === "due" || stage === "owing");
  const askInNextStep = owedCents > 0 && (stage === "upcoming" || stage === "owing");
  const open = booking.status === "enquiry" || booking.status === "confirmed";
  const receiptDisabled = documentBusy || !hasPaidPayment;
  const receiptHelp = !hasPaidPayment ? "receipt-unavailable" : undefined;

  function row(action: BookingDetailAction, label: string, icon: Parameters<typeof Icon>[0]["name"], disabled = false) {
    disabled ||= noPrice && ["quote", "invoice", "ask", "payment", "receipt"].includes(action);
    disabled ||= action === "cancel" && missingBookingDetails(booking).length > 0;
    return <button type="button" className={`booking-more-action${action === "cancel" ? " is-danger" : ""}`} disabled={disabled} onClick={() => onAction(action)} aria-describedby={action === "receipt" ? receiptHelp : undefined}>
      <Icon name={icon} size={18} /><span>{label}</span>
    </button>;
  }

  return <>
    <Card className="next-step-card">
      <p className="eyebrow">Next step</p>
      {stage === "enquiry" && <>
        <h2>Ready to book?</h2>
        <p className="sheet-copy">{booking.followUpOn ? `Follow up on ${longDay(`${booking.followUpOn}T12:00:00Z`)}` : "No follow-up set"}</p>
        <Button disabled={busy} onClick={() => onAction("confirm")}><Icon name={confirm.caption ? "check" : "message"} />{confirm.label}</Button>
        {confirm.caption && <p className="button-caption">{confirm.caption}</p>}
        <div className="next-step-secondary">
          <Button kind="quiet" disabled={documentBusy || noPrice} onClick={() => onAction("quote")}><Icon name="receipt" size={18} />Quote</Button>
          <Button kind="quiet" onClick={() => onAction("followUp")}><Icon name="clock" size={18} />Change follow-up</Button>
        </div>
      </>}
      {stage === "upcoming" && <>
        <h2>Booking confirmed</h2>
        <p className="sheet-copy">Get ready for {booking.service} on {longDay(booking.startAt)}.</p>
        {owedCents > 0 ? <>
        <p className="sheet-copy">{depositCents > 0 ? `${euros(depositCents)} deposit due` : `${euros(owedCents)} still to pay`}</p>
        <Button onClick={() => onAction("payment")}><Icon name="wallet" />Add payment</Button>
        <div className="next-step-secondary"><Button kind="quiet" onClick={() => onAction("ask")}><Icon name="message" size={18} />Ask for payment</Button></div>
      </> : <>
        <p className="sheet-copy">All set — paid in full.</p>
      </>}
      </>}
      {stage === "due" && <>
        <h2>Ready to finish?</h2>
        {owedCents > 0 && <p className="sheet-copy">{euros(owedCents)} still to pay</p>}
        <Button disabled={busy} onClick={() => onAction("complete")}><Icon name="check" />Mark complete</Button>
        {owedCents > 0 && <div className="next-step-secondary"><Button kind="quiet" onClick={() => onAction("payment")}><Icon name="wallet" size={18} />Add payment</Button></div>}
      </>}
      {stage === "owing" && <>
        <h2>{euros(owedCents)} left to pay</h2>
        <Button onClick={() => onAction("payment")}><Icon name="wallet" />Add payment</Button>
        <div className="next-step-secondary"><Button kind="quiet" onClick={() => onAction("ask")}><Icon name="message" size={18} />Ask for payment</Button></div>
      </>}
      {stage === "paid" && <>
        <h2>Paid in full</h2>
        <Button onClick={() => onAction("again")}><Icon name="plus" />Book again</Button>
        <div className="next-step-secondary"><Button kind="quiet" disabled={receiptDisabled} aria-describedby={receiptHelp} onClick={() => onAction("receipt")}><Icon name="receipt" size={18} />Receipt</Button></div>
      </>}
      {stage === "cancelled" && <>
        <h2>Booking cancelled</h2>
        <Button kind="soft" onClick={() => onAction("again")}><Icon name="plus" />Book again</Button>
      </>}
    </Card>
    <section className="detail-section" aria-labelledby="booking-more">
      <div className="section-heading compact"><h2 id="booking-more">More</h2></div>
      <Card className="booking-more-list">
        {row(booking.status === "enquiry" ? "quote" : "invoice", booking.status === "enquiry" ? "Quote" : "Invoice", "receipt", documentBusy)}
        {stage !== "paid" && row("receipt", "Receipt", "receipt", receiptDisabled)}
        {stage !== "cancelled" && booking.startAt && row("calendar", "Add to calendar", "calendar")}
        {stage !== "cancelled" && row("confirmation", "Send confirmation", "message")}
        {booking.status !== "enquiry" && stage !== "paid" && stage !== "cancelled" && row("again", "Book again", "plus")}
        {open && row("edit", "Edit", "edit")}
        {stage === "upcoming" && row("complete", "Mark complete", "check", busy)}
        {!askInNextStep && stage !== "cancelled" && owedCents > 0 && row("ask", "Ask for payment", "message")}
        {!paymentInNextStep && (booking.status === "confirmed" || booking.status === "completed") && row("payment", "Add payment", "wallet")}
        {open && row("cancel", `Cancel ${booking.status === "enquiry" ? "enquiry" : "booking"}`, "trash")}
      </Card>
      {!hasPaidPayment && <p className="sheet-copy" id="receipt-unavailable">Record a payment to create a receipt.</p>}
      {noPrice && <p className="sheet-copy">Add a price first to request or record a payment, quote or invoice.</p>}
      {missingBookingDetails(booking).length > 0 && <p className="sheet-copy">Add the missing details before confirming or cancelling this enquiry.</p>}
    </section>
  </>;
}
