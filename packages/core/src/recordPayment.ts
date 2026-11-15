import { z } from "zod";
import { PaymentMethod } from "./types";

export function irelandToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
}

const PaidOn = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.").refine((date) => {
  const value = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
}, "Enter a valid date.");

export const RecordPaymentInput = z.object({
  amount_cents: z.number().int().positive(),
  method: PaymentMethod.exclude(["stripe"]),
  paid_on: PaidOn.refine((date) => date <= irelandToday(), "Payment date cannot be in the future.").optional(),
});
export type RecordPaymentInput = z.infer<typeof RecordPaymentInput>;

export function paymentPaidAt(paidOn: string | undefined, now = new Date()): Date {
  const date = PaidOn.parse(paidOn ?? irelandToday(now));
  const today = irelandToday(now);
  if (date > today) throw new Error("Payment date cannot be in the future.");
  if (date === today) return now;
  const noon = new Date(`${date}T12:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "numeric", hourCycle: "h23" }).format(noon));
  return new Date(noon.getTime() - (hour - 12) * 3600000);
}
