import { Link } from "react-router-dom";
import { useState } from "react";
import { calendarDaysBetween, dublinDateTime, irelandToday, moneyOwed, moneyYear, type OwedItem } from "@sorted/core";
import { BookingMessageSheet } from "../BookingMessageSheet";
import type { BookingRow } from "../lib/backend";
import { Button, Card, EmptyState, Icon, MoneyText, PageHeader } from "../components";
import { PaymentActions } from "../PaymentActions";
import { TaxEstimateCard } from "../TaxEstimateCard";
import { euros, jobDateLabel } from "../lib/format";
import { useNow } from "../lib/useNow";
import { download } from "../lib/image";
import { useAction, useData, useStore } from "../lib/store";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function Money() {
  const { bookings, payments, expenses, user } = useData();
  const { backend } = useStore();
  const { busy, run } = useAction();
  const [reminder, setReminder] = useState<{ booking: BookingRow; amount: number } | null>(null);
  const now = useNow();
  const { dueNow, comingUp, dueNowCents, comingUpCents } = moneyOwed(bookings, payments, now);
  const { estimate, monthlyIncomeCents: months } = moneyYear(payments, expenses, user, now);
  const year = estimate.year;
  const thisMonth = Number(dublinDateTime(now).date.slice(5, 7)) - 1;
  const peak = Math.max(...months, 1);

  return (
    <div className="page">
      <PageHeader eyebrow="Money" title="Know where you stand." />
      <Card className={`money-hero-card ${dueNowCents ? "" : "settled"}`}>
        <div className="money-hero-top"><span>Owed to you</span></div>
        <MoneyText cents={dueNowCents} className="money-hero" />
        <p>
          {dueNow.length
            ? `Due now across ${dueNow.length} ${dueNow.length === 1 ? "booking" : "bookings"}`
            : "Nothing due right now"}
        </p>
      </Card>

      <section className="list-section">
        <div className="section-heading">
          <div><p className="eyebrow">To collect</p><h2>Due now</h2></div>
        </div>
        {dueNow.length ? (
          <OwedCards items={dueNow} now={now} onReminder={setReminder} />
        ) : (
          <Card>
            <EmptyState icon="check" tone="paid" title="Nobody owes you anything. Lovely." small />
          </Card>
        )}
      </section>

      {comingUp.length > 0 && <section className="list-section coming-up-section">
        <div className="section-heading"><div><p className="eyebrow">Future jobs</p><h2>Coming up</h2></div><span className="expected-total">{euros(comingUpCents)} expected</span></div>
        <OwedCards items={comingUp} now={now} onReminder={setReminder} comingUp />
      </section>}
      {reminder && <BookingMessageSheet booking={reminder.booking} kind="payment_request" initialAmountCents={reminder.amount} onClose={() => setReminder(null)} />}
      <section className="list-section">
        <div className="section-heading">
          <div><p className="eyebrow">This year</p><h2>{year} so far</h2></div>
        </div>
        <Card className="year-card">
          <p className="year-basis">Year to date · after recorded VAT and reclaimable expense VAT</p>
          <div className="year-stats">
            <div><span>Paid income</span><MoneyText cents={estimate.netIncomeCents} /></div>
            <div><span>Expenses</span><MoneyText cents={estimate.netExpenseCents} /></div>
            <div className="profit-stat">
              <span>Profit before income tax</span><MoneyText cents={estimate.profitCents} />
            </div>
          </div>
          <p className="chart-title">Paid income by month · same year-to-date basis</p>
          <div className="bar-chart" role="img" aria-label={`Paid income after recorded VAT by month, ${year}. ${months.map((amount, i) => `${MONTH_NAMES[i]} ${euros(amount)}`).join(", ")}`}>
            {months.map((month, index) => (
              <div className="bar-column" key={index} title={`${MONTH_NAMES[index]}: ${euros(month)}`}>
                <span
                  className={`${index === thisMonth ? "current" : ""} ${month ? "" : "empty"}`}
                  style={{ height: `${month ? Math.max((month / peak) * 100, 4) : 0}%` }}
                />
              </div>
            ))}
          </div>
          <div className="chart-labels" aria-hidden="true">
            {MONTHS.map((letter, index) => (
              <span key={index} className={index === thisMonth ? "current" : ""}>{letter}</span>
            ))}
          </div>
          <Button
            className="export-button"
            disabled={busy}
            onClick={() =>
              run(async () => download(await backend.exportCsv(year), `sorted-${year}.csv`), "Export downloaded")
            }
          >
            <Icon name="download" /> Export for accountant
          </Button>
          <p className="export-note">A CSV of {year}’s income and expenses, ready for your accountant.</p>
        </Card>
      </section>
      <TaxEstimateCard estimate={estimate} />
    </div>
  );
}

function OwedCards({ items, now, onReminder, comingUp = false }: { items: OwedItem<BookingRow>[]; now: Date; onReminder: (value: { booking: BookingRow; amount: number }) => void; comingUp?: boolean }) {
  return <div className="owed-list">{items.map(({ booking, owedCents, kind }) => {
    const days = booking.paymentRequestedAt ? Math.max(0, calendarDaysBetween(irelandToday(new Date(booking.paymentRequestedAt)), irelandToday(now))) : null;
    return <Card className={`owed-card${comingUp ? " expected-card" : ""}`} key={`${booking.id}-${owedCents}`}>
      <Link to={`/bookings/${booking.id}`} className="owed-main">
        <span className="client-initial">{booking.client.name[0]?.toUpperCase()}</span>
        <div><strong>{booking.client.name}</strong><span>{booking.service} · {kind} · {jobDateLabel(booking.startAt, now)}</span></div>
        <MoneyText cents={owedCents} />
      </Link>
      <div className="owed-card-actions">
        <p className="field-helper">{days === null ? "Not asked yet" : days === 0 ? "Asked today" : `Asked ${days} ${days === 1 ? "day" : "days"} ago`}</p>
        <Button kind={comingUp ? "quiet" : "soft"} onClick={() => onReminder({ booking, amount: owedCents })}>Send reminder</Button>
        <PaymentActions booking={booking} owedCents={owedCents} />
      </div>
    </Card>;
  })}</div>;
}
