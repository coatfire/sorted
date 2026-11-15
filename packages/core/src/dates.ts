import { z } from "zod";

export const CalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.").refine((date) => {
  const value = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
}, "Enter a valid date.");

export function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${CalendarDate.parse(date)}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(CalendarDate.parse(to)) - Date.parse(CalendarDate.parse(from))) / 86400000);
}
