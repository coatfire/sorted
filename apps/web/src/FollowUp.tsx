import { useState } from "react";
import { Link } from "react-router-dom";
import { addCalendarDays, calendarDaysBetween, CalendarDate, irelandToday } from "@sorted/core";
import { Button, Field, Sheet } from "./components";
import type { BookingRow } from "./lib/backend";
import { firstName, longDay, whatsappLink } from "./lib/format";
import { useAction, useData, useStore } from "./lib/store";
import { useValidation } from "./lib/useValidation";

export function FollowUpLater({ booking, onClose }: { booking: BookingRow; onClose: () => void }) {
  const { backend } = useStore();
  const { busy, run } = useAction();
  const today = irelandToday();
  const [date, setDate] = useState(booking.followUpOn || addCalendarDays(today, 1));
  const validation = useValidation({ date: () => CalendarDate.safeParse(date).success ? undefined : "Pick a valid date." });
  async function save(value: string | null) {
    if (await run(() => backend.followUp(booking.id, value), "Follow-up updated")) onClose();
  }
  return <Sheet title="Follow up later" onClose={onClose}>
    <p className="sheet-copy">When would you like to follow up with {firstName(booking.client.name)}?</p>
    {([[1, "Tomorrow"], [3, "In 3 days"], [7, "Next week"]] as const).map(([days, label]) =>
      <Button key={days} kind="soft" disabled={busy} onClick={() => save(addCalendarDays(today, days))}>{label}</Button>)}
    <form className="action-stack" noValidate onSubmit={(event) => { event.preventDefault(); if (validation.validate(event.currentTarget)) void save(date); }}>
      <Field label="Or pick a date" {...validation.field("date")}><input name="date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></Field>
      <Button type="submit" disabled={busy}>Save date</Button>
    </form>
    <Button kind="quiet" disabled={busy} onClick={() => save(null)}>Remove follow-up</Button>
  </Sheet>;
}

function FollowUpMessage({ booking, onClose }: { booking: BookingRow; onClose: () => void }) {
  const { user } = useData();
  const [message, setMessage] = useState(`Hi ${firstName(booking.client.name)}, just following up on your enquiry about ${booking.service} on ${longDay(booking.startAt)}. Would you like me to book you in?\n\n${user.businessName || user.name || "Your trader"}`);
  const email = booking.client.email;
  const emailLink = email ? `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(`Your enquiry — ${booking.service}`)}&body=${encodeURIComponent(message)}` : "";
  return <Sheet title="Follow up" onClose={onClose}>
    <p className="sheet-copy">Opens a draft in your app. Review it and tap send there. Sorted won’t mark it as sent.</p>
    <Field label="Message"><textarea rows={6} value={message} onChange={(event) => setMessage(event.target.value)} /></Field>
    {booking.client.phone && message.trim() ? <a className="button button-primary" href={whatsappLink(booking.client.phone, message)} target="_blank" rel="noreferrer">WhatsApp</a> : <><Button disabled>WhatsApp</Button><p className="sheet-copy">{!booking.client.phone ? "No mobile number added for this client." : "Add a message to open a draft."}</p></>}
    {email && message.trim() ? <a className="button button-soft" href={emailLink}>Email</a> : <><Button kind="soft" disabled>Email</Button><p className="sheet-copy">{!email ? "No email address added for this client." : "Add a message to open a draft."}</p></>}
    <Button kind="quiet" onClick={onClose}>Done</Button>
  </Sheet>;
}

export function FollowUps({ bookings: due }: { bookings: BookingRow[] }) {
  const [selected, setSelected] = useState<{ booking: BookingRow; action: "message" | "later" } | null>(null);
  const today = irelandToday();
  if (!due.length) return null;
  return <div className="attention-group">
    <h3>Follow up</h3>
    {due.map((booking) => {
      const days = calendarDaysBetween(booking.followUpOn!, today);
      return <div className="attention-followup" key={booking.id}>
        <Link className="attention-followup-main" to={`/bookings/${booking.id}`}><strong>{booking.client.name}</strong><span>{booking.service} · {days === 0 ? "Due today" : `${days} ${days === 1 ? "day" : "days"} overdue`}</span></Link>
        <div className="attention-followup-actions"><Button kind="quiet" onClick={() => setSelected({ booking, action: "message" })}>Message</Button><Button kind="quiet" onClick={() => setSelected({ booking, action: "later" })}>Remind me later</Button></div>
      </div>;
    })}
    {selected?.action === "message" && <FollowUpMessage booking={selected.booking} onClose={() => setSelected(null)} />}
    {selected?.action === "later" && <FollowUpLater booking={selected.booking} onClose={() => setSelected(null)} />}
  </div>;
}
