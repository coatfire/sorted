import type { Payment } from "./types";

export const MESSAGE_PLACEHOLDERS = [
  "client", "business", "date", "time", "service", "price", "deposit", "balance", "iban", "bic", "pay_link", "revolut_link",
] as const;

export const DEFAULT_BOOKING_CONFIRMATION_TEMPLATE = `Hi {client}, you're booked in with {business} for {service} on {date} at {time}.
Price: {price} · Deposit: {deposit} · Balance: {balance}
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
  date: string;
  time: string;
  service: string;
  priceCents: number;
  depositCents: number;
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
  const values: Record<string, string> = {
    client: details.client,
    business: details.business,
    date: details.date,
    time: details.time,
    service: details.service,
    price: money(details.priceCents),
    deposit: money(details.depositCents),
    balance: money(details.balanceCents),
    iban: details.iban?.trim() ?? "",
    bic: details.bic?.trim() ?? "",
    pay_link: details.payLink ?? "",
    revolut_link: revolut ?? "",
  };
  const rendered = template.split(/\r?\n/).filter((line) => {
    const tokens = line.match(/\{[a-z_]+\}/g) ?? [];
    const emptyBankLine = tokens.length > 0 && tokens.every((token) =>
      (token === "{iban}" || token === "{bic}" || token === "{revolut_link}") && !values[token.slice(1, -1)],
    );
    return !emptyBankLine;
  }).map((line) => line.replace(/\{([a-z_]+)\}/g, (token: string, key: string) => Object.hasOwn(values, key) ? values[key] : token))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const include = details.kind !== "confirmation" || /\{(?:iban|bic)\}/.test(template);
  const linked = revolut && new RegExp(revolut.replace(/^https:\/\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=$|[^A-Za-z0-9._-]|\\.(?:\\s|$))", "i").test(rendered);
  return revolut && include && !linked ? `${rendered}${rendered ? "\n" : ""}Pay by Revolut: ${revolut}` : rendered;
}
