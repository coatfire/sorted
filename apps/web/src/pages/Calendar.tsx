import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { addCalendarMonths, bookingsByDay, CalendarDate, CalendarMonth, FIRST_CALENDAR_MONTH, irelandToday, LAST_CALENDAR_MONTH, monthWeeks } from "@sorted/core";
import { Button, Card, EmptyState, Icon, PageHeader, Sheet } from "../components";
import { useData } from "../lib/store";
import { useNow } from "../lib/useNow";
import { BookingRow } from "./Home";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
const formatDay = (options: Intl.DateTimeFormatOptions) => (day: string) => new Intl.DateTimeFormat("en-IE", { ...options, timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
const monthTitle = (month: string) => formatDay({ month: "long", year: "numeric" })(`${month}-01`);
const monthName = (month: string) => formatDay({ month: "short" })(`${month}-01`);
const longDay = formatDay({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDay = formatDay({ weekday: "short", day: "numeric", month: "short" });
const count = (total: number, noun: "booking" | "enquiry" | "job") => `${total} ${total === 1 ? noun : noun === "enquiry" ? "enquiries" : `${noun}s`}`;

/** Month view of every dated booking. Tap a day for its jobs, or to add one. */
export function Calendar() {
  const { bookings } = useData();
  const today = irelandToday(useNow());
  const [params, setParams] = useSearchParams();
  const [picking, setPicking] = useState<number | null>(null);
  const dayParam = CalendarDate.safeParse(params.get("day")).success && CalendarMonth.safeParse(params.get("day")!.slice(0, 7)).success ? params.get("day")! : null;
  const monthParam = CalendarMonth.safeParse(params.get("month")).success ? params.get("month")! : null;
  const month = monthParam ?? (dayParam ?? today).slice(0, 7);
  const candidate = dayParam ?? (monthParam ? null : today);
  const selected = candidate?.startsWith(month) ? candidate : null;
  const byDay = bookingsByDay(bookings);
  const monthDays = [...byDay.keys()].filter((day) => day.startsWith(month)).sort();
  const show = (next: string, day?: string) => setParams(day ? { month: next, day } : { month: next }, { replace: true });
  const jobs = selected ? byDay.get(selected) ?? [] : [];

  return <div className="page">
    <PageHeader title="Calendar" action={month !== today.slice(0, 7) || selected !== today
      ? <Button kind="quiet" className="calendar-today" onClick={() => show(today.slice(0, 7), today)}>Today</Button> : undefined} />

    <Card className="calendar-card">
      <div className="calendar-nav">
        <button className="icon-button" aria-label="Previous month" disabled={month === FIRST_CALENDAR_MONTH} onClick={() => show(addCalendarMonths(month, -1))}><Icon name="chevron" /></button>
        <button className="calendar-title" aria-haspopup="dialog" onClick={() => setPicking(Number(month.slice(0, 4)))}><h2 aria-live="polite">{monthTitle(month)}</h2><span>Change month</span></button>
        <button className="icon-button" aria-label="Next month" disabled={month === LAST_CALENDAR_MONTH} onClick={() => show(addCalendarMonths(month, 1))}><Icon name="chevron" /></button>
      </div>
      <div className="calendar-grid" role="group" aria-label={monthTitle(month)}>
        {WEEKDAYS.map((weekday) => <span className="calendar-weekday" key={weekday} aria-hidden="true">{weekday}</span>)}
        {monthWeeks(month).flat().map((day) => {
          if (!day.startsWith(month)) return <span key={day} />;
          const dayJobs = byDay.get(day) ?? [];
          const enquiries = dayJobs.filter((booking) => booking.status === "enquiry").length;
          const booked = dayJobs.length - enquiries;
          const summary = [booked ? count(booked, "booking") : null, enquiries ? count(enquiries, "enquiry") : null].filter(Boolean).join(", ");
          return <button key={day} className={`calendar-day${day === today ? " is-today" : ""}`} aria-pressed={day === selected}
            aria-label={`${longDay(day)}${day === today ? ", today" : ""}, ${summary || "nothing booked"}`} onClick={() => show(month, day)}>
            <span>{Number(day.slice(8))}</span>
            <span className="calendar-marks" aria-hidden="true">
              {dayJobs.slice(0, 3).map((booking) => <i key={booking.id} className={booking.status === "enquiry" ? "is-enquiry" : undefined} />)}
              {dayJobs.length > 3 && <b>+</b>}
            </span>
          </button>;
        })}
      </div>
      <p className="calendar-legend" aria-hidden="true"><span><i />Booked</span><span><i className="is-enquiry" />Enquiry</span></p>
    </Card>

    {selected ? <section className="list-section">
      <div className="section-heading"><div><p className="eyebrow">{selected === today ? "Today" : jobs.length ? count(jobs.length, "job") : "Free"}</p><h2>{longDay(selected)}</h2></div></div>
      <Card className="list-card">{jobs.length ? jobs.map((booking) => <BookingRow key={booking.id} booking={booking} />)
        : <EmptyState icon="calendar" title="Nothing booked" small>Add a booking or an enquiry for this day.</EmptyState>}</Card>
      <Link className="button button-primary" to={`/bookings/new?date=${selected}`}><Icon name="plus" size={18} />Add booking for {shortDay(selected)}</Link>
    </section> : <section className="list-section">
      <div className="section-heading"><div><p className="eyebrow">{count(monthDays.reduce((total, day) => total + byDay.get(day)!.length, 0), "job")}</p><h2>{monthTitle(month)}</h2></div></div>
      <Card className="list-card">{monthDays.length ? monthDays.map((day) => <div key={day}>
        <p className="date-divider">{shortDay(day)}</p>
        {byDay.get(day)!.map((booking) => <BookingRow key={booking.id} booking={booking} />)}
      </div>) : <EmptyState icon="calendar" title="Nothing booked this month" small>Tap a day to add a booking.</EmptyState>}</Card>
    </section>}

    {picking !== null && <Sheet title="Go to month" onClose={() => setPicking(null)}>
      <div className="calendar-nav">
        <button className="icon-button" aria-label="Previous year" disabled={picking <= 2000} onClick={() => setPicking(picking - 1)}><Icon name="chevron" /></button>
        <h3 aria-live="polite">{picking}</h3>
        <button className="icon-button" aria-label="Next year" disabled={picking >= 2099} onClick={() => setPicking(picking + 1)}><Icon name="chevron" /></button>
      </div>
      <div className="calendar-months">
        {MONTHS.map((item) => {
          const value = `${picking}-${item}`;
          const total = [...byDay.keys()].filter((day) => day.startsWith(value)).reduce((sum, day) => sum + byDay.get(day)!.length, 0);
          return <button key={value} aria-pressed={value === month} aria-label={`${monthTitle(value)}, ${count(total, "job")}`} onClick={() => { show(value); setPicking(null); }}>
            {monthName(value)}<small aria-hidden="true">{total || ""}</small>
          </button>;
        })}
      </div>
    </Sheet>}
  </div>;
}
