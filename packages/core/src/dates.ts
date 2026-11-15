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

const dublinFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function wallTime(value: Date): number {
  const parts = dublinFormatter.formatToParts(value);
  const part = (type: string) => Number(parts.find((item) => item.type === type)!.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"), value.getUTCMilliseconds());
}

function fromWallTime(wall: number, initial: number): Date {
  let candidate = initial;
  let previous = initial;
  for (let attempt = 0; attempt < 4; attempt++) {
    const next = wall - (wallTime(new Date(candidate)) - candidate);
    if (next === candidate) return new Date(candidate);
    if (next === previous) return new Date(Math.max(next, candidate));
    previous = candidate;
    candidate = next;
  }
  throw new Error("Couldn't work out the booking time.");
}

export function dublinDateTime(value: Date | string) {
  const wall = new Date(wallTime(new Date(value))).toISOString();
  return { date: wall.slice(0, 10), time: wall.slice(11, 16) };
}

export function bookingAtDublinTime(date: string, time: string, original?: string): Date {
  CalendarDate.parse(date);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Pick a valid time.");
  if (original) {
    const initial = dublinDateTime(original);
    if (date === initial.date && time === initial.time) return new Date(original);
  }
  const wall = Date.parse(`${date}T${time}:00Z`);
  return fromWallTime(wall, wall);
}

export function shiftDublinWeeks(value: Date | string, weeks: number): Date {
  if (!Number.isInteger(weeks)) throw new Error("Choose a whole number of weeks.");
  const original = new Date(value);
  const shifted = wallTime(original) + weeks * 7 * 86400000;
  return fromWallTime(shifted, original.getTime() + weeks * 7 * 86400000);
}

export function bookAgainStart(original: string, weeks = 1, now = new Date()): Date {
  if (!Number.isInteger(weeks) || weeks < 1) throw new Error("Choose at least one week.");
  const originalDate = dublinDateTime(original).date;
  const today = dublinDateTime(now).date;
  const elapsed = Math.max(0, calendarDaysBetween(originalDate, today));
  return shiftDublinWeeks(original, Math.ceil(elapsed / 7) + weeks);
}
