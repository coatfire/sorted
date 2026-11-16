import { bookingStage } from "./bookingStage";
import { dublinDateTime } from "./dates";
import { inclusiveVat, taxEstimate } from "./tax";
import type { Booking, Expense, Payment, User } from "./types";

export interface OwedItem<T> { booking: T; owedCents: number; kind: "Deposit" | "Balance" | "Full payment" }

export function moneyOwed<T extends Pick<Booking, "id" | "status" | "startAt" | "priceCents" | "depositCents">>(
  bookings: readonly T[], payments: readonly Pick<Payment, "bookingId" | "status" | "amountCents">[], now = new Date(),
) {
  const dueNow: OwedItem<T>[] = [], comingUp: OwedItem<T>[] = [];
  for (const booking of [...bookings].sort((a, b) => (a.startAt ? Date.parse(a.startAt) : Infinity) - (b.startAt ? Date.parse(b.startAt) : Infinity))) {
    if (booking.priceCents === null || booking.status === "enquiry") continue;
    const { stage, owedCents } = bookingStage(booking, payments, now);
    if (owedCents === 0 || !["due", "owing", "upcoming"].includes(stage)) continue;
    const paid = booking.priceCents - owedCents;
    const unpaidDeposit = Math.max(0, booking.depositCents - paid);
    const upcoming = stage === "upcoming" && dublinDateTime(booking.startAt).date > dublinDateTime(now).date;
    const kind = upcoming && owedCents === unpaidDeposit ? "Deposit" : paid === 0 ? "Full payment" : "Balance";
    (upcoming ? comingUp : dueNow).push({ booking, owedCents, kind });
  }
  return { dueNow, comingUp, dueNowCents: dueNow.reduce((sum, item) => sum + item.owedCents, 0), comingUpCents: comingUp.reduce((sum, item) => sum + item.owedCents, 0) };
}

export function moneyYear(payments: readonly Payment[], expenses: readonly Expense[], settings: Pick<User, "vatRegistered" | "vatRateBp" | "vatPeriodMonths" | "incomeTaxRateBp">, now = new Date()) {
  const estimate = taxEstimate({ payments, expenses, settings, now });
  const monthlyIncomeCents = Array<number>(12).fill(0);
  for (const payment of payments) {
    if (payment.status !== "paid" || !payment.paidAt || !Number.isFinite(Date.parse(payment.paidAt)) || Date.parse(payment.paidAt) > now.getTime()) continue;
    const { date } = dublinDateTime(payment.paidAt);
    if (Number(date.slice(0, 4)) !== estimate.year) continue;
    const rate = payment.vatRateBp ?? (estimate.vatRegistered ? estimate.vatRateBp! : 0);
    monthlyIncomeCents[Number(date.slice(5, 7)) - 1] += payment.amountCents - inclusiveVat(payment.amountCents, rate);
  }
  return { estimate, monthlyIncomeCents };
}
