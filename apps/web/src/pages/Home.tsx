import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, EmptyState, Icon, MoneyText, StatusChip } from "../components";
import type { BookingRow as Booking } from "../lib/backend";
import { dayLabel, daysBetween, firstName, dayMonth, longDay, startOfDay, time } from "../lib/format";
import { useData } from "../lib/store";

export function BookingRow({ booking, lead }: { booking: Booking; lead?: string }) {
  return (
    <Link className="booking-row" to={`/bookings/${booking.id}`}>
      <time dateTime={booking.startAt}>{lead ?? time(booking.startAt)}</time>
      <div className="booking-row-main">
        <strong>{booking.client.name}</strong>
        <span>{booking.service}</span>
      </div>
      <div className="booking-row-trailing">
        <MoneyText cents={booking.priceCents} />
        <StatusChip status={booking.status} />
      </div>
      <Icon name="chevron" size={17} />
    </Link>
  );
}

/** Rows with a day heading whenever the date changes. */
function GroupedRows({ bookings }: { bookings: Booking[] }) {
  return (
    <>
      {bookings.map((booking, index) => {
        const previous = bookings[index - 1];
        const newDay = !previous || daysBetween(new Date(previous.startAt), new Date(booking.startAt)) !== 0;
        return (
          <div key={booking.id}>
            {newDay && <p className="date-divider">{dayLabel(booking.startAt)}</p>}
            <BookingRow booking={booking} />
          </div>
        );
      })}
    </>
  );
}

export function Home() {
  const { bookings, payments, user } = useData();
  const [showLater, setShowLater] = useState(false);
  const [showPast, setShowPast] = useState(false);

  const today = startOfDay();
  const byStart = [...bookings].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const open = byStart.filter((b) => b.status === "enquiry" || b.status === "confirmed");
  const offset = (b: Booking) => daysBetween(today, new Date(b.startAt));

  // Jobs whose date has passed but were never closed out — without this list
  // they'd vanish from the app and the balance would never be requested.
  const wrapUp = open.filter((b) => offset(b) < 0);
  const todays = byStart.filter((b) => offset(b) === 0 && b.status !== "cancelled");
  const upcoming = open.filter((b) => offset(b) > 0 && offset(b) <= 14);
  const later = open.filter((b) => offset(b) > 14);
  const past = byStart
    .filter((b) => (b.status === "completed" || b.status === "cancelled") && offset(b) < 0)
    .reverse()
    .slice(0, 20);

  const owed = payments
    .filter((payment) => payment.status === "pending")
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const who = user.name ? firstName(user.name) : null;
  const brandNew = bookings.length === 0;

  return (
    <div className="page">
      <header className="brand-header">
        <div>
          <p className="brand-wordmark">Sorted<span>.</span></p>
          <p className="header-greeting">{greeting}{who ? `, ${who}` : ""}</p>
        </div>
        <Link className="icon-button" to="/settings" aria-label="Settings">
          <Icon name="settings" />
        </Link>
      </header>

      {!user.businessName && (
        <Link className="card nudge-card" to="/settings">
          <span className="empty-icon"><Icon name="sparkles" /></span>
          <div>
            <strong>Welcome to Sorted</strong>
            <span>Add your business name so clients know who’s messaging them.</span>
          </div>
          <Icon name="chevron" size={17} />
        </Link>
      )}

      <Card className="snapshot-card">
        <div>
          <span className="snapshot-label">Today</span>
          <strong>{todays.length} {todays.length === 1 ? "booking" : "bookings"}</strong>
        </div>
        <div className="snapshot-divider" />
        <Link to="/money">
          <span className="snapshot-label">Owed to you</span>
          <MoneyText cents={owed} />
          <Icon name="arrow" size={16} />
        </Link>
      </Card>

      {brandNew ? (
        <Card>
          <EmptyState icon="calendar" title="No bookings yet">
            Tap + to log your first — it takes 30 seconds.
          </EmptyState>
        </Card>
      ) : (
        <>
          {wrapUp.length > 0 && (
            <section className="list-section">
              <div className="section-heading">
                <div>
                  <p className="eyebrow due-text">To wrap up</p>
                  <h2>Done? Mark it complete</h2>
                </div>
                <span className="count-badge due">{wrapUp.length}</span>
              </div>
              <Card className="list-card">
                {wrapUp.map((booking) => (
                  <BookingRow key={booking.id} booking={booking} lead={dayMonth(booking.startAt)} />
                ))}
              </Card>
            </section>
          )}

          <section className="list-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Today</p>
                <h2>{longDay(new Date())}</h2>
              </div>
            </div>
            <Card className="list-card">
              {todays.length ? (
                todays.map((booking) => <BookingRow key={booking.id} booking={booking} />)
              ) : (
                <EmptyState icon="calendar" title="Your day is clear" small>
                  Tap + to log a booking.
                </EmptyState>
              )}
            </Card>
          </section>

          <section className="list-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Next two weeks</p>
                <h2>Upcoming</h2>
              </div>
            </div>
            <Card className="list-card">
              {upcoming.length ? (
                <GroupedRows bookings={upcoming} />
              ) : (
                <EmptyState icon="calendar" title="Nothing in the next two weeks" small />
              )}
            </Card>
            {later.length > 0 && (
              <>
                <button className="disclosure" aria-expanded={showLater} onClick={() => setShowLater(!showLater)}>
                  Later · {later.length} {later.length === 1 ? "booking" : "bookings"}
                  <Icon name="chevron" size={15} />
                </button>
                {showLater && <Card className="list-card"><GroupedRows bookings={later} /></Card>}
              </>
            )}
            {past.length > 0 && (
              <>
                <button className="disclosure" aria-expanded={showPast} onClick={() => setShowPast(!showPast)}>
                  Past bookings
                  <Icon name="chevron" size={15} />
                </button>
                {showPast && (
                  <Card className="list-card">
                    {past.map((booking) => (
                      <BookingRow key={booking.id} booking={booking} lead={dayMonth(booking.startAt)} />
                    ))}
                  </Card>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
