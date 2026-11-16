import { Hono } from "hono";
import { and, asc, eq, gte, isNotNull, lt, lte } from "drizzle-orm";
import { exportBounds, exportCsvText, exportFileName, ExportFormat, ExportRange, exportSections, exportXlsx, mileageLog, mileageSection, paidOn, XLSX_TYPE, yearRange } from "@sorted/core";
import { db, schema } from "../db";
import type { AppEnv } from "../app";

export const reportRoutes = new Hono<AppEnv>();

/**
 * GET /api/reports/summary?year=2026 → ReportSummary (see @sorted/core)
 * Two scoped queries compose:
 *   income:   SELECT extract(month from paid_at) m, SUM(amount_cents)
 *             FROM payments WHERE user_id=$1 AND status='paid'
 *             AND paid_at within year GROUP BY m
 *   expenses: same over expenses (status='confirmed', expense_date), plus a
 *             GROUP BY category variant.
 */
reportRoutes.get("/summary", async (c) => {
  const year = Number(c.req.query("year") ?? new Date().getFullYear());
  if (!Number.isInteger(year)) return c.json({ error: "Invalid year" }, 400);
  const from = new Date(`${year}-01-01T00:00:00Z`);
  const to = new Date(`${year + 1}-01-01T00:00:00Z`);
  const userId = c.get("userId");

  const [incomeRows, expenseRows] = await Promise.all([
    db
      .select({
        amountCents: schema.payments.amountCents,
        paidAt: schema.payments.paidAt,
      })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.userId, userId),
          eq(schema.payments.status, "paid"),
          gte(schema.payments.paidAt, from),
          lt(schema.payments.paidAt, to),
        ),
      ),
    db
      .select({
        amountCents: schema.expenses.amountCents,
        expenseDate: schema.expenses.expenseDate,
        category: schema.expenses.category,
      })
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.userId, userId),
          eq(schema.expenses.status, "confirmed"),
          gte(schema.expenses.expenseDate, from),
          lt(schema.expenses.expenseDate, to),
        ),
      ),
  ]);

  const byMonth = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    income_cents: 0,
    expenses_cents: 0,
  }));
  const byCategory = new Map<string, number>();
  for (const row of incomeRows) {
    if (!row.paidAt) continue;
    byMonth[row.paidAt.getUTCMonth()].income_cents += row.amountCents;
  }
  for (const row of expenseRows) {
    if (!row.expenseDate || row.amountCents === null) continue;
    byMonth[row.expenseDate.getUTCMonth()].expenses_cents += row.amountCents;
    if (row.category) {
      byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.amountCents);
    }
  }
  const incomeCents = incomeRows.reduce((sum, row) => sum + row.amountCents, 0);
  const expensesCents = expenseRows.reduce(
    (sum, row) => sum + (row.amountCents ?? 0),
    0,
  );
  return c.json({
    year,
    income_cents: incomeCents,
    expenses_cents: expensesCents,
    profit_cents: incomeCents - expensesCents,
    by_month: byMonth,
    expenses_by_category: [...byCategory.entries()].map(
      ([category, total_cents]) => ({ category, total_cents }),
    ),
  });
});

/**
 * GET /api/reports/export?from=2025-01-01&to=2025-12-31 (both days included), or ?year=2025
 * The two sections an accountant expects, oldest first:
 *   INCOME:   date_paid, client, service, kind, method, amount_eur
 *   EXPENSES: date, merchant, category, amount_eur, has_receipt, vat_eur
 *   MILEAGE:  date, from, to, purpose, km_there_and_back (only when there are trips; km, not money)
 * Header row per section, amounts as decimal euro (cents/100, 2dp).
 */
reportRoutes.get("/export", async (c) => {
  const { from, to, year } = c.req.query();
  const format = ExportFormat.safeParse(c.req.query("format") ?? "csv");
  if (!format.success) return c.json({ error: "Choose xlsx or csv." }, 400);
  let range: ExportRange;
  if (from !== undefined || to !== undefined) {
    const parsed = ExportRange.safeParse({ from, to });
    if (!parsed.success) return c.json({ error: "Choose a from date and a to date, with the from date first." }, 400);
    range = parsed.data;
  } else {
    const wanted = Number(year ?? new Date().getFullYear());
    if (!Number.isInteger(wanted) || wanted < 1000 || wanted > 9998) return c.json({ error: "Invalid year" }, 400);
    range = yearRange(wanted);
  }
  const bounds = exportBounds(range);
  const userId = c.get("userId");
  const [income, expenses, travelled, trips, [user]] = await Promise.all([
    db
      .select({
        paidAt: schema.payments.paidAt,
        client: schema.clients.name,
        service: schema.bookings.service,
        kind: schema.payments.kind,
        method: schema.payments.method,
        amountCents: schema.payments.amountCents,
      })
      .from(schema.payments)
      .innerJoin(schema.bookings, eq(schema.payments.bookingId, schema.bookings.id))
      .innerJoin(schema.clients, eq(schema.bookings.clientId, schema.clients.id))
      .where(
        and(
          eq(schema.payments.userId, userId),
          eq(schema.payments.status, "paid"),
          gte(schema.payments.paidAt, bounds.paidFrom),
          lt(schema.payments.paidAt, bounds.paidBefore),
        ),
      )
      .orderBy(asc(schema.payments.paidAt)),
    db
      .select()
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.userId, userId),
          eq(schema.expenses.status, "confirmed"),
          gte(schema.expenses.expenseDate, bounds.expenseFrom),
          lt(schema.expenses.expenseDate, bounds.expenseBefore),
        ),
      )
      .orderBy(asc(schema.expenses.expenseDate)),
    db
      .select({ booking: schema.bookings, client: schema.clients })
      .from(schema.bookings)
      .innerJoin(schema.clients, eq(schema.bookings.clientId, schema.clients.id))
      .where(
        and(
          eq(schema.bookings.userId, userId),
          isNotNull(schema.bookings.travelMetres),
          gte(schema.bookings.startAt, bounds.paidFrom),
          lt(schema.bookings.startAt, bounds.paidBefore),
        ),
      ),
    db
      .select()
      .from(schema.trips)
      .where(and(eq(schema.trips.userId, userId), gte(schema.trips.tripDate, range.from), lte(schema.trips.tripDate, range.to))),
    db.select({ address: schema.users.address }).from(schema.users).where(eq(schema.users.id, userId)),
  ]);
  const mileage = mileageLog(
    travelled.map(({ booking, client }) => ({ ...booking, startAt: booking.startAt?.toISOString() ?? null, client })),
    trips.map((trip) => ({ ...trip, createdAt: trip.createdAt.toISOString() })),
    range,
  );
  const sections = exportSections(
    income.map((row) => ({ ...row, paidOn: row.paidAt ? paidOn(row.paidAt) : "" })),
    expenses.map((row) => ({
      date: row.expenseDate?.toISOString().slice(0, 10) ?? "",
      merchant: row.merchant,
      category: row.category,
      amountCents: row.amountCents,
      hasReceipt: Boolean(row.receiptKey),
      vatCents: row.vatCents,
    })),
    mileageSection(mileage, user?.address ?? null),
  );
  c.header("Content-Disposition", `attachment; filename=${exportFileName(range, format.data)}`);
  if (format.data === "xlsx") {
    c.header("Content-Type", XLSX_TYPE);
    return c.body(await (await exportXlsx(sections)).arrayBuffer());
  }
  c.header("Content-Type", "text/csv; charset=utf-8");
  return c.body(exportCsvText(sections));
});
