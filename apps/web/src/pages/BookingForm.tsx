import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { normaliseClientPhone, CreateClientInput, CalendarDate, irelandToday, addCalendarDays, bookAgainStart, bookingAtDublinTime, dublinDateTime, RepeatInput, type Client } from "@sorted/core";
import { BackButton, Button, Card, EmptyState, Field, Icon, MoneyText, PageHeader } from "../components";
import type { BookingRow } from "../lib/backend";
import { centsToInput, formatPhone, longDay, parseEuros, time } from "../lib/format";
import { bookingServiceChips, serviceChipPrice } from "../lib/bookingServices";
import { BookingMessageSheet } from "../BookingMessageSheet";
import { useAction, useData, useStore } from "../lib/store";
import { useValidation } from "../lib/useValidation";

function tomorrow() {
  return addCalendarDays(irelandToday(), 1);
}

/** Add a booking (/bookings/new) or edit one (/bookings/:id/edit). */
export function BookingForm() {
  const { id } = useParams();
  const { bookings, clients, user } = useData();
  const { backend, toast } = useStore();
  const { busy, run, error, committed } = useAction();
  const navigate = useNavigate();
  const editing = id ? bookings.find((booking) => booking.id === id) : undefined;
  const [params] = useSearchParams();
  const original = !id ? bookings.find((booking) => booking.id === params.get("again") && booking.status !== "enquiry") : undefined;
  const initial = editing ?? original;
  const [weeks, setWeeks] = useState(1);
  const [repeatEvery, setRepeatEvery] = useState("");
  const [repeatCount, setRepeatCount] = useState("2");
  const [showRepeat, setShowRepeat] = useState(false);
  const [priceFromChip, setPriceFromChip] = useState(false);
  const [savedCount, setSavedCount] = useState(1);

  const [savedId, setSavedId] = useState<string | null>(null);
  const [client, setClient] = useState<Client | null>(initial?.client ?? null);
  const [form, setForm] = useState(() => {
    const start = editing ? dublinDateTime(editing.startAt) : original ? dublinDateTime(bookAgainStart(original.startAt)) : null;
    return {
      clientName: "",
      clientPhone: "",
      clientEmail: "",
      service: initial?.service ?? "",
      date: start ? start.date : tomorrow(),
      time: start ? start.time : "10:00",
      price: initial ? centsToInput(initial.priceCents) : "",
      deposit: initial?.depositCents ? centsToInput(initial.depositCents) : "",
      location: initial?.location ?? "",
      notes: initial?.notes ?? "",
    };
  });
  const [showDeposit, setShowDeposit] = useState(Boolean(initial?.depositCents));
  const [showMore, setShowMore] = useState(Boolean(initial?.location || initial?.notes));
  const validation = useValidation({
    repeatCount: () => repeatEvery && !RepeatInput.safeParse({ every_weeks: Number(repeatEvery), count: Number(repeatCount) }).success ? "Choose 2 to 12 bookings." : undefined,
    clientEmail: () => !client && form.clientEmail.trim() && !CreateClientInput.shape.email.safeParse(form.clientEmail.trim()).success
      ? "Enter a valid email address." : undefined,
    clientPhone: () => form.clientPhone.trim() && !normaliseClientPhone(form.clientPhone)
      ? "That mobile number doesn’t look right. Try it like 087 123 4567." : undefined,
    price: () => {
      const price = parseEuros(form.price);
      if (price === null) return "Add the price, like 120 or 120.50.";
      if (editing && editing.status !== "enquiry" && editing.depositCents > price) {
        return "The deposit can’t be more than the price.";
      }
    },
    deposit: () => {
      const deposit = form.deposit.trim() ? parseEuros(form.deposit) : 0;
      const price = parseEuros(form.price);
      if (deposit === null) return "The deposit should be an amount, like 50.";
      if (price !== null && deposit > price) return "The deposit can’t be more than the price.";
    },
    date: () => !CalendarDate.safeParse(form.date).success ? "Pick a valid date." : undefined,
    time: () => !form.time || Number.isNaN(new Date(`${form.date}T${form.time}`).getTime())
      ? "Pick a date and time." : undefined,
  });

  const services = useMemo(() => bookingServiceChips(user.services ?? [], bookings), [user.services, bookings]);
  const matches = useMemo(() => {
    const query = form.clientName.trim().toLowerCase();
    if (!query || client) return [];
    return clients.filter((c) => c.name.toLowerCase().includes(query)).slice(0, 4);
  }, [client, clients, form.clientName]);

  function update(field: keyof typeof form, value: string) {
    validation.field(field).onChangeCapture();
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || committed) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const status = submitter instanceof HTMLButtonElement && submitter.value === "enquiry" ? "enquiry" : "confirmed";
    if (!validation.validate(event.currentTarget)) return;
    const priceCents = parseEuros(form.price);
    const depositCents = form.deposit.trim() ? parseEuros(form.deposit) : 0;
    const startAt = bookingAtDublinTime(form.date, form.time, editing?.startAt);
    let phone: string | undefined;
    if (!client && form.clientPhone.trim()) {
      const normalised = normaliseClientPhone(form.clientPhone);
      phone = normalised ?? undefined;
    }
    if (priceCents === null || depositCents === null) return;

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
    let count = 1;
    const ok = await run(async () => {
      const created = await backend.createBooking({
        ...details,
        status,
        ...(repeatEvery ? { repeat: { everyWeeks: RepeatInput.parse({ every_weeks: Number(repeatEvery), count: Number(repeatCount) }).every_weeks, count: Number(repeatCount) } } : {}),
        ...(client ? { clientId: client.id } : { client: { name: form.clientName.trim(), phone, email: form.clientEmail.trim() || undefined } }),
      });
      createdId = created.id;
      count = created.seriesCount;
    });
    if (ok) {
      toast(`${count} ${count === 1 ? "booking" : "bookings"} added`);
      setSavedCount(count);
      setSavedId(createdId);
      window.scrollTo({ top: 0 });
    }
  }

  const saved = savedId ? bookings.find((booking) => booking.id === savedId) : undefined;
  if (saved) return <Saved booking={saved} count={savedCount} />;

  return (
    <div className="page form-page">
      {editing && <BackButton />}
      <PageHeader
        eyebrow={editing ? "Edit booking" : "New booking"}
        title={editing ? editing.service : original ? "Book again" : "Who are you seeing?"}
      />
      {!editing && <p className="page-intro">One quick form. That’s it.</p>}
      {error && <p className="sheet-copy" role="alert">{error}</p>}
      {committed && error && <Button kind="soft" onClick={() => window.location.reload()}>Reload</Button>}
      <form onSubmit={submit} noValidate>
        {!editing && (
          <Card className="form-card">
            {client ? (
              <div className="picked-client">
                <span className="client-initial">{client.name[0]?.toUpperCase()}</span>
                <div>
                  <strong>{client.name}</strong>
                  <span>{formatPhone(client.phone) || "No mobile on file"}</span>
                </div>
                <button type="button" className="text-link" onClick={() => setClient(null)}>Change</button>
              </div>
            ) : (
              <>
                <Field label="Client name" {...validation.field("clientName")}>
                  <div className="input-with-icon">
                    <Icon name="user" />
                    <input
                      required
                      name="clientName"
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
                      <button type="button" key={match.id} onClick={() => { setClient(match); validation.clear(); }}>
                        <span className="client-initial">{match.name[0]?.toUpperCase()}</span>
                        <span><strong>{match.name}</strong><small>{formatPhone(match.phone) || "No mobile"}</small></span>
                        <em>Use</em>
                      </button>
                    ))}
                  </div>
                )}
                <Field label="Mobile (optional)" helper="For WhatsApp drafts you send yourself." {...validation.field("clientPhone")}>
                  <input
                    type="tel"
                    inputMode="tel"
                    name="clientPhone" value={form.clientPhone}
                    onChange={(event) => update("clientPhone", event.target.value)}
                    placeholder="087 123 4567"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Email (optional)" {...validation.field("clientEmail")}>
                  <input name="clientEmail" type="email" autoComplete="email" value={form.clientEmail} onChange={(event) => update("clientEmail", event.target.value)} />
                </Field>
              </>
            )}
          </Card>
        )}

        <Card className="form-card">
          <Field label="Service" {...validation.field("service")}>
            <input
              required
              name="service"
              value={form.service}
              onChange={(event) => update("service", event.target.value)}
              placeholder="e.g. Bridal makeup"
            />
          </Field>
          {!editing && services.length > 0 && (
            <div className="suggestion-row">
              {services.map((service) => (
                <button type="button" key={service.name.toLowerCase()} onClick={() => {
                  const next = serviceChipPrice(form.price, priceFromChip, service);
                  validation.clear();
                  setForm(current => ({ ...current, service: service.name, price: next.price }));
                  setPriceFromChip(next.fromChip);
                }}>
                  {service.name} · <MoneyText cents={service.priceCents} />
                </button>
              ))}
            </div>
          )}
          <div className="field-grid">
            <Field label="Date" {...validation.field("date")}>
              <input name="date" required type="date" value={form.date} onChange={(event) => update("date", event.target.value)} />
            </Field>
            <Field label="Time" {...validation.field("time")}>
              <input name="time" required type="time" value={form.time} onChange={(event) => update("time", event.target.value)} />
            </Field>
          </div>
          {original && <div className="repeat-week-chips" role="group" aria-label="Book again in">
            {([1, 2, 4, 6] as const).map((value) => <button type="button" aria-pressed={weeks === value} key={value} onClick={() => {
              setWeeks(value);
              const next = dublinDateTime(bookAgainStart(original.startAt, value));
              setForm((current) => ({ ...current, date: next.date, time: next.time }));
            }}>{value} {value === 1 ? "week" : "weeks"}</button>)}
          </div>}
          <Field label="Price" {...validation.field("price")}>
            <div className="money-input">
              <span>€</span>
              <input
                required
                inputMode="decimal"
                name="price" value={form.price}
                onChange={(event) => { update("price", event.target.value); setPriceFromChip(false); }}
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
            <Field label="Deposit" helper="Requested when you confirm the booking." {...validation.field("deposit")}>
              <div className="money-input">
                <span>€</span>
                <input
                  inputMode="decimal"
                  name="deposit" value={form.deposit}
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
        {!editing && <Card className="form-card">
          {!showRepeat ? <button type="button" className="reveal-button" onClick={() => setShowRepeat(true)}>
            <Icon name="plus" size={17} /> Repeat this booking
          </button> : <>
          <Field label="Repeat" helper="Times stay the same in Ireland. Your save choice applies to every booking.">
            <select name="repeatEvery" value={repeatEvery} onChange={(event) => setRepeatEvery(event.target.value)}>
              <option value="">Doesn’t repeat</option><option value="1">Every week</option><option value="2">Every 2 weeks</option><option value="4">Every 4 weeks</option>
            </select>
          </Field>
          {repeatEvery && <Field label="How many times" helper="Total bookings, including the first. Choose 2 to 12." {...validation.field("repeatCount")}>
            <input name="repeatCount" type="number" inputMode="numeric" min="2" max="12" step="1" required value={repeatCount} onChange={(event) => setRepeatCount(event.target.value)} />
          </Field>}
          </>}
        </Card>}
        <div className={`sticky-action ${validation.hasErrors ? "has-error" : ""}`}>
          <Button type="submit" disabled={busy || committed}>
            {busy ? "Saving…" : editing ? "Save changes" : "Save booking"} <Icon name="arrow" />
          </Button>
          {!editing && <Button type="submit" name="status" value="enquiry" kind="quiet" disabled={busy || committed}>Save as enquiry</Button>}
        </div>
      </form>
    </div>
  );
}

function Saved({ booking, count }: { booking: BookingRow; count: number }) {
  const [message, setMessage] = useState(false);
  const navigate = useNavigate();
  const confirmed = booking.status === "confirmed";
  return (
    <div className="page success-page">
      <div className="success-mark"><Icon name="check" size={32} /></div>
      <h1>{confirmed ? count > 1 ? `${count} bookings added` : "Booked" : "Saved as enquiry"}</h1>
      {!confirmed && <p className="sheet-copy">
        {booking.followUpOn ? `We’ll remind you on ${longDay(`${booking.followUpOn}T12:00:00Z`)}.` : "No follow-up set. You can add one from Today."}
        {count > 1 && ` ${count} enquiries saved; only the first has a follow-up reminder.`}
      </p>}
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
      {confirmed && <>
        <Button onClick={() => setMessage(true)}><Icon name="message" /> Send confirmation</Button>
        <p className="button-caption">Opens a draft{count > 1 ? " for the first booking" : ""} for you to review and send.</p>
      </>}
      <Button kind="soft" onClick={() => navigate(`/bookings/${booking.id}`, { replace: true })}>Done</Button>
      {message && <BookingMessageSheet booking={booking} kind="confirmation" onClose={() => setMessage(false)} />}
    </div>
  );
}
