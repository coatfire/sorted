import type { Booking, BookingStage, Payment } from "@sorted/core";
import { euros } from "./format";

export type BookingDetailAction = "confirm" | "complete" | "quote" | "invoice" | "receipt" | "calendar" | "confirmation" | "again" | "edit" | "cancel" | "payment" | "ask" | "followUp";

export function nextBookingDate(startAt: string) {
  return new Intl.DateTimeFormat("en-IE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Dublin" }).format(new Date(startAt));
}

export function pendingDepositCents(booking: Pick<Booking, "id">, payments: readonly Pick<Payment, "bookingId" | "status" | "kind" | "amountCents">[], owedCents: number) {
  return Math.min(owedCents, payments.filter(payment => payment.bookingId === booking.id && payment.status === "pending" && payment.kind === "deposit")
    .reduce((sum, payment) => sum + payment.amountCents, 0));
}

export function bookingPaymentPhrase(stage: BookingStage, owedCents: number, depositCents: number) {
  if ((stage === "upcoming" || stage === "due") && depositCents > 0) return `${euros(depositCents)} deposit due`;
  if (stage === "owing") return `${euros(owedCents)} to pay`;
  return stage === "paid" ? "Paid in full" : null;
}
