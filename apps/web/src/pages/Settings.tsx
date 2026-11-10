import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { normalisePhone } from "@sorted/core";
import { BackButton, Button, Card, Field, Icon, PageHeader } from "../components";
import { useAction, useData, useSession, useStore } from "../lib/store";

export function Settings() {
  const { user, features } = useData();
  const { backend, resetDemo, toast } = useStore();
  const { mode, signOut } = useSession();
  const { busy, run } = useAction();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    businessName: user.businessName ?? "",
    name: user.name ?? "",
    phone: user.phone ?? "",
    reviewLink: user.reviewLink ?? "",
  });
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => {
    setError("");
    setForm({ ...form, [field]: event.target.value });
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const phone = form.phone.trim() ? normalisePhone(form.phone) : null;
    if (form.phone.trim() && !phone) {
      return setError("That mobile number doesn’t look right. Try it like 087 123 4567.");
    }
    let reviewLink: string | null = form.reviewLink.trim() || null;
    if (reviewLink && !/^https?:\/\//i.test(reviewLink)) reviewLink = `https://${reviewLink}`;
    await run(
      () =>
        backend.updateUser({
          businessName: form.businessName.trim() || null,
          name: form.name.trim() || null,
          phone,
          reviewLink,
        }),
      "Settings saved",
    );
  }

  return (
    <div className="page">
      <BackButton to="/" />
      <PageHeader eyebrow="Settings" title="Your business" />
      <p className="page-intro">The details clients see in messages from you.</p>
      <form onSubmit={submit}>
        <Card className="form-card settings-card">
          <Field label="Business name">
            <input required value={form.businessName} onChange={set("businessName")} placeholder="e.g. Studio by Shane" />
          </Field>
          <Field label="Your name">
            <input value={form.name} onChange={set("name")} autoComplete="given-name" />
          </Field>
          <Field label="Your mobile">
            <input type="tel" inputMode="tel" value={form.phone} onChange={set("phone")} placeholder="087 123 4567" />
          </Field>
          <Field label="Google review link" helper="Sent to clients two days after a completed job.">
            <input inputMode="url" value={form.reviewLink} onChange={set("reviewLink")} placeholder="https://g.page/r/…" />
          </Field>
          <Field label="Currency">
            <div className="locked-field">EUR · Euro <span>Fixed during beta</span></div>
          </Field>
          {error && <p className="form-error" role="alert">{error}</p>}
        </Card>
        <Button type="submit" disabled={busy}>
          <Icon name="check" /> {busy ? "Saving…" : "Save settings"}
        </Button>
      </form>

      <section className="settings-section">
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
      <p className="settings-footnote">Sorted beta · Made for Irish sole traders</p>
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
