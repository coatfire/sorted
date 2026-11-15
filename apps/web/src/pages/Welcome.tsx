import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Services } from "@sorted/core";
import { Button, Card, Field, Icon, PageHeader } from "../components";
import { ServiceEditor } from "../ServiceEditor";
import { useAction, useData, useStore } from "../lib/store";
import { centsToInput } from "../lib/format";
import { serviceValues, type ServiceDraft } from "../lib/setup";
import { useValidation } from "../lib/useValidation";

export function Welcome() {
  const { user } = useData(), { backend } = useStore();
  const { busy, run, error, committed } = useAction();
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState(user.businessName ?? "");
  const [name, setName] = useState(user.name ?? "");
  const [rows, setRows] = useState<ServiceDraft[]>(() => (user.services ?? []).slice(0, 3).map(service => ({ id: crypto.randomUUID(), name: service.name, price: centsToInput(service.priceCents) })));
  const [submitted, setSubmitted] = useState(false);
  const [servicesError, setServicesError] = useState<string>();
  const validation = useValidation({ businessName: () => !businessName.trim() ? "Enter your business name." : undefined });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || committed) return;
    setSubmitted(true);
    const values = serviceValues(rows);
    if (!validation.validate(event.currentTarget) || !values.success) return;
    const services = Services.safeParse([...values.data, ...(user.services ?? []).slice(3)]);
    if (!services.success) { setServicesError("Use a different name for each service."); return; }
    if (await run(() => backend.updateUser({ businessName: businessName.trim(), name: name.trim() || null, services: services.data }))) navigate("/", { replace: true });
  }
  return <div className="page welcome-page">
    <PageHeader eyebrow="Welcome to Sorted" title="Make yourself at home." />
    <p className="page-intro">Start with the basics. You can add the rest when you need it.</p>
    <form onSubmit={submit} noValidate>
      <Card className="form-card">
        <Field label="Business name" {...validation.field("businessName")}><input name="businessName" required maxLength={200} value={businessName} onChange={event => setBusinessName(event.target.value)} placeholder="e.g. Studio by Shane" /></Field>
        <Field label="Your name (optional)"><input name="name" maxLength={200} value={name} onChange={event => setName(event.target.value)} autoComplete="name" /></Field>
      </Card>
      <section className="settings-section"><h2>What do you offer? <small>(optional)</small></h2><p className="sheet-copy">Add up to 3 services to make your first booking quicker.</p><Card><ServiceEditor rows={rows} onChange={setRows} limit={3} submitted={submitted} /></Card></section>
      {error && <p role="alert" className="sheet-copy">{error}</p>}
      {servicesError && <p role="alert" className="sheet-copy">{servicesError}</p>}
      {committed && error && <Button kind="soft" onClick={() => window.location.reload()}>Reload</Button>}
      <Button type="submit" disabled={busy || committed}><Icon name="check" />{busy ? "Saving…" : "Save and get started"}</Button>
    </form>
  </div>;
}
