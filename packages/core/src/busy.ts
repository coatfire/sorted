import { z } from "zod";
import { addCalendarDays, CalendarDate, dublinDateTime } from "./dates";

export const EXTERNAL_CALENDAR_LIMIT = 3;
export const BUSY_RANGE_DAYS = 62;

const PROVIDERS = [
  { provider: "google", label: "Google", hosts: /^calendar\.google\.com$/ },
  { provider: "apple", label: "Apple", hosts: /^[a-z0-9-]+\.icloud\.com$/ },
  { provider: "outlook", label: "Outlook", hosts: /^outlook\.(live|office|office365)\.com$/ },
] as const;
export type ExternalCalendarProvider = (typeof PROVIDERS)[number]["provider"];

/** The provider behind a private calendar link, or null when Sorted doesn't read links from that host. */
export function externalCalendarProvider(url: string): ExternalCalendarProvider | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password) return null;
    return PROVIDERS.find((item) => item.hosts.test(parsed.hostname))?.provider ?? null;
  } catch {
    return null;
  }
}
export const externalCalendarLabel = (provider: ExternalCalendarProvider) => PROVIDERS.find((item) => item.provider === provider)!.label;

/** A private iCal link from Google, iCloud or Outlook. `webcal:` links are read over https. */
export const ExternalCalendarUrl = z.string().trim().max(2000)
  .transform((url) => url.replace(/^webcals?:\/\//i, "https://"))
  .refine((url) => externalCalendarProvider(url) !== null, "Paste a calendar link from Google, Apple (iCloud) or Outlook.");

export const AddExternalCalendarInput = z.object({ url: ExternalCalendarUrl }).strict();
export const BusyRange = z.object({ from: CalendarDate, to: CalendarDate })
  // An impossible date such as 30 February is already reported by CalendarDate.
  .refine(({ from, to }) => !CalendarDate.safeParse(from).success || (from <= to && to <= addCalendarDays(from, BUSY_RANGE_DAYS)), "Choose a shorter range.");

/** A calendar outside Sorted that is read, never written. Its link is never sent back to the browser. */
export interface ExternalCalendar {
  id: string;
  provider: ExternalCalendarProvider;
  createdAt: string;
}

/**
 * An entry from an outside calendar. Read-only: it never changes a booking.
 * All-day blocks carry dates (`end` is the last day); timed blocks carry instants.
 */
export interface BusyBlock {
  id: string;
  calendarId: string;
  provider: ExternalCalendarProvider;
  title: string;
  allDay: boolean;
  start: string;
  end: string;
}
export interface BusyResult {
  blocks: BusyBlock[];
  /** Calendars that couldn't be read this time. */
  failed: ExternalCalendarProvider[];
}

/** Busy blocks by each day from `from` to `to` that they touch in Ireland: all-day first, then by start. */
export function busyByDay(blocks: readonly BusyBlock[], from: string, to: string): Map<string, BusyBlock[]> {
  const days = new Map<string, BusyBlock[]>();
  const sorted = [...blocks].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  for (const block of sorted) {
    const first = block.allDay ? block.start : dublinDateTime(block.start).date;
    // A timed block that ends exactly at midnight doesn't touch the next day.
    const last = block.allDay ? block.end : dublinDateTime(new Date(Math.max(Date.parse(block.start), Date.parse(block.end) - 1))).date;
    // Only the days asked for: an absence can run for years, and its whole length must stay busy.
    for (let day = first > from ? first : from; day <= last && day <= to; day = addCalendarDays(day, 1)) {
      days.set(day, [...(days.get(day) ?? []), block]);
    }
  }
  return days;
}

/**
 * One day's bookings and Busy blocks in a single list by start time. Entries with no time on that day
 * (all-day, carried over from the day before, or time to be confirmed) come first.
 */
export function dayTimeline<T extends { startAt: string | null; timeTbc?: boolean }>(day: string, bookings: readonly T[], blocks: readonly BusyBlock[]): ({ booking: T } | { block: BusyBlock })[] {
  const blockTime = (block: BusyBlock) => {
    if (block.allDay) return "";
    const start = dublinDateTime(block.start);
    return start.date === day ? start.time : "";
  };
  return [
    ...blocks.map((block) => ({ at: blockTime(block), entry: { block } })),
    ...bookings.map((booking) => ({ at: booking.timeTbc || !booking.startAt ? "" : dublinDateTime(booking.startAt).time, entry: { booking } })),
  ].sort((a, b) => a.at.localeCompare(b.at)).map(({ entry }) => entry);
}
