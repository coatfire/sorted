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
} from "@sorted/core";
import { db, schema } from "../db";
import { emitBookingEvent, emitEvent } from "../lib/events";
import type { AppEnv } from "../app";

export const bookingRoutes = new Hono<AppEnv>();

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

  // Resolve or create the client
  let clientId = input.client_id;
  if (input.client) {
    const [client] = await db
      .insert(schema.clients)
      .values({ userId, ...input.client })
      .returning();
    clientId = client.id;
  } else {
    // Verify the referenced client belongs to this user
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(
        and(
          eq(schema.clients.id, clientId!),
          eq(schema.clients.userId, userId),
        ),
      );
    if (!client) return c.json({ error: "Client not found" }, 404);
  }

  const [booking] = await db
    .insert(schema.bookings)
    .values({
      userId,
      clientId: clientId!,
      service: input.service,
      startAt: input.start_at,
      endAt: input.end_at,
      priceCents: input.price_cents,
      depositCents: input.deposit_cents,
      location: input.location,
      notes: input.notes,
    })
    .returning();

  return c.json(booking, 201);
});

/** POST /api/bookings/:id/confirm — enquiry → confirmed, emits automation */
bookingRoutes.post("/:id/confirm", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const [row] = await db
    .select({
      booking: schema.bookings,
      client: schema.clients,
    })
    .from(schema.bookings)
    .innerJoin(schema.clients, eq(schema.bookings.clientId, schema.clients.id))
    .where(
      and(eq(schema.bookings.id, id), eq(schema.bookings.userId, userId)),
    );

  if (!row) return c.json({ error: "Booking not found" }, 404);
  if (row.booking.status !== "enquiry") {
    return c.json(
      { error: `Cannot confirm a booking in status '${row.booking.status}'` },
      409,
    );
  }

  const [booking] = await db
    .update(schema.bookings)
    .set({ status: "confirmed" })
    .where(eq(schema.bookings.id, id))
    .returning();

  // Deposit expected? Create the pending payment row now.
  if (booking.depositCents > 0) {
    await db.insert(schema.payments).values({
      userId,
      bookingId: booking.id,
      kind: "deposit",
      amountCents: booking.depositCents,
    });
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId));

  await emitEvent({
    event: "booking.confirmed",
    user: {
      id: user.id,
      business_name: user.businessName ?? user.name ?? "your vendor",
      phone: user.phone,
      review_link: user.reviewLink,
    },
    client: {
      id: row.client.id,
      name: row.client.name,
      phone: row.client.phone,
    },
    booking: {
      id: booking.id,
      service: booking.service,
      start_at: booking.startAt.toISOString(),
      price_cents: booking.priceCents,
      deposit_cents: booking.depositCents,
      location: booking.location,
      gcal_event_id: booking.gcalEventId,
    },
  });

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
  const [current] = await db
    .select()
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.id, c.req.param("id")),
        eq(schema.bookings.userId, c.get("userId")),
      ),
    );
  if (!current) return c.json({ error: "Booking not found" }, 404);
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
  const priceCents = input.price_cents ?? current.priceCents;
  const depositCents = input.deposit_cents ?? current.depositCents;
  if (depositCents > priceCents) {
    return c.json({ error: "Deposit cannot exceed price" }, 400);
  }
  const [booking] = await db
    .update(schema.bookings)
    .set({
      service: input.service,
      startAt: input.start_at,
      endAt: input.end_at,
      priceCents: input.price_cents,
      depositCents: input.deposit_cents,
      location: input.location,
      notes: input.notes,
    })
    .where(eq(schema.bookings.id, current.id))
    .returning();
  return c.json(booking);
});

/** POST /api/bookings/:id/complete — confirmed → completed */
bookingRoutes.post("/:id/complete", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const [booking] = await db
    .select()
    .from(schema.bookings)
    .where(
      and(eq(schema.bookings.id, id), eq(schema.bookings.userId, userId)),
    );
  if (!booking) return c.json({ error: "Booking not found" }, 404);
  if (booking.status !== "confirmed") {
    return c.json(
      { error: `Cannot complete a booking in status '${booking.status}'` },
      409,
    );
  }

  const [expected] = await db
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
  const remainder = Math.max(booking.priceCents - paidCents, 0);
  await db
    .update(schema.payments)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(schema.payments.bookingId, id),
        eq(schema.payments.userId, userId),
        eq(schema.payments.status, "pending"),
      ),
    );
  let payment: typeof schema.payments.$inferSelect | undefined;
  if (remainder > 0) {
    [payment] = await db
      .insert(schema.payments)
      .values({
        userId,
        bookingId: id,
        kind: paidCents > 0 ? "balance" : "full",
        amountCents: remainder,
      })
      .returning();
  }
  const [completed] = await db
    .update(schema.bookings)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(schema.bookings.id, id))
    .returning();
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
  const [booking] = await db
    .select()
    .from(schema.bookings)
    .where(
      and(eq(schema.bookings.id, id), eq(schema.bookings.userId, userId)),
    );
  if (!booking) return c.json({ error: "Booking not found" }, 404);
  if (booking.status === "completed" || booking.status === "cancelled") {
    return c.json(
      { error: `Cannot cancel a booking in status '${booking.status}'` },
      409,
    );
  }
  await db
    .update(schema.payments)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(schema.payments.bookingId, id),
        eq(schema.payments.userId, userId),
        eq(schema.payments.status, "pending"),
      ),
    );
  const [cancelled] = await db
    .update(schema.bookings)
    .set({ status: "cancelled" })
    .where(eq(schema.bookings.id, id))
    .returning();
  await emitBookingEvent(userId, id, "booking.cancelled");
  return c.json(cancelled);
});
