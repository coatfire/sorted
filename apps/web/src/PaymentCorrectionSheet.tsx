import { useState } from "react";
import { EditPaymentInput, dublinDateTime, irelandToday, paymentPaidAt, type Payment, type PaymentMethod } from "@sorted/core";
import { Button, Field, Sheet } from "./components";
import { centsToInput, euros, methodLabel, parseEuros } from "./lib/format";
import { useAction, useStore } from "./lib/store";
import { useValidation } from "./lib/useValidation";

export function PaymentCorrectionSheet({ payment, maximum, onClose }: { payment: Payment; maximum: number; onClose: () => void }) {
  const { backend } = useStore();
  const editAction = useAction(), undoAction = useAction();
  const [confirm, setConfirm] = useState(false);
  const { busy, run, error, committed } = confirm ? undoAction : editAction;
  const [amount, setAmount] = useState(centsToInput(payment.amountCents));
  const [method, setMethod] = useState<Exclude<PaymentMethod, "stripe">>(payment.method === "bank_transfer" || payment.method === "revolut" ? payment.method : "cash");
  const [date, setDate] = useState(dublinDateTime(payment.paidAt ?? payment.createdAt).date);
  const validation = useValidation({
    amount: () => { const cents = parseEuros(amount); return !cents || cents < 0 ? "Enter an amount of at least €0.01." : cents > maximum ? "The total paid cannot exceed the booking price." : undefined; },
    paid_at: () => { try { return EditPaymentInput.safeParse({ paid_at: paymentPaidAt(date).toISOString() }).success ? undefined : "Choose a valid date, no later than today."; } catch { return "Choose a valid date, no later than today."; } },
  });
  const feedback = <>
    {error && <p className="sheet-copy" role="alert">{error}</p>}
    {committed && error && <Button type="button" kind="soft" onClick={() => window.location.reload()}>Reload</Button>}
  </>;
  if (payment.method === "stripe") return <Sheet title="Paid by card" onClose={onClose}><p className="sheet-copy">Paid by card — refund it in Stripe.</p></Sheet>;
  if (confirm) return <Sheet title="Undo payment?" onClose={onClose}>
    <p className="sheet-copy">{euros(payment.amountCents)} will go back to the amount owed. Any receipt for this payment will be marked VOID. The payment stays in your records, and the booking status will not change.</p>
    <p className="sheet-copy">This does not refund or move any money.</p>
    {feedback}
    <Button kind="danger" disabled={busy || committed} onClick={async () => { if (await run(() => backend.undoPayment(payment.id), "Payment undone")) onClose(); }}>Undo payment</Button>
    <Button kind="quiet" disabled={busy || committed} onClick={() => setConfirm(false)}>Keep payment</Button>
  </Sheet>;
  return <Sheet title="Edit payment" onClose={onClose}>
    <form noValidate onSubmit={async event => {
      event.preventDefault();
      if (!validation.validate(event.currentTarget)) return;
      const paidAt = date === dublinDateTime(payment.paidAt ?? payment.createdAt).date && payment.paidAt ? payment.paidAt : paymentPaidAt(date).toISOString();
      if (await run(() => backend.editPayment(payment.id, { amount_cents: parseEuros(amount)!, method, paid_at: paidAt }), "Payment updated")) onClose();
    }}>
      <Field label="Amount" {...validation.field("amount")}><div className="money-input"><span>€</span><input name="amount" inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} /></div></Field>
      <Field label="Method"><select value={method} onChange={event => setMethod(event.target.value as Exclude<PaymentMethod, "stripe">)}>{(["cash", "bank_transfer", "revolut"] as const).map(value => <option key={value} value={value}>{methodLabel(value)}</option>)}</select></Field>
      <Field label="Date" {...validation.field("paid_at")}><input name="paid_at" type="date" required max={irelandToday()} value={date} onChange={event => setDate(event.target.value)} /></Field>
      {feedback}
      <Button type="submit" disabled={busy || committed}>Save changes</Button>
    </form>
    <Button kind="quiet" disabled={busy || committed} onClick={() => setConfirm(true)}>Undo payment</Button>
    <Button kind="quiet" disabled={busy} onClick={onClose}>Cancel</Button>
  </Sheet>;
}
