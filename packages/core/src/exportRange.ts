import { z } from "zod";
import { addCalendarDays, bookingAtDublinTime, CalendarDate, dublinDateTime } from "./dates";

/** The dates an accountant export covers: both days included, as dates in Ireland. */
export const ExportRange = z
  .object({ from: CalendarDate, to: CalendarDate })
  .refine((range) => range.from <= range.to, "The from date must be on or before the to date.");
export type ExportRange = z.infer<typeof ExportRange>;

export const yearRange = (year: number): ExportRange => ({ from: `${year}-01-01`, to: `${year}-12-31` });

export const ExportFormat = z.enum(["xlsx", "csv"]);
export type ExportFormat = z.infer<typeof ExportFormat>;

/** "sorted-2025.xlsx" for a whole calendar year, otherwise the two dates. */
export function exportFileName({ from, to }: ExportRange, format: ExportFormat = "csv"): string {
  const year = from.slice(0, 4);
  return `sorted-${from === `${year}-01-01` && to === `${year}-12-31` ? year : `${from}-to-${to}`}.${format}`;
}

/**
 * The same range as instants. A payment is a moment, so its day runs midnight to midnight in Ireland;
 * an expense is a plain date, stored as midnight UTC.
 */
export function exportBounds({ from, to }: ExportRange) {
  const after = addCalendarDays(to, 1);
  return {
    paidFrom: bookingAtDublinTime(from, "00:00"),
    paidBefore: bookingAtDublinTime(after, "00:00"),
    expenseFrom: new Date(`${from}T00:00:00Z`),
    expenseBefore: new Date(`${after}T00:00:00Z`),
  };
}

/** The day a payment was received, in Ireland. */
export const paidOn = (paidAt: Date | string) => dublinDateTime(paidAt).date;

export const inExportRange = (date: string, { from, to }: ExportRange) => date >= from && date <= to;
