import { formatPhone, type Booking, type Client } from "./types";

export type CalendarBooking = Pick<Booking, "id" | "status" | "startAt" | "endAt" | "service" | "location" | "priceCents" | "followUpOn"> & {
  client: Pick<Client, "name" | "phone">;
};

export interface CalendarLinks {
  confirmed: { https: string; webcal: string; google: string };
  enquiries: { https: string; webcal: string; google: string };
}

const utc = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, "");
const escapeText = (text: string) => text.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");

function fold(line: string) {
  const encoder = new TextEncoder();
  let result = "", length = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (length + size > 75) {
      result += "\r\n ";
      length = 1;
    }
    result += character;
    length += size;
  }
  return result;
}

export function calendarEvent(booking: CalendarBooking, appUrl: string) {
  const start = new Date(booking.startAt);
  const end = booking.endAt ? new Date(booking.endAt) : new Date(start.getTime() + 3600000);
  return {
    uid: `${booking.id}@sorted`,
    title: booking.status === "enquiry" ? `? ${booking.client.name} · ${booking.service} (follow up)` : `✓ ${booking.client.name} · ${booking.service}`,
    start: utc(start), end: utc(end),
    description: [formatPhone(booking.client.phone), new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(booking.priceCents / 100), booking.status === "enquiry" && booking.followUpOn ? `Follow up: ${booking.followUpOn}` : null, `${appUrl.replace(/\/$/, "")}/bookings/${booking.id}`].filter(Boolean).join("\n"),
    location: booking.location ?? "",
    status: booking.status === "enquiry" ? "TENTATIVE" : "CONFIRMED",
  };
}

export function buildCalendar({ bookings, name, appUrl, now = new Date() }: {
  bookings: readonly CalendarBooking[]; name: string; appUrl: string; now?: Date;
}) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sorted//Bookings//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${escapeText(name)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M"];
  for (const booking of bookings) {
    if (booking.status === "cancelled") continue;
    const event = calendarEvent(booking, appUrl);
    lines.push("BEGIN:VEVENT", `UID:${escapeText(event.uid)}`, `DTSTAMP:${utc(now)}`, `DTSTART:${event.start}`, `DTEND:${event.end}`,
      `SUMMARY:${escapeText(event.title)}`, `LOCATION:${escapeText(event.location)}`, `DESCRIPTION:${escapeText(event.description)}`, `STATUS:${event.status}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function googleCalendarEventUrl(booking: CalendarBooking, appUrl: string) {
  const event = calendarEvent(booking, appUrl);
  return `https://calendar.google.com/calendar/render?${new URLSearchParams({ action: "TEMPLATE", text: event.title, dates: `${event.start}/${event.end}`, details: event.description, location: event.location })}`;
}
