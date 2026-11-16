import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, exists, inArray, isNotNull, isNull, not, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  bookingAtDublinTime, historyJobs, ImportClientsInput, ImportHistoryInput, irelandToday, paidOn, paymentPaidAt, planClientImport, planHistoryImport,
  type ImportBatch, type ImportClientsResult, type ImportHistoryResult, type UndoImportResult,
} from "@sorted/core";
import { db, schema } from "../db";
import type { AppEnv } from "../app";

export const importRoutes = new Hono<AppEnv>();

// One import at a time per trader: a double tap or two tabs can't add the same file twice.
const lockUser = (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userId: string) =>
  tx.select({ id: schema.users.id, vatRegistered: schema.users.vatRegistered, vatRateBp: schema.users.vatRateBp }).from(schema.users).where(eq(schema.users.id, userId)).for("update");

importRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const held = (table: typeof schema.clients | typeof schema.payments | typeof schema.expenses) =>
    sql<number>`(select count(*) from ${table} as held where held.import_id = "imports"."id" and held.user_id = ${userId})`;
  const rows = await db.select({ batch: schema.imports, clients: held(schema.clients), payments: held(schema.payments), expenses: held(schema.expenses) })
    .from(schema.imports).where(eq(schema.imports.userId, userId)).orderBy(desc(schema.imports.createdAt));
  const batches: ImportBatch[] = rows.map(({ batch, clients, payments, expenses }) => ({
    id: batch.id, kind: batch.kind === "history" ? "history" : "clients", fileName: batch.fileName, createdAt: batch.createdAt.toISOString(),
    clients: Number(clients), payments: Number(payments), expenses: Number(expenses),
  }));
  return c.json(batches);
});

const chunks = <T>(rows: T[], size = 500) => Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));
const nameKey = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Past income and expenses from a spreadsheet. Each payment becomes a completed, fully paid job in the past.
 * Nothing is sent and no receipt is issued: the jobs are marked as already reminded and already asked for a review.
 */
importRoutes.post("/history", async (c) => {
  const parsed = ImportHistoryInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const today = irelandToday();
  if (parsed.data.income.some((row) => row.paid_on > today) || parsed.data.expenses.some((row) => row.date > today)) {
    return c.json({ error: "Only past income and expenses can be imported." }, 400);
  }
  const userId = c.get("userId");
  const result = await db.transaction(async (tx): Promise<ImportHistoryResult> => {
    const [user] = await lockUser(tx, userId);
    if (!user) throw new Error("User not found");
    // The rate in force now, as for a payment recorded by hand today.
    const vatRateBp = user.vatRegistered ? user.vatRateBp ?? 0 : 0;
    const [paid, spent, clients] = await Promise.all([
      tx.select({ paidAt: schema.payments.paidAt, client: schema.clients.name, service: schema.bookings.service, amount_cents: schema.payments.amountCents })
        .from(schema.payments)
        .innerJoin(schema.bookings, eq(schema.payments.bookingId, schema.bookings.id))
        .innerJoin(schema.clients, eq(schema.bookings.clientId, schema.clients.id))
        .where(and(eq(schema.payments.userId, userId), eq(schema.payments.status, "paid"), isNotNull(schema.payments.paidAt))),
      tx.select({ date: schema.expenses.expenseDate, merchant: schema.expenses.merchant, amount_cents: schema.expenses.amountCents })
        .from(schema.expenses).where(and(eq(schema.expenses.userId, userId), isNotNull(schema.expenses.expenseDate), isNotNull(schema.expenses.amountCents))),
      tx.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients)
        .where(eq(schema.clients.userId, userId)).orderBy(asc(schema.clients.createdAt), asc(schema.clients.id)),
    ]);
    // Decided again here, against what is in the database now, so the same file sent twice adds nothing.
    const plan = planHistoryImport(parsed.data, {
      income: paid.map((row) => ({ ...row, paid_on: paidOn(row.paidAt!) })),
      expenses: spent.map((row) => ({ date: row.date!.toISOString().slice(0, 10), merchant: row.merchant ?? "", amount_cents: row.amount_cents! })),
    });
    if (!plan.income.length && !plan.expenses.length) return { importId: null, payments: 0, expenses: 0, clients: 0, alreadyThere: plan.alreadyThere };
    const [batch] = await tx.insert(schema.imports).values({ userId, kind: "history", fileName: parsed.data.file_name ?? null }).returning();
    const importId = batch!.id, from = parsed.data.file_name ? `Imported from ${parsed.data.file_name}` : "Imported";

    // Two clients with one name: the payment goes to the one added first.
    const known = new Map<string, string>();
    for (const client of clients) if (!known.has(nameKey(client.name))) known.set(nameKey(client.name), client.id);
    const jobs = historyJobs(plan.income);
    const added: (typeof schema.clients.$inferInsert)[] = [];
    for (const job of jobs) {
      if (known.has(nameKey(job.client))) continue;
      const id = randomUUID();
      known.set(nameKey(job.client), id);
      added.push({ id, userId, importId, name: job.client });
    }
    const bookings: (typeof schema.bookings.$inferInsert)[] = [], payments: (typeof schema.payments.$inferInsert)[] = [];
    for (const job of jobs) {
      // The file gives the day the money came in, not a time, so the job is on that day with no time.
      const bookingId = randomUUID(), last = job.payments.at(-1)!.paid_on, at = paymentPaidAt(last), day = bookingAtDublinTime(last, "00:00");
      bookings.push({
        id: bookingId, userId, importId, clientId: known.get(nameKey(job.client))!, service: job.service, status: "completed",
        startAt: day, timeTbc: true, completedAt: at, reminderSentAt: at, reviewRequestedAt: at, createdAt: at, notes: from,
        priceCents: job.payments.reduce((sum, payment) => sum + payment.amount_cents, 0),
        depositCents: job.payments.length > 1 ? job.payments[0]!.amount_cents : 0,
      });
      for (const payment of job.payments) {
        const paidAt = paymentPaidAt(payment.paid_on);
        payments.push({
          userId, importId, bookingId, kind: payment.kind, method: payment.method, status: "paid", amountCents: payment.amount_cents,
          paidAt, createdAt: paidAt, vatRateBp,
        });
      }
    }
    const expenses = plan.expenses.map((row): typeof schema.expenses.$inferInsert => ({
      userId, importId, merchant: row.merchant, category: row.category, amountCents: row.amount_cents, vatCents: row.vat_cents,
      expenseDate: new Date(`${row.date}T00:00:00Z`), status: "confirmed",
    }));
    for (const rows of chunks(added)) await tx.insert(schema.clients).values(rows);
    for (const rows of chunks(bookings)) await tx.insert(schema.bookings).values(rows);
    for (const rows of chunks(payments)) await tx.insert(schema.payments).values(rows);
    for (const rows of chunks(expenses)) await tx.insert(schema.expenses).values(rows);
    return { importId, payments: payments.length, expenses: expenses.length, clients: added.length, alreadyThere: plan.alreadyThere };
  });
  return c.json(result, result.importId ? 201 : 200);
});

importRoutes.post("/clients", async (c) => {
  const parsed = ImportClientsInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const userId = c.get("userId");
  const rows = parsed.data.clients.map(({ name, phone, email, notes }) => ({ name: name.trim(), phone, email: email?.toLowerCase(), notes }));
  const result = await db.transaction(async (tx): Promise<ImportClientsResult> => {
    await lockUser(tx, userId);
    const existing = await tx.select({ name: schema.clients.name, phone: schema.clients.phone, email: schema.clients.email })
      .from(schema.clients).where(eq(schema.clients.userId, userId));
    // Decided again here, against what is in the database now, so the same file sent twice adds nothing.
    const plan = planClientImport(rows, existing);
    const alreadyThere = plan.alreadyThere + plan.repeated;
    if (!plan.add.length) return { importId: null, added: 0, alreadyThere };
    const [batch] = await tx.insert(schema.imports).values({ userId, kind: "clients", fileName: parsed.data.file_name ?? null }).returning();
    await tx.insert(schema.clients).values(plan.add.map((row) => ({ userId, importId: batch!.id, ...row })));
    return { importId: batch!.id, added: plan.add.length, alreadyThere };
  });
  return c.json(result, result.added ? 201 : 200);
});

importRoutes.delete("/:id", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("confirm" in body) || body.confirm !== true) {
    return c.json({ error: "Confirm undoing the import with confirm: true." }, 400);
  }
  const userId = c.get("userId"), id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "Import not found" }, 404);
  const result = await db.transaction(async (tx): Promise<UndoImportResult | null> => {
    await lockUser(tx, userId);
    const [batch] = await tx.select().from(schema.imports).where(and(eq(schema.imports.id, id), eq(schema.imports.userId, userId)));
    if (!batch) return null;
    // Anything the trader has built on since is real work, so it stays: an expense given a receipt photo,
    // and a job with a document, a message or a payment added by hand.
    const spent = await tx.delete(schema.expenses)
      .where(and(eq(schema.expenses.userId, userId), eq(schema.expenses.importId, id), isNull(schema.expenses.receiptKey))).returning({ id: schema.expenses.id });
    // A job goes or stays whole: removing one of its payments would leave the rest of its price looking unpaid.
    const other = alias(schema.payments, "other");
    const jobUsed = or(
      exists(tx.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.bookingId, schema.payments.bookingId))),
      exists(tx.select({ id: schema.messageLog.id }).from(schema.messageLog).where(eq(schema.messageLog.bookingId, schema.payments.bookingId))),
      exists(tx.select({ id: other.id }).from(other).where(and(eq(other.bookingId, schema.payments.bookingId), sql`${other.importId} is distinct from ${id}`))))!;
    const paid = await tx.delete(schema.payments).where(and(eq(schema.payments.userId, userId), eq(schema.payments.importId, id), not(jobUsed))).returning({ id: schema.payments.id });
    await tx.delete(schema.bookings).where(and(eq(schema.bookings.userId, userId), eq(schema.bookings.importId, id),
      notExists(tx.select({ id: schema.payments.id }).from(schema.payments).where(eq(schema.payments.bookingId, schema.bookings.id))),
      notExists(tx.select({ id: schema.invoices.id }).from(schema.invoices).where(eq(schema.invoices.bookingId, schema.bookings.id))),
      notExists(tx.select({ id: schema.messageLog.id }).from(schema.messageLog).where(eq(schema.messageLog.bookingId, schema.bookings.id)))));
    const mine = and(eq(schema.clients.userId, userId), eq(schema.clients.importId, id));
    // A client who has been given a booking since is real work, so they stay.
    const unused = and(mine, notExists(tx.select({ id: schema.bookings.id }).from(schema.bookings).where(eq(schema.bookings.clientId, schema.clients.id))));
    const ids = (await tx.select({ id: schema.clients.id }).from(schema.clients).where(unused).orderBy(schema.clients.id).for("update")).map((row) => row.id);
    if (ids.length) {
      await tx.delete(schema.messageLog).where(and(eq(schema.messageLog.userId, userId), isNotNull(schema.messageLog.clientId), inArray(schema.messageLog.clientId, ids)));
      await tx.delete(schema.clients).where(and(eq(schema.clients.userId, userId), inArray(schema.clients.id, ids)));
    }
    const left = (table: typeof schema.clients | typeof schema.payments | typeof schema.expenses) =>
      tx.select({ kept: count() }).from(table).where(and(eq(table.userId, userId), eq(table.importId, id))).then(([row]) => Number(row?.kept ?? 0));
    const history = batch.kind === "history";
    const removed = history ? paid.length + spent.length : ids.length;
    const kept = history ? await left(schema.payments) + await left(schema.expenses) : await left(schema.clients);
    await tx.delete(schema.imports).where(and(eq(schema.imports.id, id), eq(schema.imports.userId, userId)));
    return { removed, kept };
  });
  return result ? c.json(result) : c.json({ error: "Import not found" }, 404);
});
