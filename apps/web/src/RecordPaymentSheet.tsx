import { useState } from "react";
import { irelandToday, RecordPaymentInput, type PaymentMethod } from "@sorted/core";
import { Button, Field, Sheet } from "./components";
import { centsToInput, methodLabel, parseEuros, paymentRecordedToast } from "./lib/format";
import { useAction, useData, useStore } from "./lib/store";
import { useValidation } from "./lib/useValidation";

export function RecordPaymentSheet({ bookingId, outstanding, onClose }: { bookingId: string; outstanding: number; onClose: () => void }) {
  const { backend } = useStore();
  const { user, bookings } = useData();
  const booking = bookings.find(item => item.id === bookingId)!;
  const { busy, run, error, committed } = useAction();
  const [amount, setAmount] = useState(centsToInput(outstanding));
  const [method, setMethod] = useState<Exclude<PaymentMethod, "stripe">>(user.revolutLink ? "revolut" : "cash");
  const [date, setDate] = useState(irelandToday());
  const validation = useValidation({
    amount: () => {
      const cents = parseEuros(amount);
      return !cents ? "Enter an amount of at least €0.01." : cents > outstanding ? "The amount cannot exceed the balance due." : undefined;
    },
    paid_on: () => RecordPaymentInput.shape.paid_on.safeParse(date).success ? undefined : "Choose a valid date, no later than today.",
  });
  return <Sheet title="Record payment" onClose={onClose}>
    <form noValidate onSubmit={async (event) => {
      event.preventDefault();
      if (!validation.validate(event.currentTarget)) return;
      if (await run(() => backend.recordPayment(bookingId, { amount_cents: parseEuros(amount)!, method, paid_on: date }), paymentRecordedToast(booking.client.name, parseEuros(amount)!))) onClose();
    }}>
      <Field label="Amount" {...validation.field("amount")}>
        <div className="money-input"><span>€</span><input name="amount" inputMode="decimal" required value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
      </Field>
      <Field label="Method" {...validation.field("method")}>
        <select name="method" value={method} onChange={(event) => setMethod(event.target.value as Exclude<PaymentMethod, "stripe">)}>
          {(["cash", "bank_transfer", "revolut"] as const).map((value) => <option key={value} value={value}>{methodLabel(value)}</option>)}
        </select>
      </Field>
      <Field label="Date" {...validation.field("paid_on")}><input name="paid_on" type="date" required max={irelandToday()} value={date} onChange={(event) => setDate(event.target.value)} /></Field>
      {error && <p className="sheet-copy" role="alert">{error}</p>}
      {committed && error && <Button type="button" kind="soft" onClick={() => window.location.reload()}>Reload</Button>}
      <Button type="submit" disabled={busy || committed}>Record payment</Button>
    </form>
    <Button kind="quiet" disabled={busy} onClick={onClose}>Cancel</Button>
  </Sheet>;
}
