import { bookingAtDublinTime, dublinDateTime } from "./dates";

export function missingBookingDetails(booking: { startAt: string | Date | null; timeTbc?: boolean; priceCents: number | null }) {
  return [...(!booking.startAt ? ["date", "time"] : booking.timeTbc ? ["time"] : []), ...(booking.priceCents === null ? ["price"] : [])];
}

export function agreedBookingStart(start: Date | null, timeTbc: boolean) {
  return start && timeTbc ? bookingAtDublinTime(dublinDateTime(start).date, "00:00") : start;
}
