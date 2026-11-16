import ICAL from "ical.js";
import { addCalendarDays, bookingAtDublinTime, externalCalendarProvider, type BusyBlock, type ExternalCalendarProvider } from "@sorted/core";

const MAX_BYTES = 5_000_000;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_OCCURRENCES = 20_000;
const MAX_BLOCKS = 2000;
const DAY_MS = 86_400_000;

export class CalendarReadError extends Error {}

/**
 * Downloads a private calendar link. Only the calendar hosts Sorted knows are ever requested,
 * including after a redirect, so a saved link can't be pointed at anything else.
 */
export async function fetchCalendarText(url: string): Promise<string> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let next = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!externalCalendarProvider(next)) throw new CalendarReadError("That link left the calendar provider.");
    const response = await fetch(next, { redirect: "manual", signal, headers: { Accept: "text/calendar" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new CalendarReadError("The calendar link redirected nowhere.");
      next = new URL(location, next).toString();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CalendarReadError(`The calendar provider answered ${response.status}.`);
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new CalendarReadError("That calendar is too big to read.");
      }
      chunks.push(value);
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    if (!/^\uFEFF?\s*BEGIN:VCALENDAR/i.test(text)) throw new CalendarReadError("That link isn't a calendar.");
    return text;
  }
  throw new CalendarReadError("The calendar link redirected too many times.");
}

function zoneOffset(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
  const part = (type: string) => Number(parts.find((item) => item.type === type)!.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")) - at;
}

function knownZone(tzid: unknown): string {
  try {
    if (typeof tzid === "string") return new Intl.DateTimeFormat("en-GB", { timeZone: tzid }).resolvedOptions().timeZone;
  } catch { /* An unknown zone name is read as Irish time. */ }
  return "Europe/Dublin";
}

/** The instant of a calendar time. A time with no usable zone in the file is wall time in `fallbackZone`. */
function instant(time: ICAL.Time, fallbackZone: string): number {
  if (time.zone && time.zone !== ICAL.Timezone.localTimezone) return time.toUnixTime() * 1000;
  const wall = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  const guess = wall - zoneOffset(wall, fallbackZone);
  return wall - zoneOffset(guess, fallbackZone);
}

const isoDate = (time: ICAL.Time) => `${String(time.year).padStart(4, "0")}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;

/**
 * Entries of an outside calendar that touch `from`…`to` (days in Ireland), repeats expanded.
 * Sorted's own bookings that were added to that calendar are left out so a job never shows twice.
 */
export function busyBlocks(text: string, options: { from: string; to: string; calendarId: string; provider: ExternalCalendarProvider; appUrl: string }): BusyBlock[] {
  const { from, to, calendarId, provider } = options;
  const rangeStart = bookingAtDublinTime(from, "00:00").getTime();
  const rangeEnd = bookingAtDublinTime(addCalendarDays(to, 1), "00:00").getTime();
  const bookingLink = `${options.appUrl.replace(/\/$/, "")}/bookings/`;
  const blocks: BusyBlock[] = [];

  const push = (item: ICAL.Event, start: ICAL.Time | null, end: ICAL.Time | null, zone: string) => {
    if (!start || blocks.length >= MAX_BLOCKS || item.component.getFirstPropertyValue("status") === "CANCELLED") return;
    const title = (typeof item.summary === "string" ? item.summary : "").replace(/\s+/g, " ").trim().slice(0, 120) || "Busy";
    if (start.isDate) {
      const first = isoDate(start);
      const exclusiveEnd = end ? isoDate(end) : first;
      const last = exclusiveEnd > first ? addCalendarDays(exclusiveEnd, -1) : first;
      if (first <= to && last >= from) blocks.push({ id: `${calendarId}:${item.uid}:${first}`, calendarId, provider, title, allDay: true, start: first, end: last });
      return;
    }
    const startAt = instant(start, zone);
    const endAt = Math.max(startAt, end ? instant(end, zone) : startAt);
    if (startAt < rangeEnd && (endAt > rangeStart || startAt >= rangeStart)) {
      blocks.push({ id: `${calendarId}:${item.uid}:${startAt}`, calendarId, provider, title, allDay: false, start: new Date(startAt).toISOString(), end: new Date(endAt).toISOString() });
    }
  };

  const root = new ICAL.Component(ICAL.parse(text));
  const masters: ICAL.Component[] = [];
  const exceptions = new Map<string, ICAL.Component[]>();
  for (const component of root.getAllSubcomponents("vevent")) {
    const uid = component.getFirstPropertyValue("uid");
    if (typeof uid !== "string" || uid.endsWith("@sorted")) continue;
    const description = component.getFirstPropertyValue("description");
    if (typeof description === "string" && description.includes(bookingLink)) continue;
    if (component.hasProperty("recurrence-id")) exceptions.set(uid, [...(exceptions.get(uid) ?? []), component]);
    else masters.push(component);
  }

  for (const component of masters) {
    const uid = component.getFirstPropertyValue("uid") as string;
    const event = new ICAL.Event(component, { strictExceptions: true, exceptions: exceptions.get(uid) ?? [] });
    exceptions.delete(uid);
    const zone = knownZone(component.getFirstProperty("dtstart")?.getParameter("tzid"));
    if (!event.startDate) continue;
    if (!event.isRecurring()) {
      push(event, event.startDate, event.endDate, zone);
      continue;
    }
    const iterator = event.iterator();
    for (let count = 0; count < MAX_OCCURRENCES; count++) {
      const occurrence = iterator.next();
      // A moved occurrence can land up to a week either side of its original slot.
      if (!occurrence || (occurrence.isDate ? isoDate(occurrence) > addCalendarDays(to, 7) : instant(occurrence, zone) > rangeEnd + 7 * DAY_MS)) break;
      const details = event.getOccurrenceDetails(occurrence);
      push(details.item, details.startDate, details.endDate, zone);
    }
  }
  // A changed occurrence whose repeating event isn't in the file stands on its own.
  for (const orphans of exceptions.values()) {
    for (const component of orphans) {
      const event = new ICAL.Event(component, { strictExceptions: true, exceptions: [] });
      push(event, event.startDate, event.endDate, knownZone(component.getFirstProperty("dtstart")?.getParameter("tzid")));
    }
  }
  return blocks;
}
