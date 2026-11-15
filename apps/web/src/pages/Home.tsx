import { useState } from "react";
import { Link } from "react-router-dom";
import { bookingAgenda, bookingStage, dublinDateTime, moneyOwed } from "@sorted/core";
import { Button, Card, EmptyState, Icon, MoneyText, StatusChip } from "../components";
import type { BookingRow as Booking } from "../lib/backend";
import { euros, firstName } from "../lib/format";
import { useAction, useData, useStore } from "../lib/store";
import { appointmentWhen, irelandDayLabel, irelandDayMonth, irelandLongDay, irelandTime } from "../lib/today";
import { useNow } from "../lib/useNow";
import { FollowUps } from "../FollowUp";

export function BookingRow({ booking, lead }: { booking: Booking; lead?: string }) {
  return <Link className="booking-row" to={`/bookings/${booking.id}`}>
    <time dateTime={booking.startAt}>{lead ?? irelandTime(booking.startAt)}</time>
    <div className="booking-row-main"><strong>{booking.client.name}</strong><span>{booking.service}</span></div>
    <div className="booking-row-trailing"><MoneyText cents={booking.priceCents} /><StatusChip status={booking.status} /></div>
    <Icon name="chevron" size={17} />
  </Link>;
}

function GroupedRows({ bookings, now }: { bookings: Booking[]; now: Date }) {
  return <>{bookings.map((booking, index) => {
    const previous = bookings[index - 1];
    const newDay = !previous || dublinDateTime(previous.startAt).date !== dublinDateTime(booking.startAt).date;
    return <div key={booking.id}>
      {newDay && <p className="date-divider">{irelandDayLabel(booking.startAt, now)}</p>}
      <BookingRow booking={booking} />
    </div>;
  })}</>;
}

export function Home() {
  const { bookings, payments, user } = useData();
  const { backend } = useStore();
  const { busy, run, error, committed } = useAction();
  const [showLater, setShowLater] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const now = useNow();
  const { nextAppointment: next, followUps, wrapUp, todays, upcoming, later, past } = bookingAgenda(bookings, now);
  const { dueNow, dueNowCents } = moneyOwed(bookings, payments, now);
  const clientsOwing = new Set(dueNow.map(item => item.booking.clientId)).size;
  const needsAttention = followUps.length > 0 || wrapUp.length > 0 || dueNow.length > 0;
  const hour = Number(dublinDateTime(now).time.slice(0, 2));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const who = user.name?.trim() ? firstName(user.name) : user.businessName;
  const nextState = next ? bookingStage(next, payments, now) : null;
  const depositDue = next && nextState ? Math.max(0, next.depositCents - (next.priceCents - nextState.owedCents)) : 0;
  const paymentPhrase = nextState ? nextState.owedCents === 0 ? "Paid in full" : depositDue > 0 ? `${euros(depositDue)} deposit due` : `${euros(nextState.owedCents)} still to pay` : "";

  return <div className="page">
    <header className="brand-header">
      <div><p className="brand-wordmark">Sorted<span>.</span></p><p className="header-greeting">{greeting}{who ? `, ${who}` : ""}</p></div>
      <Link className="icon-button" to="/settings" aria-label="Settings"><Icon name="settings" /></Link>
    </header>

    <Card className="next-appointment">
      {next ? <>
        <Link className="next-appointment-main" to={`/bookings/${next.id}`}>
          <p className="eyebrow">Next appointment</p>
          <h1>{appointmentWhen(next.startAt, now)}</h1>
          <strong>{next.client.name}</strong><span>{next.service}</span>
          <p className="appointment-payment">{paymentPhrase}</p>
          <span className="appointment-detail">View booking <Icon name="arrow" size={16} /></span>
        </Link>
        {next.location && <a className="appointment-location" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(next.location)}`} target="_blank" rel="noreferrer"><Icon name="map" size={18} /><span>{next.location}<small>Get directions</small></span></a>}
      </> : <><p className="eyebrow">Next appointment</p><EmptyState icon="calendar" title="No appointments ahead" small>Tap + to book your next appointment.</EmptyState></>}
    </Card>

    {needsAttention && <section className="needs-attention list-section">
      <div className="section-heading compact"><h2>Needs attention</h2></div>
      <Card className="attention-card">
        <FollowUps bookings={followUps} />
        {wrapUp.length > 0 && <div className="attention-group"><h3>To wrap up</h3>
          {wrapUp.map(booking => <div className="attention-row" key={booking.id}>
            <Link to={`/bookings/${booking.id}`}><strong>{booking.client.name}</strong><span>{booking.service} · {irelandDayMonth(booking.startAt)}</span></Link>
            {booking.status === "confirmed" ? <Button kind="quiet" disabled={busy || Boolean(committed && error)} onClick={() => run(() => backend.completeBooking(booking.id), "Marked complete")}>Mark complete</Button> : <Link className="attention-action" to={`/bookings/${booking.id}`}>Review enquiry</Link>}
          </div>)}
          {error && <p role="alert" className="sheet-copy">{error}</p>}
          {error && committed && <Button kind="quiet" onClick={() => window.location.reload()}>Reload</Button>}
        </div>}
        {dueNow.length > 0 && <div className="attention-group">
          <Link className="attention-money" to="/money">{euros(dueNowCents)} owed by {clientsOwing} {clientsOwing === 1 ? "client" : "clients"}<Icon name="arrow" size={16} /></Link>
          {dueNow.slice(0, 3).map(({ booking, owedCents, kind }) => <Link className="attention-owed attention-row" key={booking.id} to={`/bookings/${booking.id}`}><div><strong>{booking.client.name}</strong><span>{kind} · {booking.service}</span></div><MoneyText cents={owedCents} /></Link>)}
        </div>}
      </Card>
    </section>}

    {!user.businessName && <Link className="card nudge-card" to="/settings"><Icon name="sparkles" /><div><strong>Welcome to Sorted</strong><span>Add your business name so clients know who’s messaging them.</span></div><Icon name="chevron" size={17} /></Link>}

    <section className="list-section">
      <div className="section-heading"><div><p className="eyebrow">Today</p><h2>{irelandLongDay(now)}</h2></div></div>
      <Card className="list-card">{todays.length ? todays.map(booking => <BookingRow key={booking.id} booking={booking} />) : <EmptyState icon="calendar" title={bookings.length ? "Your day is clear" : "No bookings yet"} small>Tap + to log a booking.</EmptyState>}</Card>
    </section>
    <section className="list-section">
      <div className="section-heading"><div><p className="eyebrow">Next two weeks</p><h2>Upcoming</h2></div></div>
      <Card className="list-card">{upcoming.length ? <GroupedRows bookings={upcoming} now={now} /> : <EmptyState icon="calendar" title="Nothing in the next two weeks" small />}</Card>
      {later.length > 0 && <><button className="disclosure" aria-expanded={showLater} onClick={() => setShowLater(!showLater)}>Later · {later.length} {later.length === 1 ? "booking" : "bookings"}<Icon name="chevron" size={15} /></button>{showLater && <Card className="list-card"><GroupedRows bookings={later} now={now} /></Card>}</>}
      {past.length > 0 && <><button className="disclosure" aria-expanded={showPast} onClick={() => setShowPast(!showPast)}>Past bookings<Icon name="chevron" size={15} /></button>{showPast && <Card className="list-card">{past.map(booking => <BookingRow key={booking.id} booking={booking} lead={irelandDayMonth(booking.startAt)} />)}</Card>}</>}
    </section>
  </div>;
}
