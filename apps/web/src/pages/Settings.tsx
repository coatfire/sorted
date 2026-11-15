import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEFAULT_BOOKING_CONFIRMATION_TEMPLATE, DEFAULT_PAYMENT_REQUEST_TEMPLATE } from "@sorted/core";
import { BackButton, Button, Card, Field, Icon, PageHeader } from "../components";
import { useData, useSession, useStore } from "../lib/store";
import { prepareInvoiceLogo } from "../lib/image";
import { centsToInput } from "../lib/format";
import { CalendarSettings } from "../CalendarSettings";
import { DriveSettings } from "../DriveSettings";
import { AccentPicker } from "../AccentPicker";
import { MessageEditor } from "../MessageEditor";
import { ServiceEditor } from "../ServiceEditor";
import { Welcome } from "./Welcome";
import { completeServiceDrafts, type ServiceDraft } from "../lib/setup";
import { fieldPatch, settingsForm, type SettingsField, type SettingsForm } from "../lib/settingsFields";
import { useSettingsAutosave } from "../lib/useSettingsAutosave";
import type { SaveState } from "../lib/settingsAutosave";

export function Settings({ welcome = false }: { welcome?: boolean }) {
  return welcome ? <Welcome /> : <BusinessSettings />;
}

function SaveStatus({ state, retry }: { state?: SaveState; retry: () => void }) {
  if (!state) return null;
  return <div className="settings-save-state" role={state.phase === "error" ? "alert" : "status"} aria-live="polite">
    {state.phase === "saving" ? "Saving…" : state.phase === "saved" ? "Saved" : state.phase === "invalid" ? "Check the details above — not saved yet." : state.message}
    {state.phase === "error" && !state.committed && <Button kind="quiet" onClick={retry}>Try again</Button>}
  </div>;
}

function BusinessSettings() {
  const { user, features } = useData();
  const { backend, resetDemo, toast } = useStore();
  const { mode, signOut } = useSession();
  const navigate = useNavigate();
  const { saver, states, blocked, restoredChanges } = useSettingsAutosave();
  const initialUser = { ...user, ...restoredChanges };
  const [form, setForm] = useState(() => settingsForm(initialUser));
  const [errors, setErrors] = useState<Partial<Record<SettingsField, string>>>({});
  const [services, setServices] = useState<ServiceDraft[]>(() => (initialUser.services ?? []).map(service => ({ id: crypto.randomUUID(), name: service.name, price: centsToInput(service.priceCents), lastComplete: service })));
  const [messagesOpen, setMessagesOpen] = useState(false);
  const registrationPending = useRef(false);
  const [logo, setLogo] = useState(initialUser.invoiceLogo);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string>();
  function change(field: SettingsField, value: SettingsForm[SettingsField], section: string, immediate = false) {
    const next = { ...form, [field]: value };
    setForm(next);
    const result = fieldPatch(field, next);
    if (field === "vatRegistered") registrationPending.current = value === true && !result.patch;
    const rateField = field === "vatRateChoice" || field === "vatCustomPercent";
    if (rateField && result.patch && registrationPending.current) {
      saver.change(section, "vatRegistered", { vatRegistered: next.vatRegistered });
      registrationPending.current = false;
    }
    setErrors(current => ({ ...current, ...(rateField && result.patch ? { vatRegistered: undefined, vatRateChoice: undefined, vatCustomPercent: undefined } : {}), [field]: result.error }));
    saver.change(section, rateField ? "vatRateBp" : field === "incomeTaxPercent" ? "incomeTaxRateBp" : field, result.patch, immediate);
  }
  const input = (field: SettingsField, section: string, immediate = false) => ({
    name: field, value: String(form[field]), onChange: (event: { target: { value: string } }) => change(field, event.target.value, section, immediate),
    onBlur: () => { void saver.flush(section); },
  });
  const status = (section: string) => <SaveStatus state={states[section]} retry={() => { void saver.flush(section); }} />;
  return <div className="page">
    <BackButton to="/" />
    <PageHeader eyebrow="Settings" title="Your business" />
    <p className="page-intro">Make it yours. Changes save as you go.</p>
    {blocked && <Button kind="soft" onClick={() => window.location.reload()}>Reload</Button>}
    <fieldset className="settings-fields" disabled={blocked}>
      <section className="settings-section"><h2>Your details</h2><Card className="form-card">
        <Field label="Business name" error={errors.businessName}><input {...input("businessName", "profile")} required maxLength={200} placeholder="e.g. Studio by Shane" /></Field>
        <Field label="Your name (optional)" error={errors.name}><input {...input("name", "profile")} maxLength={200} autoComplete="name" /></Field>
        <Field label="Your mobile (optional)" error={errors.phone}><input {...input("phone", "profile")} type="tel" inputMode="tel" placeholder="087 123 4567" /></Field>
        <Field label="Business address (optional)" error={errors.address}><textarea {...input("address", "profile")} maxLength={500} autoComplete="street-address" /></Field>
        <Field label="Google review link (optional)" error={errors.reviewLink}><input {...input("reviewLink", "profile")} type="url" inputMode="url" placeholder="https://g.page/r/…" /></Field>
        <p className="field-helper">Currency: EUR · Euro</p>
      </Card>{status("profile")}</section>
      <section className="settings-section"><h2>Getting paid</h2><p className="sheet-copy">These details appear in your payment drafts and on invoices.</p><Card className="form-card">
        <Field label="Revolut.me link (optional)" error={errors.revolutLink}><input {...input("revolutLink", "payment")} autoCapitalize="none" spellCheck={false} placeholder="revolut.me/yourname" /></Field>
        <Field label="IBAN (optional)" error={errors.iban}><input {...input("iban", "payment")} autoCapitalize="characters" spellCheck={false} /></Field>
        <Field label="BIC (optional)" error={errors.bic}><input {...input("bic", "payment")} autoCapitalize="characters" spellCheck={false} /></Field>
      </Card>{status("payment")}</section>
      <section className="settings-section"><h2>Your services</h2><p className="sheet-copy">Save up to 30 services and prices for quicker bookings.</p><Card>
        <ServiceEditor rows={services} onChange={rows => {
          const next = completeServiceDrafts(rows);
          setServices(next.drafts);
          if (JSON.stringify(next.values) !== JSON.stringify(completeServiceDrafts(services).values)) saver.change("services", "services", { services: next.values });
        }} />
      </Card>{status("services")}</section>
      <section className="settings-section"><h2>VAT &amp; tax</h2><Card className="form-card">
        <Field label="VAT registered" helper="Your prices are treated as including VAT." error={errors.vatRegistered}><select name="vatRegistered" value={form.vatRegistered ? "yes" : "no"} onChange={event => change("vatRegistered", event.target.value === "yes", "tax", true)}><option value="no">Not VAT registered</option><option value="yes">VAT registered</option></select></Field>
        {form.vatRegistered && <>
          <Field label="VAT rate" error={errors.vatRateChoice}><select {...input("vatRateChoice", "tax", true)}><option value="2300">23%</option><option value="1350">13.5%</option><option value="900">9%</option><option value="custom">Custom rate</option></select></Field>
          {form.vatRateChoice === "custom" && <Field label="Custom VAT rate (%)" error={errors.vatCustomPercent}><input {...input("vatCustomPercent", "tax")} inputMode="decimal" placeholder="e.g. 23" /></Field>}
          <Field label="VAT period"><select {...input("vatPeriodMonths", "tax", true)}><option value="2">Every 2 months</option><option value="4">Every 4 months</option><option value="6">Every 6 months</option><option value="12">Yearly</option></select></Field>
          <Field label="VAT number (optional)" error={errors.vatNumber}><input {...input("vatNumber", "tax")} autoCapitalize="characters" placeholder="IE1234567AB" /></Field>
        </>}
        <Field label="Income tax rate (%)" error={errors.incomeTaxPercent} helper="The rate you expect on your profit, for example 20 or 40."><input {...input("incomeTaxPercent", "tax")} inputMode="decimal" /></Field>
      </Card>{status("tax")}</section>
      <section className="settings-section"><h2>Invoices &amp; receipts</h2><Card className="form-card">
        <Field label="Logo (optional)" helper="PNG or JPEG. Resized to 400px; under 300KB after compression." error={logoError}><input name="invoiceLogo" type="file" accept="image/png,image/jpeg" disabled={logoBusy} onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
          setLogoBusy(true); setLogoError(undefined);
          try { const value = await prepareInvoiceLogo(file); setLogo(value); saver.change("branding", "invoiceLogo", { invoiceLogo: value }, true); }
          catch (error) { setLogoError(error instanceof Error ? error.message : "Couldn't read that logo."); }
          finally { setLogoBusy(false); }
        }} /></Field>
        {logo && <img className="invoice-logo-preview" src={logo} alt="Your invoice logo" />}
        {(logo || logoError) && <Button kind="quiet" disabled={logoBusy} onClick={() => { setLogo(null); setLogoError(undefined); saver.change("branding", "invoiceLogo", { invoiceLogo: null }, true); }}>Remove logo</Button>}
        <AccentPicker value={form.invoiceAccent} onChange={value => change("invoiceAccent", value, "branding", true)} />
        <Field label="Footer text (optional)" error={errors.invoiceFooter}><textarea {...input("invoiceFooter", "branding")} maxLength={1000} rows={3} /></Field>
      </Card>{status("branding")}</section>
      <details className="settings-section customise-messages" onToggle={event => setMessagesOpen(event.currentTarget.open)}><summary>Customise messages</summary>{messagesOpen && <><p className="sheet-copy">For drafts you send yourself by WhatsApp or email.</p><Card className="form-card">
        <MessageEditor label="Booking confirmation" name="bookingConfirmationTemplate" value={form.bookingConfirmationTemplate} onChange={value => change("bookingConfirmationTemplate", value, "messages")} onBlur={() => { void saver.flush("messages"); }} onReset={() => change("bookingConfirmationTemplate", DEFAULT_BOOKING_CONFIRMATION_TEMPLATE, "messages", true)} user={user} kind="confirmation" />
        <MessageEditor label="Payment request" name="paymentRequestTemplate" value={form.paymentRequestTemplate} onChange={value => change("paymentRequestTemplate", value, "messages")} onBlur={() => { void saver.flush("messages"); }} onReset={() => change("paymentRequestTemplate", DEFAULT_PAYMENT_REQUEST_TEMPLATE, "messages", true)} user={user} kind="payment_request" />
      </Card>{status("messages")}</>}</details>
    </fieldset>
    <section className="settings-section"><h2>Messages &amp; payments</h2><Card className="connection-card">
      <div className="connection-row"><span className="connection-logo whatsapp-logo">W</span><div><strong>WhatsApp messages</strong><span>Opens a draft in your WhatsApp — you press send</span></div></div>
      <div className="connection-row"><span className="connection-logo stripe-logo">€</span><div><strong>Card payment links</strong><span>{features.paymentLinks ? "Clients pay online; Sorted marks it paid" : "Coming later"}</span></div></div>
    </Card></section>
    <CalendarSettings /><DriveSettings />
    <section className="settings-section"><h2>Account</h2>
      {mode === "demo" ? <><Button kind="quiet" onClick={async () => { if (await saver.flushAll()) { await resetDemo(); toast("Demo data reset"); } }}>Reset demo data</Button><Button kind="soft" onClick={async () => { if (await saver.flushAll()) { signOut(); navigate("/login"); } }}>Leave the demo and sign up</Button></> : <><Card className="connection-card"><div className="connection-row"><span className="connection-logo account-logo"><Icon name="user" size={18} /></span><div><strong>{user.email}</strong><span>Logged in</span></div></div></Card><Button kind="quiet" onClick={async () => { if (await saver.flushAll()) { signOut(); navigate("/login"); } }}><Icon name="logout" size={18} />Log out</Button></>}
    </section><p className="settings-footnote">Sorted beta · Made for Irish sole traders</p>
  </div>;
}
