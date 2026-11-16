import { spawn } from "node:child_process";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { addCalendarMonths, bookingsByDay, CalendarMonth, monthWeeks } from "@sorted/core";

describe("month calendar", () => {
  it("lays a month out in whole weeks starting on Monday", () => {
    expect(monthWeeks("2027-02")).toHaveLength(4);
    expect(monthWeeks("2027-02")[0][0]).toBe("2027-02-01");
    expect(monthWeeks("2027-02")[3][6]).toBe("2027-02-28");
    const leap = monthWeeks("2028-02");
    expect(leap[0]).toEqual(["2028-01-31", "2028-02-01", "2028-02-02", "2028-02-03", "2028-02-04", "2028-02-05", "2028-02-06"]);
    expect(leap.flat()).toContain("2028-02-29");
    const august = monthWeeks("2026-08");
    expect(august).toHaveLength(6);
    expect(august[0][5]).toBe("2026-08-01");
    expect(august[5][0]).toBe("2026-08-31");
    for (const week of [...leap, ...august]) expect(new Date(`${week[0]}T12:00:00Z`).getUTCDay()).toBe(1);
  });

  it("steps months across years and stops at the ends of the century", () => {
    expect(addCalendarMonths("2026-12", 1)).toBe("2027-01");
    expect(addCalendarMonths("2027-01", -1)).toBe("2026-12");
    expect(addCalendarMonths("2026-11", 24)).toBe("2028-11");
    expect(addCalendarMonths("2099-12", 1)).toBe("2099-12");
    expect(addCalendarMonths("2000-01", -1)).toBe("2000-01");
    expect(CalendarMonth.safeParse("2028-13").success).toBe(false);
    expect(CalendarMonth.safeParse("1999-12").success).toBe(false);
  });

  it("groups bookings by their day in Ireland, time-to-be-agreed first, without cancelled or undated ones", () => {
    const booking = (id: string, startAt: string | null, extra: object = {}) => ({ id, status: "confirmed" as const, startAt, timeTbc: false, ...extra });
    const days = bookingsByDay([
      booking("late-summer", "2028-08-11T23:30:00Z"),
      booking("afternoon", "2028-08-12T13:00:00Z"),
      booking("tbc", "2028-08-12T11:00:00Z", { timeTbc: true, status: "enquiry" }),
      booking("morning", "2028-08-12T08:00:00Z", { status: "completed" }),
      booking("cancelled", "2028-08-12T09:00:00Z", { status: "cancelled" }),
      booking("undated", null, { status: "enquiry" }),
      booking("winter", "2028-12-24T23:30:00Z"),
    ]);
    expect([...days.keys()].sort()).toEqual(["2028-08-12", "2028-12-24"]);
    expect(days.get("2028-08-12")!.map(item => item.id)).toEqual(["tbc", "late-summer", "morning", "afternoon"]);
  });
});

async function renderCalendar(entries: string[], bookings: object[]) {
  const bundle = await build({
    stdin: {
      contents: `import {createElement} from "react"; import {renderToStaticMarkup} from "react-dom/server";
        import {MemoryRouter, Routes, Route} from "react-router-dom"; import {Calendar} from "./pages/Calendar"; import {BookingForm} from "./pages/BookingForm";
        export function render(entry, bookings) {
          globalThis.__snapshot = { bookings: entry.startsWith("/calendar") ? bookings : [], payments: [], clients: [], user: { services: [] } };
          const RealDate = Date;
          globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ["2026-11-16T12:00:00Z"])); } static now() { return RealDate.parse("2026-11-16T12:00:00Z"); } };
          try { return renderToStaticMarkup(createElement(MemoryRouter, {initialEntries: [entry]}, createElement(Routes, null,
            createElement(Route, {path: "/calendar", element: createElement(Calendar)}), createElement(Route, {path: "/bookings/new", element: createElement(BookingForm)})))); }
          finally { globalThis.Date = RealDate; }
        }`,
      resolveDir: new URL("../../web/src", import.meta.url).pathname, loader: "tsx",
    },
    plugins: [{ name: "calendar-store", setup(build) {
      build.onResolve({ filter: /lib\/store$/ }, () => ({ path: "store", namespace: "calendar-test" }));
      build.onLoad({ filter: /.*/, namespace: "calendar-test" }, () => ({ contents: `export const useData = () => globalThis.__snapshot;
        export const useStore = () => ({backend: {}, toast: () => {}});
        export const useSession = () => ({mode: "demo"});
        export const useAction = () => ({busy: false, error: null, committed: false, run: () => {}});` }));
    } }],
    bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false, external: ["./bookingPdf"],
  });
  return new Promise<string[]>((resolve, reject) => {
    const child = spawn(process.execPath, ["-"], { stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [], errors: Buffer[] = [];
    child.stdout.on("data", chunk => output.push(chunk)); child.stderr.on("data", chunk => errors.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) return reject(new Error(Buffer.concat(errors).toString()));
      try { resolve(JSON.parse(Buffer.concat(output).toString()) as string[]); } catch (error) { reject(error); }
    });
    child.stdin.end(`${bundle.outputFiles[0].text}\nprocess.stdout.write(JSON.stringify(${JSON.stringify(entries)}.map(entry => module.exports.render(entry, ${JSON.stringify(bookings)}))));`);
  });
}

it("renders the month, the tapped day's jobs and an Add booking link for that day, years ahead", async () => {
  const client = { id: "client", name: "Niamh Byrne", phone: "353871112223", email: null };
  const booking = (id: string, startAt: string | null, extra: object = {}) => ({ id, clientId: client.id, client, service: "Wedding hair", priceCents: 25000, depositCents: 0, status: "confirmed", startAt, timeTbc: false, ...extra });
  const bookings = [
    booking("wedding", "2028-08-12T08:30:00Z"),
    booking("trial", "2028-08-12T13:00:00Z", { status: "enquiry", service: "Bridal trial" }),
    booking("cancelled", "2028-08-13T09:00:00Z", { status: "cancelled", service: "Cancelled job" }),
    booking("today", "2026-11-16T15:00:00Z", { service: "Blow dry" }),
    booking("undated", null, { status: "enquiry", service: "Undated enquiry" }),
  ];
  const [today, month, day, empty, invalid, form, badForm] = await renderCalendar([
    "/calendar", "/calendar?month=2028-08", "/calendar?month=2028-08&day=2028-08-12", "/calendar?month=2028-08&day=2028-08-14",
    "/calendar?month=nope&day=2028-02-30", "/bookings/new?date=2028-08-14", "/bookings/new?date=2028-02-30",
  ], bookings);

  expect(today).toContain("November 2026");
  expect(today).toMatch(/aria-pressed="true" aria-label="Monday 16 November 2026, today, 1 booking"/);
  expect(today).toContain("Blow dry");
  expect(today).toContain('href="/bookings/new?date=2026-11-16"');
  expect(today).not.toContain("Undated enquiry");
  expect(invalid).toContain("November 2026");

  expect(month).toContain("August 2028");
  expect(month.match(/class="calendar-day/g)).toHaveLength(31);
  expect(month).toContain('aria-label="Saturday 12 August 2028, 1 booking, 1 enquiry"');
  expect(month).toContain('aria-label="Sunday 13 August 2028, nothing booked"');
  expect(month).not.toContain('aria-pressed="true"');
  expect(month).toContain("2 jobs");
  expect(month).toContain("Bridal trial");
  expect(month).not.toContain("Cancelled job");
  expect(month).not.toContain("/bookings/new?date=");

  expect(day).toContain("Saturday 12 August 2028</h2>");
  expect(day.indexOf("09:30")).toBeGreaterThan(-1);
  expect(day.indexOf("09:30")).toBeLessThan(day.indexOf("14:00"));
  expect(day).toContain('href="/bookings/wedding"');
  expect(day).toContain('href="/bookings/new?date=2028-08-12"');

  expect(empty).toContain("Nothing booked");
  expect(empty).toContain('href="/bookings/new?date=2028-08-14"');
  expect(empty).not.toContain("Wedding hair");

  expect(form).toContain('name="date" type="date" value="2028-08-14"');
  expect(badForm).toContain('name="date" type="date" value=""');
}, 20000);
