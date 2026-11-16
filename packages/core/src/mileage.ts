import { z } from "zod";
import { CalendarDate, dublinDateTime } from "./dates";
import { irelandToday } from "./recordPayment";
import { inExportRange, type ExportRange } from "./exportRange";
import type { ExportSection } from "./exportFile";
import { TravelMetres, type Booking, type Client } from "./types";

/** A business trip that isn't a booking: the wholesaler, a course. */
export const TripInput = z.object({
  trip_date: CalendarDate.refine((date) => date <= irelandToday(), "A trip's date cannot be in the future."),
  destination: z.string().trim().min(1).max(500),
  purpose: z.string().trim().min(1).max(200),
  travel_metres: TravelMetres,
});
export type TripInput = z.infer<typeof TripInput>;

export const BookingTravelInput = z.object({ travel_metres: TravelMetres.nullable() });

export interface Trip {
  id: string;
  /** The day of the trip, as a date in Ireland. */
  tripDate: string;
  destination: string;
  purpose: string;
  travelMetres: number;
  createdAt: string;
}

/** What's typed in a km box, in metres to the nearest 100. Null when empty; undefined when it isn't a distance. */
export function parseKm(input: string): number | null | undefined {
  const typed = input.trim().replace(/\s*km$/i, "").replace(",", ".");
  if (!typed) return null;
  if (!/^\d+(\.\d+)?$/.test(typed)) return undefined;
  const metres = Math.round(Number(typed) * 10) * 100;
  return TravelMetres.safeParse(metres).success ? metres : undefined;
}

/** "24" or "24.5", for a km box. */
export const kmInput = (metres: number | null | undefined) => (metres ? String(Math.round(metres / 100) / 10) : "");

/** "1,240 km" */
export const kmLabel = (metres: number) => `${(Math.round(metres / 100) / 10).toLocaleString("en-IE", { maximumFractionDigits: 1 })} km`;

const samePlace = (a: string, b: string) => a.trim().toLowerCase().replace(/[\s,]+/g, " ") === b.trim().toLowerCase().replace(/[\s,]+/g, " ");

/** The km recorded for the latest job at this address, by the job's date; a job with no date yet goes by when it was added. */
export function lastTravelTo(bookings: readonly Pick<Booking, "location" | "travelMetres" | "startAt" | "createdAt">[], location: string): number | null {
  if (!location.trim()) return null;
  const visits = bookings.filter((booking) => booking.travelMetres && booking.location && samePlace(booking.location, location));
  const when = (booking: (typeof visits)[number]) => new Date(booking.startAt ?? booking.createdAt).getTime();
  return visits.sort((a, b) => when(b) - when(a))[0]?.travelMetres ?? null;
}

export interface MileageRow { date: string; to: string; purpose: string; metres: number; bookingId?: string }

type TravelBooking = Pick<Booking, "id" | "status" | "startAt" | "location" | "service" | "travelMetres"> & { client: Pick<Client, "name"> };

/**
 * The trips made in a range of dates, oldest first: jobs that went ahead with km recorded, and trips added on their own.
 * A job counts from its day onwards, so km on a future or cancelled booking isn't claimed before it's driven.
 */
export function mileageLog(bookings: readonly TravelBooking[], trips: readonly Trip[], range: ExportRange, today = irelandToday()): MileageRow[] {
  const counts = (date: string) => date <= today && inExportRange(date, range);
  const rows: MileageRow[] = [];
  for (const booking of bookings) {
    if (!booking.travelMetres || !booking.startAt || (booking.status !== "confirmed" && booking.status !== "completed")) continue;
    const date = dublinDateTime(booking.startAt).date;
    if (counts(date)) rows.push({ date, to: booking.location ?? "", purpose: `${booking.service} for ${booking.client.name}`, metres: booking.travelMetres, bookingId: booking.id });
  }
  for (const trip of trips) {
    if (counts(trip.tripDate)) rows.push({ date: trip.tripDate, to: trip.destination, purpose: trip.purpose, metres: trip.travelMetres });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export const mileageMetres = (rows: readonly MileageRow[]) => rows.reduce((sum, row) => sum + row.metres, 0);

/** The mileage log as a sheet of the accountant export. Every trip starts from the business address and returns to it. */
export const mileageSection = (rows: readonly MileageRow[], from: string | null): ExportSection => ({
  title: "Mileage",
  header: ["date", "from", "to", "purpose", "km_there_and_back"],
  decimals: 1,
  rows: rows.map((row) => [row.date, from?.replace(/\s*\n\s*/g, ", ") ?? "", row.to, row.purpose, row.metres / 1000]),
});
