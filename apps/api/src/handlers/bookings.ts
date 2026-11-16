/**
 * REFERENCE IMPLEMENTATION.
 *
 * This file demonstrates the pattern every handler follows:
 *   1. Validate input with the zod schema from @sorted/core (parse at the edge)
 *   2. Do the DB work with Drizzle, always scoped by userId
 *   3. Emit a domain event if something automation-worthy happened
 *   4. Return the row(s) — no wrapper envelopes, errors as { error }
 *
 * All booking routes follow the same edge-validation and user-scoping pattern.
 */
import { Hono } from "hono";
import { and, eq, gte, lte, desc, sql } from "drizzle-orm";
import {
  BookingStatus,
  CreateBookingInput,
  UpdateBookingInput,
  CreateDocumentInput,
  snapshotReceipt,
  snapshotDocument,
  RecordPaymentInput,
  paymentPaidAt,
  irelandToday,
  addCalendarDays,
  shiftDublinWeeks,
  MessageSentInput,
  agreedBookingStart,
  missingBookingDetails,
} from "@sorted/core";
import { db, schema } from "../db";
import { emitBookingEvent } from "../lib/events";
import { deactivatePaymentLink } from "../lib/stripe";
import { effectivePaymentVatRate } from "../lib/tax";
import { lockBookingWithClient, userTransaction } from "../lib/transaction";
import type { AppEnv } from "../app";
import { env } from "../lib/env";
import { createPaymentLink } from "./payments";

export const bookingRoutes = new Hono<AppEnv>();

bookingRoutes.post("/:id/message-sent", async (c) => {
  const parsed = MessageSentInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const userId = c.get("userId"), bookingId = c.req.param("id");
  const input = parsed.data;
  return userTransaction(userId, async tx => {
    const row = await lockBookingWithClient(tx, userId, bookingId);
    if (!row) return c.json({ error: "Booking not found" }, 404);
    const [existing] = await tx.select().from(schema.messageLog).where(and(
      eq(schema.messageLog.userId, userId), eq(schema.messageLog.bookingId, bookingId),
      sql`${schema.messageLog.meta}->>'acknowledgementId' = ${input.acknowledgement_id}`,
    ));
    if (existing) return c.json(row.booking);
    if (input.kind === "follow_up" && row.booking.status !== "enquiry") {
      return c.json({ error: "Only enquiries can have a follow-up." }, 409);
    }
    const sentAt = new Date();
    const patch = input.kind === "follow_up"
      ? { followUpOn: addCalendarDays(irelandToday(sentAt), 3) }
      : input.kind === "payment_request" ? { paymentRequestedAt: sentAt } : null;
    const booking = patch ? (await tx.update(schema.bookings).set(patch)
      .where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.userId, userId))).returning())[0] : row.booking;
    await tx.insert(schema.messageLog).values({
      userId, bookingId, clientId: row.client.id, channel: input.channel,
      template: input.kind === "follow_up" ? "reminder" : input.kind,
      status: "sent", sentAt, meta: { userConfirmed: true, kind: input.kind, acknowledgementId: input.acknowledgement_id },
    });
    return c.json(booking);
  });
});

bookingRoutes.post("/:id/payment-link", async (c) => {
  const userId = c.get("userId"), bookingId = c.req.param("id");
  const result = await userTransaction(userId, async tx => {
    const [booking] = await tx.select().from(schema.bookings).where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.userId, userId))).for("update");
    if (!booking) return c.json({ error: "Booking not found" }, 404);
    if (booking.priceCents === null) return c.json({ error: "Add a price first" }, 409);
    if (!env.stripeKey()) return c.json({ error: "Stripe is not configured" }, 503);
    if (booking.status !== "confirmed" && booking.status !== "completed") return c.json({ error: "This booking cannot take payments." }, 409);
    const payments = await tx.select().from(schema.payments).where(and(eq(schema.payments.bookingId, bookingId), eq(schema.payments.userId, userId))).orderBy(schema.payments.id).for("update");
    const owedCents = Math.max(0, booking.priceCents - payments.filter(payment => payment.status === "paid").reduce((sum, payment) => sum + payment.amountCents, 0));
    if (!owedCents) return c.json({ error: "This booking is already paid in full." }, 409);
    const pending = payments.filter(payment => payment.status === "pending");
    if (pending.length === 1 && pending[0].amountCents === owedCents) return { payment: pending[0], voided: [] };
    const voided = await tx.update(schema.payments).set({ status: "cancelled" }).where(and(eq(schema.payments.bookingId, bookingId), eq(schema.payments.userId, userId), eq(schema.payments.status, "pending"))).returning({ linkId: schema.payments.stripePaymentLinkId });
    const [payment] = await tx.insert(schema.payments).values({ userId, bookingId, kind: "custom", amountCents: owedCents }).returning();
    return { payment, voided };
  });
  if (result instanceof Response) return result;
  for (const payment of result.voided) if (payment.linkId) await deactivatePaymentLink(payment.linkId);
  return createPaymentLink(userId, result.payment.id);
});

bookingRoutes.post("/:id/payments", async (c) => {
  const parsed = RecordPaymentInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const userId = c.get("userId");
  const bookingId = c.req.param("id");
  const result = await userTransaction(userId, async (tx) => {
    const [booking] = await tx.select().from(schema.bookings).where(and(
      eq(schema.bookings.id, bookingId), eq(schema.bookings.userId, userId),
    )).for("update");
    if (!booking) return c.json({ error: "Booking not found" }, 404);
    if (booking.priceCents === null) return c.json({ error: "Add a price first" }, 409);
    if (booking.status !== "confirmed" && booking.status !== "completed") {
      return c.json({ error: "Payments can only be recorded for confirmed or completed bookings." }, 409);
    }
    const payments = await tx.select().from(schema.payments).where(and(
      eq(schema.payments.bookingId, bookingId), eq(schema.payments.userId, userId),
    )).orderBy(schema.payments.id).for("update");
    const outstanding = booking.priceCents - payments.filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + payment.amountCents, 0);
    if (parsed.data.amount_cents > outstanding) {
      const owed = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(Math.max(0, outstanding) / 100);
      return c.json({ error: `That's more than the ${owed} still owed.` }, 400);
    }
    const [payment] = await tx.insert(schema.payments).values({
      userId, bookingId, kind: "custom", status: "paid", amountCents: parsed.data.amount_cents,
      method: parsed.data.method, paidAt: paymentPaidAt(parsed.data.paid_on), vatRateBp: effectivePaymentVatRate(userId),
    }).returning();
    const voided = await tx.update(schema.payments).set({ status: "cancelled" }).where(and(
      eq(schema.payments.bookingId, bookingId), eq(schema.payments.userId, userId), eq(schema.payments.status, "pending"),
    )).returning({ linkId: schema.payments.stripePaymentLinkId, createdAt: schema.payments.createdAt });
    const remainder = outstanding - payment.amountCents;
    if (booking.status === "completed" && remainder > 0) {
      const createdAt = voided.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.createdAt ?? booking.completedAt ?? undefined;
      await tx.insert(schema.payments).values({ userId, bookingId, kind: "balance", amountCents: remainder, createdAt });
    }
    return { payment, booking, voided };
  });
  if (result instanceof Response) return result;
  for (const { linkId } of result.voided) if (linkId) await deactivatePaymentLink(linkId);
  await emitBookingEvent(userId, bookingId, "payment.paid", {
    id: result.payment.id, kind: result.payment.kind, amountCents: result.payment.amountCents, linkUrl: result.payment.linkUrl,
  });
  return c.json({ payment: result.payment, booking: result.booking }, 201);
});

bookingRoutes.post("/:id/documents", async (c) => {
  const parsed = CreateDocumentInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const userId = c.get("userId");
  const bookingId = c.req.param("id");
  const { kind, payment_id: paymentId } = parsed.data;
  return userTransaction(userId, async (tx, taxSettings) => {
    const row = await lockBookingWithClient(tx, userId, bookingId);
    if (!row) return c.json({ error: "Booking not found" }, 404);
    const { booking, client } = row;
    if (booking.priceCents === null) return c.json({ error: "Add a price first" }, 409);
    if (kind === "quote" && booking.status !== "enquiry") return c.json({ error: "Quotes are only available for enquiries." }, 409);
    const paidPayments = await tx.select().from(schema.payments).where(and(
      eq(schema.payments.bookingId, bookingId), eq(schema.payments.userId, userId),
    )).orderBy(schema.payments.id).for("update");
    const [existing] = await tx.select().from(schema.invoices).where(and(
      eq(schema.invoices.userId, userId), eq(schema.invoices.bookingId, bookingId), eq(schema.invoices.kind, kind),
      ...(kind === "receipt" ? [eq(schema.invoices.paymentId, paymentId!)] : []),
    ));
    if (existing) return c.json(existing);
    if (kind === "receipt") {
      const payment = paidPayments.find((payment) => payment.id === paymentId);
      if (!payment) return c.json({ error: "Payment not found" }, 404);
      if (payment.status !== "paid") return c.json({ error: "Choose a paid payment for this receipt." }, 400);
    }
    const [sequence] = await tx.select({ next: sql<number>`coalesce(max(${schema.invoices.number}), 0) + 1` })
      .from(schema.invoices).where(and(eq(schema.invoices.userId, userId), eq(schema.invoices.kind, kind)));
    const issuedAt = new Date();
    const receiptSnapshot = kind === "receipt" ? snapshotReceipt(
      { ...booking, startAt: booking.startAt?.toISOString() ?? null },
      paidPayments.map((payment) => ({ ...payment, paidAt: payment.paidAt?.toISOString() ?? null, createdAt: payment.createdAt.toISOString() })),
      paymentId!, issuedAt.toISOString(), taxSettings,
    ) : null;
    const [document] = await tx.insert(schema.invoices).values({
      userId, bookingId, kind, number: Number(sequence.next), issuedAt,
      vatRateBp: kind !== "receipt" ? taxSettings.vatRegistered ? taxSettings.vatRateBp : 0 : null,
      paymentId: kind === "receipt" ? paymentId : null, receiptSnapshot,
    }).returning();
    const documentSnapshot = snapshotDocument(
      { ...taxSettings, createdAt: taxSettings.createdAt.toISOString(), emailVerifiedAt: taxSettings.emailVerifiedAt?.toISOString() ?? null, driveBackedUpAt: taxSettings.driveBackedUpAt?.toISOString() ?? null },
      { ...booking, startAt: booking.startAt?.toISOString() ?? null, endAt: booking.endAt?.toISOString() ?? null, completedAt: booking.completedAt?.toISOString() ?? null, paymentRequestedAt: booking.paymentRequestedAt?.toISOString() ?? null, createdAt: booking.createdAt.toISOString() },
      { ...client, createdAt: client.createdAt.toISOString() },
      paidPayments.map((payment) => ({ ...payment, paidAt: payment.paidAt?.toISOString() ?? null, createdAt: payment.createdAt.toISOString() })),
      { ...document, issuedAt: document.issuedAt.toISOString(), voidedAt: document.voidedAt?.toISOString() ?? null },
    );
    const [frozen] = await tx.update(schema.invoices).set({ documentSnapshot }).where(and(eq(schema.invoices.id, document.id), eq(schema.invoices.userId, userId))).returning();
    return c.json(frozen);
  }, true);
});

/** GET /api/bookings?from=&to=&status= */
bookingRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const { from, to, status } = c.req.query();

  const conditions = [eq(schema.bookings.userId, userId)];
  for (const [value, op] of [[from, gte], [to, lte]] as const) {
    if (!value) continue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return c.json({ error: "Invalid date" }, 400);
    conditions.push(op(schema.bookings.startAt, date));
  }
  if (status) {
    const parsedStatus = BookingStatus.safeParse(status);
    if (!parsedStatus.success) return c.json({ error: "Invalid status" }, 400);
    conditions.push(eq(schema.bookings.status, parsedStatus.data));
  }

  const rows = await db
    .select({
      booking: schema.bookings,
      client: schema.clients,
    })
    .from(schema.bookings)
    .innerJoin(schema.clients, eq(schema.bookings.clientId, schema.clients.id))
    .where(and(...conditions))
    .orderBy(desc(schema.bookings.startAt));

  return c.json(rows);
});

/** POST /api/bookings — supports inline client creation (the 10-second flow) */
bookingRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const parsed = CreateBookingInput.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const input = parsed.data;
  input.start_at = agreedBookingStart(input.start_at, input.time_tbc);

  const rows = await userTransaction(userId, async (tx) => {
    // Resolve or create the client
    let clientId = input.client_id;
    if (input.client) {
      const [client] = await tx
        .insert(schema.clients)
        .values({ userId, ...input.client })
        .returning();
      clientId = client.id;
    } else {
      // Verify the referenced client belongs to this user
      const [client] = await tx
        .select()
        .from(schema.clients)
        .where(
          and(
            eq(schema.clients.id, clientId!),
            eq(schema.clients.userId, userId),
          ),
        ).for("share");
      if (!client) return null;
    }

    const count = input.repeat?.count ?? 1;
    const rows = await tx
      .insert(schema.bookings)
      .values(Array.from({ length: count }, (_, index) => {
        const startAt = input.start_at ? shiftDublinWeeks(input.start_at, index * (input.repeat?.every_weeks ?? 1)) : null;
        return {
        userId,
        clientId: clientId!,
        status: input.status,
        service: input.service,
        startAt,
        timeTbc: Boolean(startAt && input.time_tbc),
        endAt: input.end_at && startAt && input.start_at ? new Date(startAt.getTime() + input.end_at.getTime() - input.start_at.getTime()) : undefined,
        priceCents: input.price_cents,
        depositCents: input.deposit_cents,
        location: input.location,
        notes: input.notes,
        followUpOn: input.status === "enquiry" && index === 0 ? input.follow_up_on === undefined ? addCalendarDays(irelandToday(), 2) : input.follow_up_on : null,
        };
      }))
      .returning();

    if (input.status === "confirmed" && input.deposit_cents > 0) {
      await tx.insert(schema.payments).values(rows.map(booking => ({
        userId, bookingId: booking.id, kind: "deposit" as const, amountCents: booking.depositCents,
      })));
    }
    return rows;
  });
  if (!rows) return c.json({ error: "Client not found" }, 404);
  if (input.status === "confirmed") {
    await Promise.all(rows.map(booking => emitBookingEvent(userId, booking.id, "booking.confirmed")));
  }
  return c.json({ ...rows[0], seriesCount: rows.length }, 201);
});

/** POST /api/bookings/:id/confirm — enquiry → confirmed, emits automation */
bookingRoutes.post("/:id/confirm", async (c) => {
  let body: unknown;
  try { const text = await c.req.text(); body = text ? JSON.parse(text) : {}; }
  catch { return c.json({ error: "Invalid confirmation details" }, 400); }
  const parsed = UpdateBookingInput.pick({ start_at: true, time_tbc: true, price_cents: true }).safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const userId = c.get("userId");
  const id = c.req.param("id");

  const result = await userTransaction(userId, async (tx) => {
    const row = await lockBookingWithClient(tx, userId, id);

    if (!row) return c.json({ error: "Booking not found" }, 404);
    const input = parsed.data;
    const timeTbc = input.time_tbc ?? row.booking.timeTbc;
    const startAt = agreedBookingStart(input.start_at === undefined ? row.booking.startAt : input.start_at, timeTbc);
    const priceCents = input.price_cents === undefined ? row.booking.priceCents : input.price_cents;
    const missing = missingBookingDetails({ startAt, timeTbc, priceCents });
    if (missing.length) return c.json({ error: `Add ${missing.join(", ")} before confirming this booking.` }, 422);
    if (row.booking.depositCents > priceCents!) return c.json({ error: "Deposit cannot exceed price" }, 400);
    if (row.booking.status !== "enquiry") {
      return c.json(
        { error: `Cannot confirm a booking in status '${row.booking.status}'` },
        409,
      );
    }

    const [booking] = await tx
      .update(schema.bookings)
      .set({ status: "confirmed", followUpOn: null, startAt, timeTbc: false, priceCents })
      .where(and(eq(schema.bookings.id, id), eq(schema.bookings.userId, userId)))
      .returning();

    // Deposit expected? Create the pending payment row now.
    if (booking.depositCents > 0) {
      await tx.insert(schema.payments).values({
        userId,
        bookingId: booking.id,
        kind: "deposit",
        amountCents: booking.depositCents,
      });
    }

    return { booking };
  });
  if (result instanceof Response) return result;
  const { booking } = result;
  await emitBookingEvent(userId, booking.id, "booking.confirmed");

  return c.json(booking);
});

/** GET /api/bookings/:id — booking + client + payments + message log */
bookingRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const [row] = await db
    .select({ booking: schema.bookings, client: schema.clients })
    .from(schema.bookings)
    .innerJoin(schema.clients, eq(schema.bookings.clientId, schema.clients.id))
    .where(
      and(eq(schema.bookings.id, id), eq(schema.bookings.userId, userId)),
    );
  if (!row) return c.json({ error: "Booking not found" }, 404);
  const [payments, messages] = await Promise.all([
    db
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.bookingId, id),
          eq(schema.payments.userId, userId),
        ),
      )
      .orderBy(desc(schema.payments.createdAt)),
    db
      .select()
      .from(schema.messageLog)
      .where(
        and(
          eq(schema.messageLog.bookingId, id),
          eq(schema.messageLog.userId, userId),
        ),
      )
      .orderBy(desc(schema.messageLog.sentAt)),
  ]);
  return c.json({ ...row, payments, messages });
});

/** PATCH /api/bookings/:id */
bookingRoutes.patch("/:id", async (c) => {
  const parsed = UpdateBookingInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const input = parsed.data;
  const userId = c.get("userId");
  const result = await userTransaction(userId, async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.bookings)
      .where(
        and(
          eq(schema.bookings.id, c.req.param("id")),
          eq(schema.bookings.userId, c.get("userId")),
        ),
      ).for("update");
    if (!current) return c.json({ error: "Booking not found" }, 404);
    if (input.follow_up_on != null && current.status !== "enquiry") {
      return c.json({ error: "Only enquiries can have a follow-up date" }, 409);
    }
    if (current.status === "completed" || current.status === "cancelled") {
      return c.json(
        { error: `A ${current.status} booking can't be edited` },
        409,
      );
    }
    // The deposit request goes out on confirm; changing it afterwards would
    // leave the payment row and what the client was told out of step.
    if (
      current.status !== "enquiry" &&
      input.deposit_cents !== undefined &&
      input.deposit_cents !== current.depositCents
    ) {
      return c.json(
        { error: "The deposit can't be changed once a booking is confirmed" },
        409,
      );
    }
    const priceCents = input.price_cents === undefined ? current.priceCents : input.price_cents;
    const timeTbc = input.time_tbc ?? current.timeTbc;
    const startAt = agreedBookingStart(input.start_at === undefined ? current.startAt : input.start_at, timeTbc);
    const missing = missingBookingDetails({ startAt, timeTbc, priceCents });
    if ((current.status === "confirmed" || current.status === "completed") && missing.length) return c.json({ error: `Add ${missing.join(", ")} before saving this booking.` }, 422);
    const depositCents = input.deposit_cents ?? current.depositCents;
    const payments = priceCents !== current.priceCents
      ? await tx.select().from(schema.payments).where(and(eq(schema.payments.bookingId, current.id), eq(schema.payments.userId, userId))).orderBy(schema.payments.id).for("update")
      : null;
    const paidCents = payments?.filter(payment => payment.status === "paid").reduce((sum, payment) => sum + payment.amountCents, 0) ?? 0;
    if (payments && (priceCents === null ? paidCents > 0 : priceCents < paidCents)) {
      return c.json({ error: "The price can't be less than the amount already paid." }, 409);
    }
    if (depositCents > (priceCents ?? 0)) {
      return c.json({ error: "Deposit cannot exceed price" }, 400);
    }
    const pending = payments?.filter(payment => payment.status === "pending");
    const voided = pending && !(pending.length === 1 && priceCents !== null && pending[0].amountCents === priceCents - paidCents)
      ? await tx.update(schema.payments).set({ status: "cancelled" }).where(and(eq(schema.payments.bookingId, current.id), eq(schema.payments.userId, userId), eq(schema.payments.status, "pending"))).returning({ linkId: schema.payments.stripePaymentLinkId })
      : [];
    const [booking] = await tx
      .update(schema.bookings)
      .set({
        service: input.service,
        startAt,
        timeTbc: Boolean(startAt && timeTbc),
        endAt: input.end_at,
        priceCents: input.price_cents,
        depositCents: input.deposit_cents,
        location: input.location,
        notes: input.notes,
        followUpOn: input.follow_up_on,
      })
      .where(and(eq(schema.bookings.id, current.id), eq(schema.bookings.userId, c.get("userId"))))
      .returning();
    return { booking, voided };
  });
  if (result instanceof Response) return result;
  for (const payment of result.voided) if (payment.linkId) await deactivatePaymentLink(payment.linkId);
  return c.json(result.booking);
});

/** POST /api/bookings/:id/complete — confirmed → completed */
bookingRoutes.post("/:id/complete", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const result = await userTransaction(userId, async (tx) => {
    const [booking] = await tx
      .select()
      .from(schema.bookings)
      .where(
        and(eq(schema.bookings.id, id), eq(schema.bookings.userId, userId)),
      )
      .for("update");
    if (!booking) return c.json({ error: "Booking not found" }, 404);
    if (booking.status !== "confirmed") {
      return c.json(
        { error: `Cannot complete a booking in status '${booking.status}'` },
        409,
      );
    }

    const [expected] = await tx
      .select({
        amount: sql<number>`coalesce(sum(${schema.payments.amountCents}), 0)`,
      })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.bookingId, id),
          eq(schema.payments.userId, userId),
          eq(schema.payments.status, "paid"),
        ),
      );
    const paidCents = Number(expected?.amount ?? 0);
    const missing = missingBookingDetails(booking);
    if (missing.length) return c.json({ error: `Add ${missing.join(", ")} before completing this booking.` }, 422);
    const remainder = Math.max(booking.priceCents! - paidCents, 0);
    const voided = await tx
      .update(schema.payments)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(schema.payments.bookingId, id),
          eq(schema.payments.userId, userId),
          eq(schema.payments.status, "pending"),
        ),
      )
      .returning({ linkId: schema.payments.stripePaymentLinkId });
    let payment: typeof schema.payments.$inferSelect | undefined;
    if (remainder > 0) {
      [payment] = await tx
        .insert(schema.payments)
        .values({
          userId,
          bookingId: id,
          kind: paidCents > 0 ? "balance" : "full",
          amountCents: remainder,
        })
        .returning();
    }
    const [completed] = await tx
      .update(schema.bookings)
      .set({ status: "completed", completedAt: new Date() })
      .where(and(eq(schema.bookings.id, id), eq(schema.bookings.userId, userId)))
      .returning();
    return { completed, payment, voided };
  });
  if (result instanceof Response) return result;
  const { completed, payment, voided } = result;
  for (const { linkId } of voided) {
    if (linkId) await deactivatePaymentLink(linkId);
  }
  await emitBookingEvent(
    userId,
    id,
    "booking.completed",
    payment
      ? {
          id: payment.id,
          kind: payment.kind,
          amountCents: payment.amountCents,
          linkUrl: payment.linkUrl,
        }
      : undefined,
  );
  return c.json({ booking: completed, payment: payment ?? null });
});

/** POST /api/bookings/:id/cancel */
bookingRoutes.post("/:id/cancel", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const result = await userTransaction(userId, async (tx) => {
    const [booking] = await tx
      .select()
      .from(schema.bookings)
      .where(
        and(eq(schema.bookings.id, id), eq(schema.bookings.userId, userId)),
      )
      .for("update");
    if (!booking) return c.json({ error: "Booking not found" }, 404);
    if (booking.status === "completed" || booking.status === "cancelled") {
      return c.json(
        { error: `Cannot cancel a booking in status '${booking.status}'` },
        409,
      );
    }
    const voided = await tx
      .update(schema.payments)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(schema.payments.bookingId, id),
          eq(schema.payments.userId, userId),
          eq(schema.payments.status, "pending"),
        ),
      )
      .returning({ linkId: schema.payments.stripePaymentLinkId });
    const [cancelled] = await tx
      .update(schema.bookings)
      .set({ status: "cancelled", followUpOn: null })
      .where(and(eq(schema.bookings.id, id), eq(schema.bookings.userId, userId)))
      .returning();
    return { cancelled, voided };
  });
  if (result instanceof Response) return result;
  const { cancelled, voided } = result;
  for (const { linkId } of voided) {
    if (linkId) await deactivatePaymentLink(linkId);
  }
  await emitBookingEvent(userId, id, "booking.cancelled");
  return c.json(cancelled);
});

bookingRoutes.post("/:id/payment-requested", async (c) => {
  const userId = c.get("userId"), id = c.req.param("id");
  return userTransaction(userId, async tx => {
    const [booking] = await tx.select().from(schema.bookings).where(and(eq(schema.bookings.id, id), eq(schema.bookings.userId, userId))).for("update");
    if (!booking) return c.json({ error: "Booking not found" }, 404);
    if (booking.priceCents === null) return c.json({ error: "Add a price first" }, 409);
    const [saved] = await tx.update(schema.bookings).set({ paymentRequestedAt: new Date() }).where(and(eq(schema.bookings.id, id), eq(schema.bookings.userId, userId))).returning();
    return c.json(saved);
  });
});
