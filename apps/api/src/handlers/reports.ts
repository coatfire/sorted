import { Hono } from "hono";
import { and, eq, gte, lt } from "drizzle-orm";
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
 * GET /api/reports/export?year=2026&format=csv
 * Streams the two sections an accountant expects:
 *   INCOME:   date_paid, client, service, kind, method, amount_eur
 *   EXPENSES: date, merchant, category, amount_eur, has_receipt
 * Header row per section, amounts as decimal euro (cents/100, 2dp).
 * c.header("Content-Disposition", `attachment; filename=sorted-${year}.csv`)
 */
reportRoutes.get("/export", async (c) => {
  const year = Number(c.req.query("year") ?? new Date().getFullYear());
  if (!Number.isInteger(year)) return c.json({ error: "Invalid year" }, 400);
  const from = new Date(`${year}-01-01T00:00:00Z`);
  const to = new Date(`${year + 1}-01-01T00:00:00Z`);
  const userId = c.get("userId");
  const [income, expenses] = await Promise.all([
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
          gte(schema.payments.paidAt, from),
          lt(schema.payments.paidAt, to),
        ),
      ),
    db
      .select()
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
  const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = [
    ["INCOME"],
    ["date_paid", "client", "service", "kind", "method", "amount_eur"],
    ...income.map((row) => [
      row.paidAt?.toISOString().slice(0, 10),
      row.client,
      row.service,
      row.kind,
      row.method,
      (row.amountCents / 100).toFixed(2),
    ]),
    [],
    ["EXPENSES"],
    ["date", "merchant", "category", "amount_eur", "has_receipt", "vat_eur"],
    ...expenses.map((row) => [
      row.expenseDate?.toISOString().slice(0, 10),
      row.merchant,
      row.category,
      ((row.amountCents ?? 0) / 100).toFixed(2),
      row.receiptKey ? "yes" : "no",
      row.vatCents === null ? "" : (row.vatCents / 100).toFixed(2),
    ]),
  ];
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename=sorted-${year}.csv`);
  return c.body(lines.map((row) => row.map(csvCell).join(",")).join("\n"));
});
