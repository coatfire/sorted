import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { busyByDay, ExternalCalendarUrl, type BusyBlock, type BusyResult, type ExternalCalendar } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import { busyBlocks } from "../src/lib/externalCalendar";

const GOOGLE = "https://calendar.google.com/calendar/ical/me%40example.com/private-abc/basic.ics";
const event = (lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"];
const ics = (...events: string[][]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//EN",
  "BEGIN:VTIMEZONE", "TZID:America/New_York",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:-0500", "TZOFFSETTO:-0400", "DTSTART:19700308T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:-0400", "TZOFFSETTO:-0500", "DTSTART:19701101T020000", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU", "END:STANDARD",
  "END:VTIMEZONE", ...events.flat(), "END:VCALENDAR"].join("\r\n");
const read = (text: string, from: string, to: string) => busyBlocks(text, { from, to, calendarId: "cal", provider: "google", appUrl: "https://sorted.example" })
  .map(({ title, allDay, start, end }) => ({ title, allDay, start, end }));

afterEach(() => vi.restoreAllMocks());

describe("busy blocks", () => {
  it("only accepts private links on Google, Apple and Outlook calendar hosts", () => {
    expect(ExternalCalendarUrl.parse(` ${GOOGLE} `)).toBe(GOOGLE);
    expect(ExternalCalendarUrl.parse("webcal://p12-caldav.icloud.com/published/2/abc")).toBe("https://p12-caldav.icloud.com/published/2/abc");
    expect(ExternalCalendarUrl.safeParse("https://outlook.live.com/owa/calendar/x/calendar.ics").success).toBe(true);
    for (const url of ["http://calendar.google.com/x.ics", "https://calendar.google.com.evil.example/x.ics", "https://evilicloud.com/x", "https://calendar.google.com:8443/x.ics",
      "https://user:pass@calendar.google.com/x.ics", "https://169.254.169.254/latest", "https://localhost/x.ics", "https://sorted.example/api/calendar/t/confirmed.ics", "nope"]) {
      expect(ExternalCalendarUrl.safeParse(url).success, url).toBe(false);
    }
  });

  it("places blocks on each day they touch in Ireland", () => {
    const block = (title: string, start: string, end: string, allDay = false): BusyBlock => ({ id: title, calendarId: "cal", provider: "google", title, allDay, start, end });
    const days = busyByDay([
      block("Evening", "2028-08-12T19:00:00Z", "2028-08-12T23:00:00Z"),
      block("Late", "2028-08-12T23:30:00Z", "2028-08-13T00:30:00Z"),
      block("Holiday", "2028-08-12", "2028-08-14", true),
    ]);
    expect([...days.keys()].sort()).toEqual(["2028-08-12", "2028-08-13", "2028-08-14"]);
    // 23:00Z is midnight in Ireland in summer, so "Evening" stops on the 12th and "Late" is wholly on the 13th.
    expect(days.get("2028-08-12")!.map(item => item.title)).toEqual(["Holiday", "Evening"]);
    expect(days.get("2028-08-13")!.map(item => item.title)).toEqual(["Holiday", "Late"]);
  });

  it("reads zones, all-day ranges and repeats, and leaves out cancelled entries and Sorted's own bookings", () => {
    const text = ics(
      event(["UID:ny", "DTSTART;TZID=America/New_York:20280812T090000", "DTEND;TZID=America/New_York:20280812T100000", "SUMMARY:NY call"]),
      event(["UID:floating", "DTSTART:20280812T093000", "DURATION:PT45M", "SUMMARY:Dentist\\, check-up"]),
      event(["UID:utc", "DTSTART:20281212T100000Z", "DTEND:20281212T110000Z"]),
      event(["UID:holiday", "DTSTART;VALUE=DATE:20281224", "DTEND;VALUE=DATE:20290102", "SUMMARY:Holiday"]),
      event(["UID:yoga", "DTSTART;TZID=Europe/Dublin:20261005T180000", "DTEND;TZID=Europe/Dublin:20261005T190000", "RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;TZID=Europe/Dublin:20261116T180000", "SUMMARY:Yoga"]),
      event(["UID:yoga", "RECURRENCE-ID;TZID=Europe/Dublin:20261123T180000", "DTSTART;TZID=Europe/Dublin:20261124T200000", "DTEND;TZID=Europe/Dublin:20261124T210000", "SUMMARY:Yoga (moved)"]),
      event(["UID:yoga", "RECURRENCE-ID;TZID=Europe/Dublin:20261130T180000", "DTSTART;TZID=Europe/Dublin:20261130T180000", "DTEND;TZID=Europe/Dublin:20261130T190000", "STATUS:CANCELLED", "SUMMARY:Yoga"]),
      event(["UID:gone", "DTSTART:20280812T120000Z", "DTEND:20280812T130000Z", "STATUS:CANCELLED", "SUMMARY:Cancelled"]),
      event(["UID:11111111-1111-4111-8111-111111111111@sorted", "DTSTART:20280812T140000Z", "DTEND:20280812T150000Z", "SUMMARY:✓ Niamh · Wedding hair"]),
      event(["UID:google-made", "DTSTART:20280812T160000Z", "DTEND:20280812T170000Z", "SUMMARY:✓ Aoife · Trial", "DESCRIPTION:087 123 4567\\nhttps://sorted.example/bookings/22222222-2222-4222-8222-222222222222"]),
    );
    expect(read(text, "2028-08-12", "2028-08-12")).toEqual([
      { title: "NY call", allDay: false, start: "2028-08-12T13:00:00.000Z", end: "2028-08-12T14:00:00.000Z" },
      // No zone in the file: read as Irish time, which is UTC+1 in August.
      { title: "Dentist, check-up", allDay: false, start: "2028-08-12T08:30:00.000Z", end: "2028-08-12T09:15:00.000Z" },
    ]);
    expect(read(text, "2028-12-01", "2028-12-31")).toEqual(expect.arrayContaining([
      { title: "Busy", allDay: false, start: "2028-12-12T10:00:00.000Z", end: "2028-12-12T11:00:00.000Z" },
      { title: "Holiday", allDay: true, start: "2028-12-24", end: "2029-01-01" },
    ]));
    expect(read(text, "2029-01-02", "2029-01-02").filter(item => item.title === "Holiday")).toEqual([]);
    // Summer time on 19 Oct (17:00Z), winter time from 26 Oct (18:00Z); 16 Nov removed, 23 Nov moved, 30 Nov cancelled.
    const yoga = read(text, "2026-10-19", "2026-11-30").filter(item => item.title.startsWith("Yoga"));
    expect(yoga.map(item => item.start)).toEqual(["2026-10-19T17:00:00.000Z", "2026-10-26T18:00:00.000Z", "2026-11-02T18:00:00.000Z", "2026-11-09T18:00:00.000Z", "2026-11-24T20:00:00.000Z"]);
    expect(yoga[4].title).toBe("Yoga (moved)");
    expect(read(text, "2031-03-03", "2031-03-03")).toEqual([{ title: "Yoga", allDay: false, start: "2031-03-03T18:00:00.000Z", end: "2031-03-03T19:00:00.000Z" }]);
  });
});

async function account() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const [client] = await db.insert(schema.clients).values({ userId: user.id, name: "Client" }).returning();
  const [booking] = await db.insert(schema.bookings).values({ userId: user.id, clientId: client.id, service: "Cut", status: "confirmed", startAt: new Date("2028-08-12T09:00:00Z"), priceCents: 5000 }).returning();
  const jwt = await issueJwt(user.id, user.sessionVersion);
  const request = (path: string, method = "GET", body?: unknown) => app.request(`https://api.sorted.example/api/calendar${path}`, {
    method, headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { user, booking, request };
}
const calendarFile = (title: string) => ics(event(["UID:one", "DTSTART:20280812T100000Z", "DTEND:20280812T110000Z", `SUMMARY:${title}`]));
const serve = (pages: Record<string, () => Response>) => vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
  const page = pages[String(input)];
  if (!page) throw new Error(`Unexpected request to ${String(input)}`);
  return page();
});

describe("external calendars", () => {
  it("requires a session", async () => {
    for (const [path, method] of [["/external", "GET"], ["/external", "POST"], ["/external/x", "DELETE"], ["/busy?from=2028-08-01&to=2028-08-31", "GET"]]) {
      expect((await app.request(`/api/calendar${path}`, { method })).status).toBe(401);
    }
  });

  it("adds a readable link, never returns it, and shows its entries only to its owner without touching bookings", async () => {
    const f = await account(), other = await account();
    const fetched = serve({ [GOOGLE]: () => new Response(calendarFile("Dentist"), { headers: { "Content-Type": "text/calendar" } }) });
    const added = await f.request("/external", "POST", { url: GOOGLE.replace("https:", "webcal:") });
    expect(added.status).toBe(201);
    const calendar = await added.json() as ExternalCalendar;
    expect(calendar).toEqual({ id: expect.any(String), provider: "google", createdAt: expect.any(String) });
    expect(fetched.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    expect((await f.request("/external", "POST", { url: GOOGLE })).status).toBe(200);
    const listed = await f.request("/external");
    expect(await listed.clone().json()).toEqual([calendar]);
    expect(await listed.text()).not.toContain("private-abc");
    expect(await (await other.request("/external")).json()).toEqual([]);

    const busy = await (await f.request("/busy?from=2028-07-31&to=2028-09-03")).json() as BusyResult;
    expect(busy).toEqual({ failed: [], blocks: [{ id: expect.stringContaining(calendar.id), calendarId: calendar.id, provider: "google", title: "Dentist", allDay: false, start: "2028-08-12T10:00:00.000Z", end: "2028-08-12T11:00:00.000Z" }] });
    expect(await (await other.request("/busy?from=2028-07-31&to=2028-09-03")).json()).toEqual({ blocks: [], failed: [] });
    expect((await db.select().from(schema.bookings).where(eq(schema.bookings.userId, f.user.id)))).toEqual([f.booking]);
    for (const query of ["", "?from=2028-08-01", "?from=2028-08-31&to=2028-08-01", "?from=2028-01-01&to=2028-12-31", "?from=2028-02-30&to=2028-03-01"]) {
      expect((await f.request(`/busy${query}`)).status, query).toBe(400);
    }

    expect((await other.request(`/external/${calendar.id}`, "DELETE")).status).toBe(404);
    expect((await f.request(`/external/${calendar.id}`, "DELETE")).status).toBe(200);
    expect(await (await f.request("/busy?from=2028-08-01&to=2028-08-31")).json()).toEqual({ blocks: [], failed: [] });
  });

  it("refuses other hosts without requesting them, unreadable links, redirects off the provider, and a fourth calendar", async () => {
    const f = await account();
    const fetched = serve({
      [GOOGLE]: () => new Response("<html>Sign in</html>"),
      [`${GOOGLE}?missing`]: () => new Response("Not found", { status: 404 }),
      [`${GOOGLE}?redirect`]: () => new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/meta-data" } }),
      [`${GOOGLE}?moved`]: () => new Response(null, { status: 302, headers: { Location: `${GOOGLE}?ok=0` } }),
      ...Object.fromEntries([0, 1, 2, 3].map(index => [`${GOOGLE}?ok=${index}`, () => new Response(calendarFile("Fine"))])),
    });
    for (const url of ["https://example.com/calendar.ics", "http://localhost:5432/", "https://sorted.example/api/calendar/token/confirmed.ics"]) {
      expect((await f.request("/external", "POST", { url })).status, url).toBe(400);
    }
    expect((await f.request("/external", "POST", {})).status).toBe(400);
    expect(fetched).not.toHaveBeenCalled();
    for (const url of [GOOGLE, `${GOOGLE}?missing`, `${GOOGLE}?redirect`]) expect((await f.request("/external", "POST", { url })).status, url).toBe(422);
    expect(fetched.mock.calls.map(call => String(call[0]))).not.toContain("http://169.254.169.254/latest/meta-data");
    expect(await (await f.request("/external")).json()).toEqual([]);
    expect((await f.request("/external", "POST", { url: `${GOOGLE}?moved` })).status).toBe(201);
    for (const index of [1, 2]) expect((await f.request("/external", "POST", { url: `${GOOGLE}?ok=${index}` })).status).toBe(201);
    const fourth = await f.request("/external", "POST", { url: `${GOOGLE}?ok=3` });
    expect(fourth.status).toBe(409);
    expect(await (await f.request("/external")).json()).toHaveLength(3);
  });

  it("names a calendar that can't be read and still returns the others", async () => {
    const f = await account();
    const apple = "https://p12-caldav.icloud.com/published/2/abc";
    let appleDown = false;
    serve({ [GOOGLE]: () => new Response(calendarFile("Google entry")), [apple]: () => appleDown ? new Response("Down", { status: 503 }) : new Response(calendarFile("Apple entry")) });
    for (const url of [GOOGLE, apple]) expect((await f.request("/external", "POST", { url })).status).toBe(201);
    appleDown = true;
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 6 * 60_000);
    const busy = await (await f.request("/busy?from=2028-08-01&to=2028-08-31")).json() as BusyResult;
    expect(busy.failed).toEqual(["apple"]);
    expect(busy.blocks.map(block => block.title)).toEqual(["Google entry"]);
  });

  it("gives the demo a sample calendar of the same shape", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    const { demoBackend } = await import("../../web/src/lib/demoBackend");
    const { irelandToday, addCalendarDays } = await import("@sorted/core");
    const today = irelandToday();
    expect(await demoBackend.externalCalendars()).toEqual([{ id: "demo-calendar", provider: "google", createdAt: expect.any(String) }]);
    const busy = await demoBackend.busy(today, addCalendarDays(today, 30));
    expect(busy.failed).toEqual([]);
    expect(busy.blocks.map(block => [block.title, block.allDay])).toEqual([["Dentist", false], ["Holiday", true]]);
    expect((await demoBackend.busy(addCalendarDays(today, 20), addCalendarDays(today, 40))).blocks).toEqual([]);
    await expect(demoBackend.addExternalCalendar(GOOGLE)).rejects.toThrow("Available when you sign in");
    vi.unstubAllGlobals();
  });
});
