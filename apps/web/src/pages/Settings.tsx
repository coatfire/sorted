import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  normalisePhone, normaliseIban, normaliseBic, validIban, validBic,
  DEFAULT_BOOKING_CONFIRMATION_TEMPLATE, DEFAULT_PAYMENT_REQUEST_TEMPLATE, MESSAGE_PLACEHOLDERS,
  DEFAULT_INVOICE_ACCENT, InvoiceAccent, IrishVatNumber,
  percentToBasisPoints, RevolutLink,
} from "@sorted/core";
import { BackButton, Button, Card, Field, Icon, PageHeader } from "../components";
import { useAction, useData, useSession, useStore } from "../lib/store";
import { useValidation } from "../lib/useValidation";
import { prepareInvoiceLogo } from "../lib/image";
import { CalendarSettings } from "../CalendarSettings";
import { DriveSettings } from "../DriveSettings";
import { vatNumberUpdate } from "../lib/settings";

export function Settings({ welcome = false }: { welcome?: boolean }) {
  const { user, features } = useData();
  const { backend, resetDemo, toast } = useStore();
  const { mode, signOut } = useSession();
  const { busy, run } = useAction();
  const navigate = useNavigate();
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string>();
  const [form, setForm] = useState({
    businessName: user.businessName ?? "",
    name: user.name ?? "",
    phone: user.phone ?? "",
    reviewLink: user.reviewLink ?? "",
    address: user.address ?? "",
    iban: user.iban ?? "",
    revolutLink: user.revolutLink ?? "",
    bic: user.bic ?? "",
    bookingConfirmationTemplate: user.bookingConfirmationTemplate ?? DEFAULT_BOOKING_CONFIRMATION_TEMPLATE,
    paymentRequestTemplate: user.paymentRequestTemplate ?? DEFAULT_PAYMENT_REQUEST_TEMPLATE,
    invoiceLogo: user.invoiceLogo ?? null,
    invoiceAccent: user.invoiceAccent ?? DEFAULT_INVOICE_ACCENT,
    invoiceFooter: user.invoiceFooter ?? "",
    vatNumber: user.vatNumber ?? "",
    vatRegistered: user.vatRegistered ?? false,
    vatRateChoice: user.vatRateBp == null ? "" : [2300, 1350, 900].includes(user.vatRateBp) ? String(user.vatRateBp) : "custom",
    vatCustomPercent: user.vatRateBp == null ? "" : String(user.vatRateBp / 100),
    vatPeriodMonths: String(user.vatPeriodMonths ?? 2),
    incomeTaxPercent: user.incomeTaxRateBp == null ? "" : String(user.incomeTaxRateBp / 100),
  });
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => {
    setForm({ ...form, [field]: event.target.value });
  };
  const validation = useValidation({
    revolutLink: () => form.revolutLink.trim() && !RevolutLink.safeParse(form.revolutLink).success ? "Enter a Revolut username or revolut.me link." : undefined,
    vatRateChoice: () => form.vatRegistered && !form.vatRateChoice ? "Enter your VAT rate." : undefined,
    vatCustomPercent: () => form.vatRegistered && form.vatRateChoice === "custom" && percentToBasisPoints(form.vatCustomPercent, 3000) === null ? "Enter a rate from 0 to 30%, with up to two decimal places." : undefined,
    incomeTaxPercent: () => form.incomeTaxPercent.trim() && percentToBasisPoints(form.incomeTaxPercent) === null ? "Enter a rate from 0 to 100%, with up to two decimal places." : undefined,
    invoiceAccent: () => !InvoiceAccent.safeParse(form.invoiceAccent).success ? "Enter a hex colour, like #14532D." : undefined,
    vatNumber: () => form.vatRegistered && form.vatNumber.trim() && !IrishVatNumber.safeParse(form.vatNumber).success ? "Enter a valid Irish VAT number." : undefined,
    phone: () => form.phone.trim() && !normalisePhone(form.phone)
      ? "That mobile number doesn’t look right. Try it like 087 123 4567." : undefined,
    name: () => welcome && !form.name.trim() ? "Enter your name." : undefined,
    businessName: () => welcome && !form.businessName.trim() ? "Enter your business name." : undefined,
    iban: () => form.iban.trim() && !validIban(form.iban) ? "Enter a valid IBAN." : undefined,
    bic: () => form.bic.trim() && !validBic(form.bic) ? "Enter a valid BIC." : undefined,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (logoBusy || logoError) return;
    if (!validation.validate(event.currentTarget)) return;
    const phone = form.phone.trim() ? normalisePhone(form.phone) : null;
    let reviewLink: string | null = form.reviewLink.trim() || null;
    if (reviewLink && !/^https?:\/\//i.test(reviewLink)) reviewLink = `https://${reviewLink}`;
    const saved = await run(
      () =>
        backend.updateUser({
          businessName: form.businessName.trim() || null,
          name: form.name.trim() || null,
          phone,
          reviewLink,
          address: form.address.trim() || null,
          iban: form.iban.trim() ? normaliseIban(form.iban) : null,
          revolutLink: form.revolutLink.trim() ? RevolutLink.parse(form.revolutLink) : null,
          bic: form.bic.trim() ? normaliseBic(form.bic) : null,
          ...(!welcome ? {
            bookingConfirmationTemplate: form.bookingConfirmationTemplate === DEFAULT_BOOKING_CONFIRMATION_TEMPLATE ? null : form.bookingConfirmationTemplate,
            paymentRequestTemplate: form.paymentRequestTemplate === DEFAULT_PAYMENT_REQUEST_TEMPLATE ? null : form.paymentRequestTemplate,
            invoiceLogo: form.invoiceLogo,
            invoiceAccent: InvoiceAccent.parse(form.invoiceAccent) === DEFAULT_INVOICE_ACCENT ? null : InvoiceAccent.parse(form.invoiceAccent),
            invoiceFooter: form.invoiceFooter.trim() || null,
            ...vatNumberUpdate(form.vatRegistered, form.vatNumber),
            vatRegistered: form.vatRegistered,
            vatRateBp: form.vatRateChoice === "custom" ? percentToBasisPoints(form.vatCustomPercent, 3000) : form.vatRateChoice ? Number(form.vatRateChoice) : null,
            vatPeriodMonths: Number(form.vatPeriodMonths),
            incomeTaxRateBp: form.incomeTaxPercent.trim() ? percentToBasisPoints(form.incomeTaxPercent) : null,
          } : {}),
        }),
      "Settings saved",
    );
    if (saved && welcome) navigate("/", { replace: true });
  }

  return (
    <div className="page">
      {!welcome && <BackButton to="/" />}
      <PageHeader eyebrow={welcome ? "Welcome to Sorted" : "Settings"} title="Your business" />
      <p className="page-intro">The details clients see in messages from you.</p>
      <form onSubmit={submit} noValidate>
        <Card className="form-card settings-card">
          <Field label="Business name" {...validation.field("businessName")}>
            <input name="businessName" required value={form.businessName} onChange={set("businessName")} placeholder="e.g. Studio by Shane" />
          </Field>
          <Field label="Your name" {...validation.field("name")}>
            <input name="name" required={welcome} value={form.name} onChange={set("name")} autoComplete="name" />
          </Field>
          <Field label="Your mobile" {...validation.field("phone")}>
            <input
                type="tel" inputMode="tel" value={form.phone}
                name="phone"
                onChange={set("phone")} placeholder="087 123 4567"
            />
          </Field>
          <Field label="Business address">
            <textarea name="address" maxLength={500} value={form.address} onChange={set("address")} autoComplete="street-address" />
          </Field>
          <Field label="IBAN" helper="Shown on your invoices and payment messages." {...validation.field("iban")}>
            <input name="iban" value={form.iban} onChange={set("iban")} autoCapitalize="characters" spellCheck={false} />
          </Field>
          <Field label="BIC" helper="Shown on your invoices and payment messages." {...validation.field("bic")}>
            <input name="bic" value={form.bic} onChange={set("bic")} autoCapitalize="characters" spellCheck={false} />
          </Field>
          <Field label="Revolut.me link" helper="Your username or revolut.me link. Leave blank to turn it off." {...validation.field("revolutLink")}>
            <input name="revolutLink" value={form.revolutLink} onChange={set("revolutLink")} placeholder="revolut.me/yourname" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </Field>
          {!welcome && <Field label="Google review link" helper="Sent to clients two days after a completed job.">
            <input inputMode="url" value={form.reviewLink} onChange={set("reviewLink")} placeholder="https://g.page/r/…" />
          </Field>}
          {!welcome && <Field label="Currency">
            <div className="locked-field">EUR · Euro <span>Fixed during beta</span></div>
          </Field>}
        </Card>
        {!welcome && <section className="settings-section">
          <p className="eyebrow">VAT &amp; tax</p>
          <Card className="form-card">
            <Field label="VAT registered" helper="Your prices are treated as including VAT.">
              <select name="vatRegistered" value={form.vatRegistered ? "yes" : "no"} onChange={(event) => setForm({ ...form, vatRegistered: event.target.value === "yes" })}>
                <option value="no">Not VAT registered</option><option value="yes">VAT registered</option>
              </select>
            </Field>
            {form.vatRegistered && <>
              <Field label="VAT rate" {...validation.field("vatRateChoice")}>
                <select name="vatRateChoice" value={form.vatRateChoice} onChange={set("vatRateChoice")}>
                  <option value="">Choose a rate</option><option value="2300">23%</option><option value="1350">13.5%</option><option value="900">9%</option><option value="custom">Custom rate</option>
                </select>
              </Field>
              {form.vatRateChoice === "custom" && <Field label="Custom VAT rate (%)" {...validation.field("vatCustomPercent")}>
                <input name="vatCustomPercent" inputMode="decimal" value={form.vatCustomPercent} onChange={set("vatCustomPercent")} placeholder="e.g. 23" />
              </Field>}
              <Field label="VAT period">
                <select name="vatPeriodMonths" value={form.vatPeriodMonths} onChange={set("vatPeriodMonths")}>
                  <option value="2">Every 2 months (Jan–Feb, Mar–Apr…)</option><option value="4">Every 4 months (Jan–Apr, May–Aug…)</option><option value="6">Every 6 months (Jan–Jun, Jul–Dec)</option><option value="12">Yearly (Jan–Dec)</option>
                </select>
              </Field>
            </>}
            {form.vatRegistered && <Field label="VAT number (optional)" {...validation.field("vatNumber")}>
              <input name="vatNumber" value={form.vatNumber} onChange={set("vatNumber")} placeholder="IE1234567AB" autoCapitalize="characters" />
            </Field>}
            <Field label="Income tax rate (%)" helper="e.g. 20% or 40% — the rate you expect on your profit." {...validation.field("incomeTaxPercent")}>
              <input name="incomeTaxPercent" inputMode="decimal" value={form.incomeTaxPercent} onChange={set("incomeTaxPercent")} placeholder="e.g. 20" />
            </Field>
          </Card>
        </section>}
        {!welcome && <section className="settings-section">
          <p className="eyebrow">Invoices &amp; receipts</p>
          <Card className="form-card">
            <Field label="Logo" helper="PNG or JPEG. Resized to 400px; under 300KB after compression." error={logoError}>
              <input name="invoiceLogo" type="file" accept="image/png,image/jpeg" disabled={logoBusy} onChange={async (event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                setLogoBusy(true);
                setLogoError(undefined);
                try { const logo = await prepareInvoiceLogo(file); setForm((current) => ({ ...current, invoiceLogo: logo })); }
                catch (error) { setLogoError(error instanceof Error ? error.message : "Couldn't read that logo."); }
                finally { setLogoBusy(false); input.value = ""; }
              }} />
            </Field>
            {form.invoiceLogo && <img className="invoice-logo-preview" src={form.invoiceLogo} alt="Your invoice logo" />}
            {(form.invoiceLogo || logoError) && <Button type="button" kind="quiet" disabled={logoBusy} onClick={() => {
              setForm({ ...form, invoiceLogo: null }); setLogoError(undefined);
            }}>Remove logo</Button>}
            <Field label="Accent colour" {...validation.field("invoiceAccent")}>
              <input name="invoiceAccent" value={form.invoiceAccent} onChange={set("invoiceAccent")} placeholder={DEFAULT_INVOICE_ACCENT} spellCheck={false} />
            </Field>
            <Field label="Footer text">
              <textarea name="invoiceFooter" rows={3} maxLength={1000} value={form.invoiceFooter} onChange={set("invoiceFooter")} />
            </Field>
          </Card>
        </section>}
        {!welcome && <section className="settings-section">
          <p className="eyebrow">Message templates</p>
          <p className="sheet-copy">For drafts you send yourself by WhatsApp or email.</p>
          <Card className="form-card">
            <Field label="Booking confirmation" helper={MESSAGE_PLACEHOLDERS.map((key) => `{${key}}`).join(" ")}>
              <textarea name="bookingConfirmationTemplate" rows={7} maxLength={4000} value={form.bookingConfirmationTemplate} onChange={set("bookingConfirmationTemplate")} />
            </Field>
            <Button type="button" kind="quiet" aria-label="Reset booking confirmation to default" onClick={() => setForm({ ...form, bookingConfirmationTemplate: DEFAULT_BOOKING_CONFIRMATION_TEMPLATE })}>Reset to default</Button>
            <Field label="Payment request" helper={MESSAGE_PLACEHOLDERS.map((key) => `{${key}}`).join(" ")}>
              <textarea name="paymentRequestTemplate" rows={7} maxLength={4000} value={form.paymentRequestTemplate} onChange={set("paymentRequestTemplate")} />
            </Field>
            <Button type="button" kind="quiet" aria-label="Reset payment request to default" onClick={() => setForm({ ...form, paymentRequestTemplate: DEFAULT_PAYMENT_REQUEST_TEMPLATE })}>Reset to default</Button>
          </Card>
        </section>}
        <Button type="submit" disabled={busy || logoBusy}>
          <Icon name="check" /> {busy ? "Saving…" : welcome ? "Save and get started" : "Save settings"}
        </Button>
      </form>

      {!welcome && <><section className="settings-section">
        <p className="eyebrow">Connections</p>
        <Card className="connection-card">
          <Connection
            logo="W" tone="whatsapp" name="WhatsApp messages"
            detail="Confirmations, reminders, payment requests"
            on={features.automation}
          />
          <Connection
            logo="€" tone="stripe" name="Card payment links"
            detail="Clients pay online; Sorted marks it paid"
            on={features.paymentLinks}
          />
        </Card>
        {mode === "api" && !(features.automation && features.paymentLinks) && (
          <p className="settings-footnote left">
            Connections are switched on for your account by Sorted during the beta.
          </p>
        )}
      </section>

      <CalendarSettings />
      <DriveSettings />

      <section className="settings-section">
        <p className="eyebrow">Account</p>
        {mode === "demo" ? (
          <>
            <Button kind="quiet" onClick={async () => { await resetDemo(); toast("Demo data reset"); }}>
              Reset demo data
            </Button>
            <Button kind="soft" onClick={() => { signOut(); navigate("/login"); }}>
              Leave the demo and sign up
            </Button>
          </>
        ) : (
          <>
            <Card className="connection-card">
              <div className="connection-row">
                <span className="connection-logo account-logo"><Icon name="user" size={18} /></span>
                <div><strong>{user.email}</strong><span>Logged in</span></div>
              </div>
            </Card>
            <Button kind="quiet" onClick={() => { signOut(); navigate("/login"); }}>
              <Icon name="logout" size={18} /> Log out
            </Button>
          </>
        )}
      </section>
      <p className="settings-footnote">Sorted beta · Made for Irish sole traders</p></>}
    </div>
  );
}

function Connection({
  logo, tone, name, detail, on, soon,
}: {
  logo: string; tone: string; name: string; detail: string; on?: boolean; soon?: boolean;
}) {
  return (
    <div className="connection-row">
      <span className={`connection-logo ${tone}-logo`}>{logo}</span>
      <div><strong>{name}</strong><span>{detail}</span></div>
      <span className={`coming-pill ${on ? "on" : ""}`}>{soon ? "Coming soon" : on ? "Connected" : "Not connected"}</span>
    </div>
  );
}
