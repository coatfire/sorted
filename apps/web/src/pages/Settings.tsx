import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { normalisePhone, normaliseIban, normaliseBic, validIban, validBic } from "@sorted/core";
import { BackButton, Button, Card, Field, Icon, PageHeader } from "../components";
import { useAction, useData, useSession, useStore } from "../lib/store";
import { useValidation } from "../lib/useValidation";

export function Settings({ welcome = false }: { welcome?: boolean }) {
  const { user, features } = useData();
  const { backend, resetDemo, toast } = useStore();
  const { mode, signOut } = useSession();
  const { busy, run } = useAction();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    businessName: user.businessName ?? "",
    name: user.name ?? "",
    phone: user.phone ?? "",
    reviewLink: user.reviewLink ?? "",
    address: user.address ?? "",
    iban: user.iban ?? "",
    bic: user.bic ?? "",
  });
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => {
    setForm({ ...form, [field]: event.target.value });
  };
  const validation = useValidation({
    phone: () => form.phone.trim() && !normalisePhone(form.phone)
      ? "That mobile number doesn’t look right. Try it like 087 123 4567." : undefined,
    name: () => welcome && !form.name.trim() ? "Enter your name." : undefined,
    businessName: () => welcome && !form.businessName.trim() ? "Enter your business name." : undefined,
    iban: () => form.iban.trim() && !validIban(form.iban) ? "Enter a valid IBAN." : undefined,
    bic: () => form.bic.trim() && !validBic(form.bic) ? "Enter a valid BIC." : undefined,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
          bic: form.bic.trim() ? normaliseBic(form.bic) : null,
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
          {!welcome && <Field label="Google review link" helper="Sent to clients two days after a completed job.">
            <input inputMode="url" value={form.reviewLink} onChange={set("reviewLink")} placeholder="https://g.page/r/…" />
          </Field>}
          {!welcome && <Field label="Currency">
            <div className="locked-field">EUR · Euro <span>Fixed during beta</span></div>
          </Field>}
        </Card>
        <Button type="submit" disabled={busy}>
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
          <Connection logo="G" tone="calendar" name="Google Calendar" detail="Bookings appear in your calendar" soon />
        </Card>
        {mode === "api" && !(features.automation && features.paymentLinks) && (
          <p className="settings-footnote left">
            Connections are switched on for your account by Sorted during the beta.
          </p>
        )}
      </section>

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
