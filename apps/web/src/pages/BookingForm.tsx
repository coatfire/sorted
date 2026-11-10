import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { normalisePhone, type Client } from "@sorted/core";
import { BackButton, Button, Card, EmptyState, Field, Icon, MoneyText, PageHeader } from "../components";
import type { BookingRow } from "../lib/backend";
import { centsToInput, confirmCopy, longDay, parseEuros, time, toDateInput, toTimeInput } from "../lib/format";
import { useAction, useData, useStore } from "../lib/store";

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return toDateInput(date);
}

/** Add a booking (/bookings/new) or edit one (/bookings/:id/edit). */
export function BookingForm() {
  const { id } = useParams();
  const { bookings, clients, features } = useData();
  const { backend, toast } = useStore();
  const { busy, run } = useAction();
  const navigate = useNavigate();
  const editing = id ? bookings.find((booking) => booking.id === id) : undefined;

  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [client, setClient] = useState<Client | null>(editing?.client ?? null);
  const [form, setForm] = useState(() => {
    const start = editing ? new Date(editing.startAt) : null;
    return {
      clientName: "",
      clientPhone: "",
      service: editing?.service ?? "",
      date: start ? toDateInput(start) : tomorrow(),
      time: start ? toTimeInput(start) : "10:00",
      price: editing ? centsToInput(editing.priceCents) : "",
      deposit: editing?.depositCents ? centsToInput(editing.depositCents) : "",
      location: editing?.location ?? "",
      notes: editing?.notes ?? "",
    };
  });
  const [showDeposit, setShowDeposit] = useState(Boolean(editing?.depositCents));
  const [showMore, setShowMore] = useState(Boolean(editing?.location || editing?.notes));

  const services = useMemo(
    () =>
      [...new Set(
        [...bookings]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 10)
          .map((booking) => booking.service),
      )].slice(0, 4),
    [bookings],
  );
  const matches = useMemo(() => {
    const query = form.clientName.trim().toLowerCase();
    if (!query || client) return [];
    return clients.filter((c) => c.name.toLowerCase().includes(query)).slice(0, 4);
  }, [client, clients, form.clientName]);

  function update(field: keyof typeof form, value: string) {
    setError("");
    setForm((current) => ({ ...current, [field]: value }));
  }

  if (id && !editing) {
    return (
      <div className="page">
        <Card><EmptyState icon="calendar" title="Booking not found" /></Card>
        <Link className="text-link" to="/">Back to today</Link>
      </div>
    );
  }
  const depositLocked = Boolean(editing && editing.status !== "enquiry");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const priceCents = parseEuros(form.price);
    const depositCents = form.deposit.trim() ? parseEuros(form.deposit) : 0;
    const startAt = new Date(`${form.date}T${form.time}`);
    let phone: string | undefined;
    if (!client && form.clientPhone.trim()) {
      const normalised = normalisePhone(form.clientPhone);
      if (!normalised) return setError("That mobile number doesn’t look right. Try it like 087 123 4567.");
      phone = normalised;
    }
    if (priceCents === null) return setError("Add the price, like 120 or 120.50.");
    if (depositCents === null) return setError("The deposit should be an amount, like 50.");
    if (depositCents > priceCents) return setError("The deposit can’t be more than the price.");
    if (Number.isNaN(startAt.getTime())) return setError("Pick a date and time.");

    const details = {
      service: form.service.trim(),
      startAt: startAt.toISOString(),
      priceCents,
      depositCents,
      location: form.location.trim() || null,
      notes: form.notes.trim() || null,
    };
    if (editing) {
      if (await run(() => backend.updateBooking(editing.id, details))) {
        toast("Booking updated");
        navigate(`/bookings/${editing.id}`, { replace: true });
      }
      return;
    }
    let createdId = "";
    const ok = await run(async () => {
      const created = await backend.createBooking({
        ...details,
        ...(client ? { clientId: client.id } : { client: { name: form.clientName.trim(), phone } }),
      });
      createdId = created.id;
    });
    if (ok) {
      setSavedId(createdId);
      window.scrollTo({ top: 0 });
    }
  }

  const saved = savedId ? bookings.find((booking) => booking.id === savedId) : undefined;
  if (saved) return <Saved booking={saved} automation={features.automation} />;

  return (
    <div className="page form-page">
      {editing && <BackButton />}
      <PageHeader
        eyebrow={editing ? "Edit booking" : "New booking"}
        title={editing ? editing.service : "Who are you seeing?"}
      />
      {!editing && <p className="page-intro">One quick form. That’s it.</p>}
      <form onSubmit={submit} noValidate={false}>
        {!editing && (
          <Card className="form-card">
            {client ? (
              <div className="picked-client">
                <span className="client-initial">{client.name[0]?.toUpperCase()}</span>
                <div>
                  <strong>{client.name}</strong>
                  <span>{client.phone ?? "No mobile on file"}</span>
                </div>
                <button type="button" className="text-link" onClick={() => setClient(null)}>Change</button>
              </div>
            ) : (
              <>
                <Field label="Client name">
                  <div className="input-with-icon">
                    <Icon name="user" />
                    <input
                      required
                      autoFocus
                      value={form.clientName}
                      onChange={(event) => update("clientName", event.target.value)}
                      placeholder="e.g. Sarah Keane"
                      autoComplete="off"
                    />
                  </div>
                </Field>
                {matches.length > 0 && (
                  <div className="client-matches" role="group" aria-label="Existing clients">
                    {matches.map((match) => (
                      <button type="button" key={match.id} onClick={() => { setClient(match); setError(""); }}>
                        <span className="client-initial">{match.name[0]?.toUpperCase()}</span>
                        <span><strong>{match.name}</strong><small>{match.phone ?? "No mobile"}</small></span>
                        <em>Use</em>
                      </button>
                    ))}
                  </div>
                )}
                <Field label="Mobile (optional)" helper="Add a mobile so Sorted can send confirmations for you.">
                  <input
                    type="tel"
                    inputMode="tel"
                    value={form.clientPhone}
                    onChange={(event) => update("clientPhone", event.target.value)}
                    placeholder="087 123 4567"
                    autoComplete="off"
                  />
                </Field>
              </>
            )}
          </Card>
        )}

        <Card className="form-card">
          <Field label="Service">
            <input
              required
              value={form.service}
              onChange={(event) => update("service", event.target.value)}
              placeholder="e.g. Bridal makeup"
            />
          </Field>
          {!editing && services.length > 0 && (
            <div className="suggestion-row">
              {services.map((service) => (
                <button type="button" key={service} onClick={() => update("service", service)}>
                  {service}
                </button>
              ))}
            </div>
          )}
          <div className="field-grid">
            <Field label="Date">
              <input required type="date" value={form.date} onChange={(event) => update("date", event.target.value)} />
            </Field>
            <Field label="Time">
              <input required type="time" value={form.time} onChange={(event) => update("time", event.target.value)} />
            </Field>
          </div>
          <Field label="Price">
            <div className="money-input">
              <span>€</span>
              <input
                required
                inputMode="decimal"
                value={form.price}
                onChange={(event) => update("price", event.target.value)}
                placeholder="0.00"
              />
            </div>
          </Field>

          {depositLocked ? (
            editing!.depositCents > 0 && (
              <p className="field-helper">
                Deposit <MoneyText cents={editing!.depositCents} /> — fixed once a booking is confirmed.
              </p>
            )
          ) : !showDeposit ? (
            <button type="button" className="reveal-button" onClick={() => setShowDeposit(true)}>
              <Icon name="plus" size={17} /> Add deposit
            </button>
          ) : (
            <Field label="Deposit" helper="Requested when you confirm the booking.">
              <div className="money-input">
                <span>€</span>
                <input
                  inputMode="decimal"
                  value={form.deposit}
                  onChange={(event) => update("deposit", event.target.value)}
                  placeholder="0.00"
                />
              </div>
            </Field>
          )}

          {!showMore ? (
            <button type="button" className="reveal-button" onClick={() => setShowMore(true)}>
              <Icon name="plus" size={17} /> Location or notes
            </button>
          ) : (
            <>
              <Field label="Location">
                <input
                  value={form.location}
                  onChange={(event) => update("location", event.target.value)}
                  placeholder="Studio, venue or address"
                />
              </Field>
              <Field label="Notes">
                <textarea
                  value={form.notes}
                  onChange={(event) => update("notes", event.target.value)}
                  placeholder="Anything useful to remember"
                  rows={3}
                />
              </Field>
            </>
          )}
        </Card>
        <div className={`sticky-action ${error ? "has-error" : ""}`}>
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : "Save booking"} <Icon name="arrow" />
          </Button>
        </div>
      </form>
    </div>
  );
}

/** The automation moment is explicit and consented, every time. */
function Saved({ booking, automation }: { booking: BookingRow; automation: boolean }) {
  const { backend } = useStore();
  const { busy, run } = useAction();
  const navigate = useNavigate();
  const copy = confirmCopy(booking.client, automation);
  return (
    <div className="page success-page">
      <div className="success-mark"><Icon name="check" size={32} /></div>
      <h1>Booking saved.</h1>
      <p className="success-copy">{booking.client.name} · {booking.service}</p>
      <Card className="saved-summary">
        <div>
          <Icon name="calendar" />
          <span>{longDay(booking.startAt)}, {time(booking.startAt)}</span>
        </div>
        <div>
          <Icon name="wallet" />
          <MoneyText cents={booking.priceCents} />
        </div>
      </Card>
      <Button
        disabled={busy}
        onClick={async () => {
          if (await run(() => backend.confirmBooking(booking.id), "Booking confirmed")) {
            navigate(`/bookings/${booking.id}`, { replace: true });
          }
        }}
      >
        <Icon name={copy.caption ? "check" : "message"} /> {copy.label}
      </Button>
      {copy.caption && <p className="button-caption">{copy.caption}</p>}
      <Link className="text-link" to={`/bookings/${booking.id}`} replace>Keep as enquiry</Link>
    </div>
  );
}
