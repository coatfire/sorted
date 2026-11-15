import { z } from "zod";
import type { Expense, Payment, User } from "./types";

export const VatRateBp = z.number().int().min(0).max(3000);
export const IncomeTaxRateBp = z.number().int().min(0).max(10000);
export const VatPeriodMonths = z.union([z.literal(2), z.literal(4), z.literal(6), z.literal(12)]);
export const TaxSettings = z.object({
  vatRegistered: z.boolean().default(false),
  vatRateBp: VatRateBp.nullable().default(null),
  vatPeriodMonths: VatPeriodMonths.default(2),
  incomeTaxRateBp: IncomeTaxRateBp.nullable().default(null),
}).refine((settings) => !settings.vatRegistered || settings.vatRateBp !== null, {
  message: "Enter your VAT rate.", path: ["vatRateBp"],
});

export function percentToBasisPoints(value: string, maximum = 10000): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return bp <= maximum ? bp : null;
}

export const inclusiveVat = (amountCents: number, rateBp: number) => Math.round(amountCents * rateBp / (10000 + rateBp));

function irelandDate(value: string | Date): string | null {
  const date = new Date(value instanceof Date ? value.getTime() : value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function taxEstimate({ payments, expenses, settings, now }: {
  payments: readonly Payment[];
  expenses: readonly Expense[];
  settings: Pick<User, "vatRegistered" | "vatRateBp" | "vatPeriodMonths" | "incomeTaxRateBp">;
  now: Date | string;
}) {
  const config = TaxSettings.parse(settings);
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const today = irelandDate(now);
  if (!today) throw new Error("Enter a valid date for the tax estimate.");
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const firstMonth = Math.floor(month / config.vatPeriodMonths) * config.vatPeriodMonths;
  const lastMonth = firstMonth + config.vatPeriodMonths;
  const start = `${year}-${String(firstMonth + 1).padStart(2, "0")}-01`;
  const end = lastMonth === 12 ? `${year + 1}-01-01` : `${year}-${String(lastMonth + 1).padStart(2, "0")}-01`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const rate = config.vatRegistered ? config.vatRateBp! : 0;
  const periodVatRates = new Set<number>();
  let periodIncomeCents = 0, salesVatCents = 0, purchaseVatCents = 0;
  let yearIncomeCents = 0, yearSalesVatCents = 0, yearExpenseCents = 0, yearPurchaseVatCents = 0;
  for (const payment of payments) {
    if (payment.status !== "paid" || !payment.paidAt) continue;
    const date = irelandDate(payment.paidAt);
    if (!date) continue;
    const paymentRate = payment.vatRateBp ?? rate;
    const vat = inclusiveVat(payment.amountCents, paymentRate);
    if (date >= start && date < end) {
      periodVatRates.add(paymentRate);
      periodIncomeCents += payment.amountCents;
      salesVatCents += vat;
    }
    if (date >= `${year}-01-01` && new Date(payment.paidAt).getTime() <= nowTime) {
      yearIncomeCents += payment.amountCents;
      yearSalesVatCents += vat;
    }
  }
  for (const expense of expenses) {
    if (expense.status !== "confirmed" || !expense.expenseDate || expense.amountCents === null) continue;
    const date = irelandDate(expense.expenseDate);
    if (!date) continue;
    const vat = config.vatRegistered ? expense.vatCents ?? 0 : 0;
    if (date >= start && date < end) purchaseVatCents += vat;
    if (date >= `${year}-01-01` && date <= today) {
      yearExpenseCents += expense.amountCents;
      yearPurchaseVatCents += vat;
    }
  }
  const netIncomeCents = yearIncomeCents - yearSalesVatCents;
  const netExpenseCents = yearExpenseCents - yearPurchaseVatCents;
  const profitCents = netIncomeCents - netExpenseCents;
  return {
    periodLabel: `${months[firstMonth]}–${months[lastMonth - 1]} ${year}`, periodStart: start, periodEnd: end,
    year, ...config, periodIncomeCents, salesVatCents, purchaseVatCents, vatDueCents: salesVatCents - purchaseVatCents,
    salesVatRateBp: periodVatRates.size === 1 ? [...periodVatRates][0] : null,
    yearIncomeCents, yearSalesVatCents, yearExpenseCents, yearPurchaseVatCents, netIncomeCents, netExpenseCents, profitCents,
    incomeTaxCents: config.incomeTaxRateBp === null ? null : Math.round(Math.max(0, profitCents) * config.incomeTaxRateBp / 10000),
  };
}
