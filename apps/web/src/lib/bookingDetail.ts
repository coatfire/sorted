import type { Booking, BookingStage } from "@sorted/core";
import { euros } from "./format";

export type BookingDetailAction = "confirm" | "complete" | "quote" | "invoice" | "receipt" | "calendar" | "confirmation" | "again" | "edit" | "cancel" | "payment" | "ask" | "followUp";

export function nextBookingDate(startAt: string | null) {
  if (!startAt) return "Date to be agreed";
  return new Intl.DateTimeFormat("en-IE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Dublin" }).format(new Date(startAt));
}

export function unpaidDepositCents(booking: Pick<Booking, "priceCents" | "depositCents">, owedCents: number) {
  return Math.min(owedCents, Math.max(0, booking.depositCents - ((booking.priceCents ?? 0) - owedCents)));
}

export function bookingPaymentPhrase(stage: BookingStage, owedCents: number, depositCents: number) {
  if ((stage === "upcoming" || stage === "due") && depositCents > 0) return `${euros(depositCents)} deposit due`;
  if (stage === "owing") return `${euros(owedCents)} to pay`;
  return stage === "paid" ? "Paid in full" : null;
}
