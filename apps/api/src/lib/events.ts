import type { DomainEvent, DomainEventName } from "@sorted/core";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "./env";

/**
 * Fire-and-forget POST to the single n8n webhook. Never throws, never blocks
 * the response path for long — automation failures must not break CRUD.
 *
 * TODO(M3): once n8n is live, consider writing failed emits to a small
 * `event_outbox` table and retrying on a cron for durability.
 */
export async function emitEvent(
  event: Omit<DomainEvent, "sent_at"> & { event: DomainEventName },
): Promise<void> {
  try {
    const url = env.n8nWebhookUrl();
    if (!url) {
      console.log("[events] N8N_WEBHOOK_URL unset, skipping", event.event);
      return;
    }
    const payload: DomainEvent = { ...event, sent_at: new Date().toISOString() };
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    console.error("[events] emit failed", event.event);
  }
}

export async function emitBookingEvent(
  userId: string,
  bookingId: string,
  event: DomainEventName,
  payment?: {
    id: string;
    kind: string;
    amountCents: number;
    linkUrl: string | null;
  },
) {
  try {
    if (!env.n8nWebhookUrl()) return;
    const [row] = await db
      .select({
        user: schema.users,
        client: schema.clients,
        booking: schema.bookings,
      })
      .from(schema.bookings)
      .innerJoin(schema.clients, eq(schema.bookings.clientId, schema.clients.id))
      .innerJoin(schema.users, eq(schema.bookings.userId, schema.users.id))
      .where(
        and(
          eq(schema.bookings.id, bookingId),
          eq(schema.bookings.userId, userId),
        ),
      );

    if (!row) return;

    await emitEvent({
      event,
      user: {
        id: row.user.id,
        business_name: row.user.businessName ?? row.user.name ?? "your vendor",
        phone: row.user.phone,
        review_link: row.user.reviewLink,
      },
      client: {
        id: row.client.id,
        name: row.client.name,
        phone: row.client.phone,
      },
      booking: {
        id: row.booking.id,
        service: row.booking.service,
        start_at: row.booking.startAt.toISOString(),
        price_cents: row.booking.priceCents,
        deposit_cents: row.booking.depositCents,
        location: row.booking.location,
        gcal_event_id: row.booking.gcalEventId,
      },
      payment: payment
        ? {
            id: payment.id,
            kind: payment.kind,
            amount_cents: payment.amountCents,
            link_url: payment.linkUrl,
          }
        : undefined,
    });
  } catch {
    console.error("[events] emit failed", event);
  }
}
