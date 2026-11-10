import { Link } from "react-router-dom";
import { Button, Card, EmptyState, Icon, MoneyText, PageHeader } from "../components";
import { PaymentActions } from "../PaymentActions";
import { daysBetween, euros, kindLabel } from "../lib/format";
import { download } from "../lib/image";
import { useAction, useData, useStore } from "../lib/store";

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function Money() {
  const { bookings, payments, expenses } = useData();
  const { backend } = useStore();
  const { busy, run } = useAction();
  const year = new Date().getFullYear();
  const thisMonth = new Date().getMonth();

  // Oldest first — that's the order to chase in.
  const pending = payments
    .filter((payment) => payment.status === "pending")
    .map((payment) => ({ payment, booking: bookings.find((b) => b.id === payment.bookingId)! }))
    .filter((item) => item.booking)
    .sort((a, b) => a.payment.createdAt.localeCompare(b.payment.createdAt));
  const owed = pending.reduce((sum, item) => sum + item.payment.amountCents, 0);

  const months = MONTHS.map(() => ({ income: 0, expenses: 0 }));
  for (const payment of payments) {
    if (payment.status !== "paid" || !payment.paidAt) continue;
    const paidAt = new Date(payment.paidAt);
    if (paidAt.getFullYear() === year) months[paidAt.getMonth()].income += payment.amountCents;
  }
  for (const expense of expenses) {
    if (expense.status !== "confirmed" || !expense.expenseDate || !expense.amountCents) continue;
    const date = new Date(expense.expenseDate);
    if (date.getFullYear() === year) months[date.getMonth()].expenses += expense.amountCents;
  }
  const income = months.reduce((sum, month) => sum + month.income, 0);
  const expenseTotal = months.reduce((sum, month) => sum + month.expenses, 0);
  const peak = Math.max(...months.map((month) => month.income), 1);

  return (
    <div className="page">
      <PageHeader eyebrow="Money" title="Know where you stand." />
      <Card className={`money-hero-card ${owed ? "" : "settled"}`}>
        <div className="money-hero-top"><span>Owed to you</span></div>
        <MoneyText cents={owed} className="money-hero" />
        <p>
          {pending.length
            ? `Across ${pending.length} ${pending.length === 1 ? "payment" : "payments"}`
            : "All settled up"}
        </p>
      </Card>

      <section className="list-section">
        <div className="section-heading">
          <div><p className="eyebrow">To collect</p><h2>Outstanding</h2></div>
        </div>
        {pending.length ? (
          <div className="owed-list">
            {pending.map(({ payment, booking }) => {
              const days = daysBetween(new Date(payment.createdAt), new Date());
              return (
                <Card className="owed-card" key={payment.id}>
                  <Link to={`/bookings/${booking.id}`} className="owed-main">
                    <span className="client-initial">{booking.client.name[0]?.toUpperCase()}</span>
                    <div>
                      <strong>{booking.client.name}</strong>
                      <span>
                        {booking.service} · {kindLabel(payment.kind).toLowerCase()} ·{" "}
                        {days <= 0 ? "today" : days === 1 ? "1 day" : `${days} days`}
                      </span>
                    </div>
                    <MoneyText cents={payment.amountCents} />
                  </Link>
                  <PaymentActions payment={payment} booking={booking} />
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <EmptyState icon="check" tone="paid" title="Nobody owes you anything. Lovely." small />
          </Card>
        )}
      </section>

      <section className="list-section">
        <div className="section-heading">
          <div><p className="eyebrow">This year</p><h2>{year} at a glance</h2></div>
        </div>
        <Card className="year-card">
          <div className="year-stats">
            <div><span>Income</span><MoneyText cents={income} /></div>
            <div><span>Expenses</span><MoneyText cents={expenseTotal} /></div>
            <div className="profit-stat">
              <span>Profit</span><MoneyText cents={income - expenseTotal} />
            </div>
          </div>
          <p className="chart-title">Income by month</p>
          <div className="bar-chart" role="img" aria-label={`Income by month, ${year}. ${months.map((m, i) => `${MONTH_NAMES[i]} ${euros(m.income)}`).join(", ")}`}>
            {months.map((month, index) => (
              <div className="bar-column" key={index} title={`${MONTH_NAMES[index]}: ${euros(month.income)}`}>
                <span
                  className={`${index === thisMonth ? "current" : ""} ${month.income ? "" : "empty"}`}
                  style={{ height: `${month.income ? Math.max((month.income / peak) * 100, 4) : 0}%` }}
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
    </div>
  );
}
