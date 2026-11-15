import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { assembleBookingDocument, type DriveBackup } from "@sorted/core";
import { db, schema } from "../db";
import { env } from "../lib/env";
import { publicUser } from "../lib/user";
import type { AppEnv } from "../app";

export const driveRoutes = new Hono<AppEnv>();
driveRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (!env.googleClientId()) return c.json({ error: "Not found" }, 404);
  await next();
});

driveRoutes.get("/files", async (c) => {
  const userId = c.get("userId");
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const documents = await db.select({ document: schema.invoices, booking: schema.bookings, client: schema.clients })
    .from(schema.invoices)
    .innerJoin(schema.bookings, and(eq(schema.bookings.id, schema.invoices.bookingId), eq(schema.bookings.userId, userId)))
    .innerJoin(schema.clients, and(eq(schema.clients.id, schema.bookings.clientId), eq(schema.clients.userId, userId)))
    .where(eq(schema.invoices.userId, userId));
  const payments = await db.select().from(schema.payments).where(eq(schema.payments.userId, userId));
  const expenses = await db.select().from(schema.expenses).where(eq(schema.expenses.userId, userId));
  const photos = await db.select({ id: schema.expenses.id, receiptKey: schema.expenses.receiptKey, date: sql<Date>`coalesce(${schema.expenses.expenseDate}, ${schema.expenses.createdAt})`.mapWith(schema.expenses.createdAt), merchant: schema.expenses.merchant, contentType: schema.receipts.contentType })
    .from(schema.expenses).innerJoin(schema.receipts, and(eq(sql`${schema.receipts.id}::text`, schema.expenses.receiptKey), eq(schema.receipts.userId, userId)))
    .where(eq(schema.expenses.userId, userId));
  const safeUser = { ...publicUser(user), createdAt: user.createdAt.toISOString(), emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null, driveBackedUpAt: user.driveBackedUpAt?.toISOString() ?? null };
  const paid = payments.map((payment) => ({ ...payment, paidAt: payment.paidAt?.toISOString() ?? null, createdAt: payment.createdAt.toISOString() }));
  const years = new Set<number>();
  for (const payment of payments) if (payment.status === "paid" && payment.paidAt) years.add(payment.paidAt.getUTCFullYear());
  for (const expense of expenses) if (expense.status === "confirmed" && expense.expenseDate) years.add(expense.expenseDate.getUTCFullYear());
  return c.json<DriveBackup>({ userId, logo: user.invoiceLogo, years: [...years].sort(), photos: photos.map((photo) => ({ ...photo, date: photo.date.toISOString().slice(0, 10) })), documents: documents.map(({ document, booking, client }) => {
    const data = assembleBookingDocument(
      safeUser,
      { ...booking, startAt: booking.startAt.toISOString(), endAt: booking.endAt?.toISOString() ?? null, completedAt: booking.completedAt?.toISOString() ?? null, paymentRequestedAt: booking.paymentRequestedAt?.toISOString() ?? null, createdAt: booking.createdAt.toISOString() },
      { ...client, createdAt: client.createdAt.toISOString() }, paid,
      { ...document, issuedAt: document.issuedAt.toISOString() },
    );
    return data;
  }) });
});

driveRoutes.post("/backed-up", async (c) => {
  const [user] = await db.update(schema.users).set({ driveBackedUpAt: new Date() }).where(eq(schema.users.id, c.get("userId"))).returning({ driveBackedUpAt: schema.users.driveBackedUpAt });
  return c.json(user);
});
