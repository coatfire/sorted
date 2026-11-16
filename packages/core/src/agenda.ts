import { calendarDaysBetween, dublinDateTime } from "./dates";
import type { Booking } from "./types";

export function bookingAgenda<T extends Booking>(bookings: readonly T[], now = new Date()) {
  const today = dublinDateTime(now).date;
  const byStart = bookings.filter(booking => booking.startAt !== null).sort((a, b) => dublinDateTime(a.startAt!).date.localeCompare(dublinDateTime(b.startAt!).date) || Number(Boolean(b.timeTbc)) - Number(Boolean(a.timeTbc)) || Date.parse(a.startAt!) - Date.parse(b.startAt!) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const offset = (booking: T) => calendarDaysBetween(today, dublinDateTime(booking.startAt!).date);
  const open = byStart.filter(booking => booking.status === "enquiry" || booking.status === "confirmed");
  return {
    today,
    undated: bookings.filter(booking => booking.status === "enquiry" && !booking.startAt),
    nextAppointment: byStart.find(booking => booking.status === "confirmed" && (booking.endAt ? Date.parse(booking.endAt) : Date.parse(booking.startAt!) + 3600000) > now.getTime()),
    followUps: bookings.filter(booking => booking.status === "enquiry" && booking.followUpOn && booking.followUpOn <= today).sort((a, b) => a.followUpOn!.localeCompare(b.followUpOn!)),
    wrapUp: open.filter(booking => offset(booking) < 0),
    todays: byStart.filter(booking => offset(booking) === 0 && booking.status !== "cancelled"),
    upcoming: open.filter(booking => offset(booking) > 0 && offset(booking) <= 14),
    later: open.filter(booking => offset(booking) > 14),
    past: byStart.filter(booking => ["completed", "cancelled"].includes(booking.status) && offset(booking) < 0).reverse().slice(0, 20),
  };
}
