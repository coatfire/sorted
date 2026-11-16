import { z } from "zod";

/**
 * Domain events the API POSTs to n8n (single webhook, routed by `event`).
 * n8n owns all side-effects: WhatsApp, Google Calendar, review scheduling.
 * Keep payloads self-contained — n8n should never need to call back just to
 * render a message.
 */

export const DomainEventName = z.enum([
  "booking.confirmed",
  "booking.completed",
  "booking.cancelled",
  "payment.link_created",
  "payment.paid",
  "payment.corrected",
  "payment.undone",
]);
export type DomainEventName = z.infer<typeof DomainEventName>;

export interface EventUser {
  id: string;
  business_name: string;
  phone: string | null;
  review_link: string | null;
}

export interface EventClient {
  id: string;
  name: string;
  phone: string | null; // if null, n8n skips WhatsApp steps
}

export interface EventBooking {
  id: string;
  service: string;
  start_at: string | null;
  price_cents: number | null;
  deposit_cents: number;
  location: string | null;
  gcal_event_id: string | null;
}

export interface EventPayment {
  id: string;
  kind: string;
  amount_cents: number;
  link_url: string | null;
}

export interface DomainEvent {
  event: DomainEventName;
  sent_at: string; // ISO
  user: EventUser;
  client: EventClient;
  booking: EventBooking;
  payment?: EventPayment; // present on payment.* events
}
