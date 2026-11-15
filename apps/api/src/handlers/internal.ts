import { Hono } from "hono";
import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { MessageTemplate } from "@sorted/core";
import { z } from "zod";
import { db, schema } from "../db";
import { publicUser } from "../lib/user";

/**
 * Routes n8n calls back into. All guarded by X-Internal-Secret (see app.ts).
 * These are NOT user-scoped by JWT — n8n passes explicit ids from the event
 * payloads it received.
 */
export const internalRoutes = new Hono();

/** POST /api/internal/messages — n8n logs every WhatsApp send */
internalRoutes.post("/messages", async (c) => {
  const body = await c.req.json<{
    user_id?: string;
    booking_id?: string;
    client_id?: string;
    template?: string;
    status?: "sent" | "delivered" | "failed";
    meta?: unknown;
  }>();
  const template = MessageTemplate.safeParse(body.template);
  if (!body.user_id || !template.success) {
    return c.json({ error: "user_id and valid template are required" }, 400);
  }
  if (
    body.status &&
    body.status !== "sent" &&
    body.status !== "delivered" &&
    body.status !== "failed"
  ) {
    return c.json({ error: "Invalid status" }, 400);
  }
  const [message] = await db
    .insert(schema.messageLog)
    .values({
      userId: body.user_id,
      bookingId: body.booking_id,
      clientId: body.client_id,
      template: template.data,
      status: body.status ?? "sent",
      meta: body.meta,
    })
    .returning();
  return c.json(message, 201);
});

/**
 * GET /api/internal/reminders?window_hours=24
 * Bookings WHERE status='confirmed'
 *   AND start_at BETWEEN now() AND now()+window
 *   AND reminder_sent_at IS NULL
 * Join user + client (need phones + business name). n8n cron polls this
 * every 15 min, sends reminders, then PATCHes reminder_sent_at below.
 */
internalRoutes.get("/reminders", async (c) => {
  const hours = Number(c.req.query("window_hours") ?? 24);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) {
    return c.json({ error: "window_hours must be between 0 and 168" }, 400);
  }
  const now = new Date();
  const until = new Date(now.getTime() + hours * 60 * 60 * 1000);
  const rows = await db
    .select({
      booking: schema.bookings,
      client: schema.clients,
      user: schema.users,
    })
    .from(schema.bookings)
    .innerJoin(schema.clients, eq(schema.bookings.clientId, schema.clients.id))
    .innerJoin(schema.users, eq(schema.bookings.userId, schema.users.id))
    .where(
      and(
        eq(schema.bookings.status, "confirmed"),
        gt(schema.bookings.startAt, now),
        lte(schema.bookings.startAt, until),
        isNull(schema.bookings.reminderSentAt),
      ),
    );
  return c.json(rows.map((row) => ({ ...row, user: publicUser(row.user) })));
});

/** PATCH /api/internal/bookings/:id — n8n writes back state */
internalRoutes.patch("/bookings/:id", async (c) => {
  const parsed = z
    .object({
      gcal_event_id: z.string().nullable().optional(),
      reminder_sent_at: z.coerce.date().optional(),
      review_requested_at: z.coerce.date().optional(),
    })
    .refine((value) => Object.values(value).some((field) => field !== undefined))
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const body = parsed.data;
  const [booking] = await db
    .update(schema.bookings)
    .set({
      gcalEventId: body.gcal_event_id,
      reminderSentAt: body.reminder_sent_at,
      reviewRequestedAt: body.review_requested_at,
    })
    .where(eq(schema.bookings.id, c.req.param("id")))
    .returning();
  if (!booking) return c.json({ error: "Booking not found" }, 404);
  return c.json(booking);
});

/**
 * GET /api/internal/reviews
 * Bookings WHERE status='completed'
 *   AND created "completed" ~2 days ago  ← simplest: add completed_at column
 *     in M2 when you implement /complete, or derive from updated timestamps
 *   AND review_requested_at IS NULL
 *   AND user has review_link set AND client has phone
 */
internalRoutes.get("/reviews", async (c) => {
  const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      booking: schema.bookings,
      client: schema.clients,
      user: schema.users,
    })
    .from(schema.bookings)
    .innerJoin(schema.clients, eq(schema.bookings.clientId, schema.clients.id))
    .innerJoin(schema.users, eq(schema.bookings.userId, schema.users.id))
    .where(
      and(
        eq(schema.bookings.status, "completed"),
        lte(schema.bookings.completedAt, cutoff),
        isNull(schema.bookings.reviewRequestedAt),
      ),
    );
  return c.json(
    rows.filter((row) => Boolean(row.user.reviewLink && row.client.phone))
      .map((row) => ({ ...row, user: publicUser(row.user) })),
  );
});
