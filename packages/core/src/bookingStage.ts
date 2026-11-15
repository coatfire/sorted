import { dublinDateTime } from "./dates";
import type { Booking, Payment } from "./types";

export type BookingStage = "enquiry" | "upcoming" | "due" | "owing" | "paid" | "cancelled";

export function bookingStage(
  booking: Pick<Booking, "id" | "status" | "startAt" | "priceCents">,
  payments: readonly Pick<Payment, "bookingId" | "status" | "amountCents">[],
  now = new Date(),
): { stage: BookingStage; owedCents: number } {
  const paid = payments.filter(payment => payment.bookingId === booking.id && payment.status === "paid")
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  const owedCents = Math.max(0, booking.priceCents - paid);
  let stage: BookingStage;
  switch (booking.status) {
    case "enquiry": stage = "enquiry"; break;
    case "cancelled": stage = "cancelled"; break;
    case "completed": stage = owedCents > 0 ? "owing" : "paid"; break;
    case "confirmed": stage = dublinDateTime(booking.startAt).date > dublinDateTime(now).date ? "upcoming" : "due"; break;
  }
  return { stage, owedCents };
}
