import type { Payment } from "./types";
import { z } from "zod";

export const MessageSentInput = z.object({
  kind: z.enum(["confirmation", "payment_request", "follow_up"]),
  channel: z.enum(["whatsapp", "email"]),
  acknowledgement_id: z.string().uuid(),
});
export type MessageSentInput = z.infer<typeof MessageSentInput>;

export const MESSAGE_PLACEHOLDERS = [
  "client", "business", "date", "time", "service", "price", "deposit", "balance", "iban", "bic", "pay_link", "revolut_link", "deposit_breakdown",
] as const;

export const DEFAULT_BOOKING_CONFIRMATION_TEMPLATE = `Hi {client}, you're booked in with {business} for {service} on {date} at {time}.
Price: {price}
{deposit_breakdown}
IBAN: {iban}
BIC: {bic}
Pay by Revolut: {revolut_link}
See you then!`;

export const DEFAULT_PAYMENT_REQUEST_TEMPLATE = `Hi {client}, a friendly reminder that {balance} is due for your {service} on {date}.
IBAN: {iban}
BIC: {bic}
Pay by Revolut: {revolut_link}
{pay_link}
Thanks, {business}`;

export interface BookingMessageDetails {
  revolutLink?: string | null;
  kind?: "confirmation" | "payment_request";
  client: string;
  business: string;
  date: string | null;
  time: string | null;
  service: string;
  priceCents: number | null;
  depositCents: number;
  paidCents?: number;
  balanceCents: number;
  iban: string | null;
  bic: string | null;
  payLink: string | null;
}

export function bookingMessagePayLink(
  payments: ReadonlyArray<Pick<Payment, "status" | "kind" | "amountCents" | "linkUrl">>,
  kind: "confirmation" | "payment_request",
  balanceCents: number,
): string | null {
  return payments.find((payment) => payment.status === "pending" && payment.linkUrl && (
    kind === "confirmation" ? payment.kind === "deposit" : payment.amountCents === balanceCents
  ))?.linkUrl ?? null;
}

export function renderBookingMessage(template: string, details: BookingMessageDetails): string {
  const revolut = details.kind === "confirmation" && (details.depositCents <= 0 || details.balanceCents <= 0) ? null : details.revolutLink;
  const money = (cents: number) => new Intl.NumberFormat("en-IE", {
    style: "currency", currency: "EUR",
  }).format(cents / 100);
  const received = Math.min(details.depositCents, details.paidCents ?? 0);
  const required = Math.max(0, details.depositCents - received);
  const values: Record<string, string> = {
    client: details.client,
    business: details.business,
    date: details.date || "to be agreed",
    time: details.time || "to be agreed",
    service: details.service,
    price: details.priceCents === null ? "to be agreed" : money(details.priceCents),
    deposit: details.priceCents === null ? "to be agreed" : money(details.depositCents),
    deposit_breakdown: details.priceCents !== null && details.depositCents > 0 ? [
      received > 0 ? `Deposit received: ${money(received)}` : "",
      required > 0 ? `Deposit required: ${money(required)}` : "",
      `Balance: ${money(Math.max(0, details.balanceCents - required))}`,
    ].filter(Boolean).join("\n") : "",
    balance: details.priceCents === null ? "to be agreed" : money(details.balanceCents),
    iban: details.iban?.trim() ?? "",
    bic: details.bic?.trim() ?? "",
    pay_link: details.payLink ?? "",
    revolut_link: revolut ?? "",
  };
  const rendered = template.split(/\r?\n/).filter((line) => {
    if (details.priceCents === null && /^\s*(?:Price|Deposit|Balance):/.test(line)) return false;
    const tokens = line.match(/\{[a-z_]+\}/g) ?? [];
    const emptyLine = tokens.length > 0 && tokens.every((token) =>
      Object.hasOwn(values, token.slice(1, -1)) && !values[token.slice(1, -1)],
    );
    return !emptyLine;
  }).map((line) => line.replace(/\{([a-z_]+)\}/g, (token: string, key: string) => Object.hasOwn(values, key) ? values[key] : token))
    .join("\n").replace(/\bon to be agreed/g, "on a date to be agreed").replace(/\bat to be agreed/g, "at a time to be agreed").replace(/\n{3,}/g, "\n\n").trim();
  const include = details.kind !== "confirmation" || /\{(?:iban|bic)\}/.test(template);
  const linked = revolut && new RegExp(revolut.replace(/^https:\/\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=$|[^A-Za-z0-9._-]|\\.(?:\\s|$))", "i").test(rendered);
  return revolut && include && !linked ? `${rendered}${rendered ? "\n" : ""}Pay by Revolut: ${revolut}` : rendered;
}
