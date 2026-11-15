import { useState, type FormEvent } from "react";
import { Button, Field } from "./components";
import { paymentDetails } from "./lib/setup";
import { useAction, useData, useStore } from "./lib/store";

export function PaymentDetailsPrompt({ onContinue }: { onContinue: () => void }) {
  const { user } = useData(), { backend } = useStore();
  const { busy, run, error, committed } = useAction();
  const [form, setForm] = useState({ iban: user.iban ?? "", bic: user.bic ?? "", revolutLink: user.revolutLink ?? "" });
  const [submitted, setSubmitted] = useState(false);
  const details = paymentDetails(form);
  const empty = !form.iban.trim() && !form.revolutLink.trim();
  const update = (field: keyof typeof form) => (event: { target: { value: string } }) => setForm(current => ({ ...current, [field]: event.target.value }));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || committed) return;
    setSubmitted(true);
    if (empty || Object.values(details.errors).some(Boolean)) return;
    if (await run(() => backend.updateUser(details.patch))) onContinue();
  }
  return <form className="payment-details-prompt" onSubmit={submit} noValidate>
    <p className="sheet-copy">Add a Revolut link or bank details for your message. We'll remember them in Settings.</p>
    <Field label="Revolut.me link" error={submitted ? details.errors.revolutLink : undefined}><input name="revolutLink" value={form.revolutLink} onChange={update("revolutLink")} placeholder="revolut.me/yourname" autoCapitalize="none" spellCheck={false} /></Field>
    <p className="field-helper">Or use your bank details</p>
    <Field label="IBAN" error={submitted ? details.errors.iban : undefined}><input name="iban" value={form.iban} onChange={update("iban")} autoCapitalize="characters" spellCheck={false} /></Field>
    <Field label="BIC (optional)" error={submitted ? details.errors.bic : undefined}><input name="bic" value={form.bic} onChange={update("bic")} autoCapitalize="characters" spellCheck={false} /></Field>
    {submitted && empty && <p role="alert" className="sheet-copy">Add an IBAN or Revolut link, or choose Not now.</p>}
    {error && <p role="alert" className="sheet-copy">{error}</p>}
    {committed && error && <Button type="button" kind="soft" onClick={() => window.location.reload()}>Reload</Button>}
    <Button type="submit" disabled={busy || committed}>{busy ? "Saving…" : "Save and continue"}</Button>
    <Button type="button" kind="quiet" disabled={busy || committed} onClick={onContinue}>Not now</Button>
  </form>;
}
