import type { Payment } from "./types";

export const MESSAGE_PLACEHOLDERS = [
  "client", "business", "date", "time", "service", "price", "deposit", "balance", "iban", "bic", "pay_link",
] as const;

export const DEFAULT_BOOKING_CONFIRMATION_TEMPLATE = `Hi {client}, you're booked in with {business} for {service} on {date} at {time}.
Price: {price} · Deposit: {deposit} · Balance: {balance}
IBAN: {iban}
BIC: {bic}
See you then!`;

export const DEFAULT_PAYMENT_REQUEST_TEMPLATE = `Hi {client}, a friendly reminder that {balance} is due for your {service} on {date}.
IBAN: {iban}
BIC: {bic}
{pay_link}
Thanks, {business}`;

export interface BookingMessageDetails {
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
  };
  return template.split(/\r?\n/).filter((line) => {
    const tokens = line.match(/\{[a-z_]+\}/g) ?? [];
    const emptyBankLine = tokens.length > 0 && tokens.every((token) =>
      (token === "{iban}" || token === "{bic}") && !values[token.slice(1, -1)],
    );
    return !emptyBankLine;
  }).map((line) => line.replace(/\{([a-z_]+)\}/g, (token: string, key: string) => Object.hasOwn(values, key) ? values[key] : token))
    .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
