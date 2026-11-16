import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CreateClientInput, formatPhone, normaliseClientPhone } from "@sorted/core";
import { BackButton, Button, Card, EmptyState, Field, Icon, PageHeader, Sheet } from "../components";
import { useAction, useData, useStore } from "../lib/store";
import { searchClients } from "../lib/clientSearch";

export function Clients() {
  const { clients, bookings } = useData();
  const { backend } = useStore();
  const { busy, run, error } = useAction();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [problem, setProblem] = useState<{ phone?: string; email?: string }>({});
  const booked = useMemo(() => {
    const counts = new Map<string, number>();
    for (const booking of bookings) counts.set(booking.clientId, (counts.get(booking.clientId) ?? 0) + 1);
    return counts;
  }, [bookings]);
  const sorted = useMemo(() => [...clients].sort((a, b) => a.name.localeCompare(b.name, "en-IE", { sensitivity: "base" })), [clients]);
  const shown = searchClients(sorted, query);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const phone = form.phone.trim(), email = form.email.trim();
    const issues = {
      phone: phone && !normaliseClientPhone(phone) ? "That mobile number doesn’t look right. Try it like 087 123 4567." : undefined,
      email: email && !CreateClientInput.shape.email.safeParse(email).success ? "Enter a valid email address." : undefined,
    };
    setProblem(issues);
    if (issues.phone || issues.email) return;
    let id: string | undefined;
    const saved = await run(async () => { id = (await backend.createClient({ name: form.name.trim(), phone: phone || undefined, email: email || undefined })).id; }, "Client added");
    if (saved && id) navigate(`/clients/${id}`);
  }

  return <div className="page">
    <BackButton to="/" />
    <PageHeader eyebrow={`${clients.length} ${clients.length === 1 ? "client" : "clients"}`} title="Clients" />
    <div className="client-actions">
      <Button onClick={() => setAdding(true)}><Icon name="plus" size={18} /> Add a client</Button>
      <Link className="button button-soft" to="/clients/import"><Icon name="download" size={18} /> Import a list</Link>
    </div>
    {clients.length > 0 && <Field label="Search"><input name="client-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, number or email" autoComplete="off" /></Field>}
    <Card className="list-card">
      {shown.length ? shown.map((client) => {
        const jobs = booked.get(client.id) ?? 0;
        return <Link className="client-row" key={client.id} to={`/clients/${client.id}`}>
          <div><strong>{client.name}</strong><span>{[formatPhone(client.phone), client.email].filter(Boolean).join(" · ") || "No contact details"}</span></div>
          <span className="client-row-jobs">{jobs ? `${jobs} ${jobs === 1 ? "booking" : "bookings"}` : ""}</span>
          <Icon name="chevron" size={17} />
        </Link>;
      }) : clients.length
        ? <EmptyState icon="user" title="No clients match" small>Check the spelling, or search by number.</EmptyState>
        : <EmptyState icon="user" title="No clients yet" small>Add one here, import your list, or add them as you take bookings.</EmptyState>}
    </Card>
    {adding && <Sheet title="Add a client" onClose={() => setAdding(false)}>
      <form className="form-card" onSubmit={add} noValidate>
        <Field label="Name"><input name="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={200} autoComplete="off" /></Field>
        <Field label="Mobile (optional)" error={problem.phone}><input name="phone" type="tel" inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="087 123 4567" autoComplete="off" /></Field>
        <Field label="Email (optional)" error={problem.email}><input name="email" type="email" inputMode="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoCapitalize="none" autoComplete="off" /></Field>
        {error && <p role="alert" className="sheet-copy">{error}</p>}
        <Button type="submit" disabled={busy || !form.name.trim()}>Save client</Button>
      </form>
    </Sheet>}
  </div>;
}
