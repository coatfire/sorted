import { z } from "zod";
import { addCalendarDays, dublinDateTime } from "./dates";
import type { Booking } from "./types";

/** A calendar month as YYYY-MM. Kept to this century so every date stays valid. */
export const CalendarMonth = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, "Enter a valid month.");
export const FIRST_CALENDAR_MONTH = "2000-01";
export const LAST_CALENDAR_MONTH = "2099-12";

export function addCalendarMonths(month: string, months: number): string {
  const [year, index] = CalendarMonth.parse(month).split("-").map(Number);
  const moved = new Date(Date.UTC(year, index - 1 + months, 1)).toISOString().slice(0, 7);
  return moved < FIRST_CALENDAR_MONTH ? FIRST_CALENDAR_MONTH : moved > LAST_CALENDAR_MONTH ? LAST_CALENDAR_MONTH : moved;
}

/** The whole weeks, Monday first, that cover a month. */
export function monthWeeks(month: string): string[][] {
  const first = `${CalendarMonth.parse(month)}-01`;
  let monday = addCalendarDays(first, -((new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7));
  const weeks: string[][] = [];
  do {
    weeks.push(Array.from({ length: 7 }, (_, index) => addCalendarDays(monday, index)));
    monday = addCalendarDays(monday, 7);
  } while (monday.slice(0, 7) === month);
  return weeks;
}

/** Dated bookings that still hold a place in the diary, by their day in Ireland. */
export function bookingsByDay<T extends Pick<Booking, "id" | "status" | "startAt" | "timeTbc" | "createdAt">>(bookings: readonly T[]): Map<string, T[]> {
  const days = new Map<string, T[]>();
  const dated = bookings.filter((booking) => booking.startAt !== null && booking.status !== "cancelled")
    .sort((a, b) => Number(Boolean(b.timeTbc)) - Number(Boolean(a.timeTbc)) || Date.parse(a.startAt!) - Date.parse(b.startAt!) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const booking of dated) {
    const day = dublinDateTime(booking.startAt!).date;
    days.set(day, [...(days.get(day) ?? []), booking]);
  }
  return days;
}
