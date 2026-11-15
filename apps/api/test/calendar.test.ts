import { describe, expect, it } from "vitest";
import { buildCalendar, calendarEvent, googleCalendarEventUrl, type CalendarBooking, type CalendarLinks } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";

const booking: CalendarBooking = {
  id: "booking-1", status: "confirmed", startAt: "2026-07-01T10:00:00+01:00", endAt: null,
  service: "Hair", location: "Dublin", priceCents: 12300, client: { name: "Aoife", phone: "+353861234567" },
};
const appUrl = "https://sorted.example";
const now = new Date("2026-01-01T12:34:56Z");
const unfold = (text: string) => text.replace(/\r\n /g, "");

describe("calendar files", () => {
  it("builds a UTC calendar with stable identities, refresh hints and default duration", () => {
    const content = buildCalendar({ bookings: [booking], name: "Sorted – Confirmed", appUrl, now });
    expect(content).toContain("X-WR-CALNAME:Sorted – Confirmed\r\n");
    expect(content).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT15M\r\nX-PUBLISHED-TTL:PT15M");
    expect(content).toContain("UID:booking-1@sorted\r\nDTSTAMP:20260101T123456Z\r\nDTSTART:20260701T090000Z\r\nDTEND:20260701T100000Z");
    expect(content).toContain("SUMMARY:✓ Aoife · Hair\r\n");
    expect(unfold(content)).toContain("DESCRIPTION:+353861234567\\n€123.00\\nhttps://sorted.example/bookings/booking-1");
    expect(content).toContain("STATUS:CONFIRMED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n");
    expect(content.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(buildCalendar({ bookings: [booking], name: "Sorted", appUrl, now: new Date("2026-02-01") })).toContain("UID:booking-1@sorted");
  });
  it("escapes text and folds at 75 UTF-8 octets without damaging multibyte characters", () => {
    const service = "✓é💚".repeat(35) + "\\ ; ,\r\nsecond\rthird\nfourth";
    const content = buildCalendar({ bookings: [{ ...booking, service }], name: "Sorted", appUrl, now });
    for (const line of content.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(content).toContain("\r\n ");
    expect(unfold(content)).toContain(`SUMMARY:✓ Aoife · ${"✓é💚".repeat(35)}\\\\ \\; \\,\\nsecond\\nthird\\nfourth\r\n`);
    expect(content).not.toContain("�");
  });
  it("uses explicit end times, tentative enquiries and confirmed completed events", () => {
    expect(calendarEvent({ ...booking, status: "enquiry", endAt: "2026-07-01T13:00:00+01:00", client: { name: "Aoife", phone: null } }, appUrl))
      .toMatchObject({ title: "? Aoife · Hair (follow up)", end: "20260701T120000Z", status: "TENTATIVE", description: "€123.00\nhttps://sorted.example/bookings/booking-1" });
    expect(calendarEvent({ ...booking, status: "completed" }, appUrl).status).toBe("CONFIRMED");
    const empty = buildCalendar({ bookings: [{ ...booking, status: "cancelled" }], name: "Sorted", appUrl, now });
    expect(empty).not.toContain("BEGIN:VEVENT");
    expect(buildCalendar({ bookings: [], name: "Sorted", appUrl, now })).toBe(empty);
  });
  it("builds a matching Google template with encoded text, times, details and location", () => {
    const url = new URL(googleCalendarEventUrl({ ...booking, location: "A & B, Dublin" }, appUrl));
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("✓ Aoife · Hair");
    expect(url.searchParams.get("dates")).toBe("20260701T090000Z/20260701T100000Z");
    expect(url.searchParams.get("details")).toContain(`${appUrl}/bookings/booking-1`);
    expect(url.searchParams.get("location")).toBe("A & B, Dublin");
  });
});

process.env.APP_URL = "https://sorted.example";

async function account() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const [client] = await db.insert(schema.clients).values({ userId: user.id, name: `Client ${user.id}`, phone: "+353861234567" }).returning();
  const jwt = await issueJwt(user.id, user.sessionVersion);
  const request = (path = "/calendar", method = "GET") => app.request(`https://api.sorted.example/api${path}`, { method, headers: { Authorization: `Bearer ${jwt}` } });
  const add = async (status: "enquiry" | "confirmed" | "completed" | "cancelled", days = 1) => (await db.insert(schema.bookings).values({
    userId: user.id, clientId: client.id, service: `Service ${status}`, status,
    startAt: new Date(Date.now() + days * 86400000), priceCents: 12300, location: "Dublin",
  }).returning())[0];
  return { user, client, request, add };
}

describe("calendar subscriptions", () => {
  it("requires a session, lazily creates stable URLs, and provides both link formats and Google", async () => {
    expect((await app.request("/api/calendar")).status).toBe(401);
    expect((await app.request("/api/calendar/reset", { method: "POST" })).status).toBe(401);
    const f = await account();
    const responses = await Promise.all([f.request(), f.request()]);
    const links = await responses[0].json() as CalendarLinks;
    expect(await responses[1].json()).toEqual(links);
    expect(responses[0].headers.get("cache-control")).toBe("no-store");
    expect(links.confirmed.https).toMatch(/^https:\/\/sorted.example\/api\/calendar\/[A-Za-z0-9_-]{43}\/confirmed\.ics$/);
    expect(links.enquiries.https.replace("enquiries.ics", "confirmed.ics")).toBe(links.confirmed.https);
    expect(links.confirmed.webcal).toBe(links.confirmed.https.replace("https:", "webcal:"));
    expect(new URL(links.confirmed.google).searchParams.get("cid")).toBe(links.confirmed.webcal);
    const me = await (await f.request("/auth/me")).json();
    expect(me).not.toHaveProperty("calendarToken");
  });
  it("serves only the user's in-window confirmed/completed bookings or enquiries, without auth", async () => {
    const f = await account(), other = await account();
    const confirmed = await f.add("confirmed"), completed = await f.add("completed"), enquiry = await f.add("enquiry");
    const cancelled = await f.add("cancelled"), old = await f.add("confirmed", -181), foreign = await other.add("confirmed");
    const links = await (await f.request()).json() as CalendarLinks;
    const response = await app.request(links.confirmed.https);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const content = unfold(await response.text());
    expect(content).toContain("X-WR-CALNAME:Sorted – Confirmed");
    for (const row of [confirmed, completed]) expect(content).toContain(`UID:${row.id}@sorted`);
    for (const row of [enquiry, cancelled, old, foreign]) expect(content).not.toContain(row.id);
    const enquiries = unfold(await (await app.request(links.enquiries.https)).text());
    expect(enquiries).toContain("X-WR-CALNAME:Sorted – Enquiries");
    expect(enquiries).toContain(`UID:${enquiry.id}@sorted`);
    expect(enquiries).toContain(`? ${f.client.name} · Service enquiry (follow up)`);
    for (const row of [confirmed, completed, cancelled, old, foreign]) expect(enquiries).not.toContain(row.id);
  });
  it("returns 404 for bad tokens and reset invalidates both old feeds", async () => {
    const f = await account();
    const old = await (await f.request()).json() as CalendarLinks;
    expect((await app.request("/api/calendar/bad/confirmed.ics")).status).toBe(404);
    expect((await app.request(old.confirmed.https.replace("confirmed.ics", "other.ics"))).status).toBe(404);
    const reset = await f.request("/calendar/reset", "POST");
    expect(reset.status).toBe(200);
    const links = await reset.json() as CalendarLinks;
    expect(links).not.toEqual(old);
    for (const kind of ["confirmed", "enquiries"] as const) {
      expect((await app.request(old[kind].https)).status).toBe(404);
      expect((await app.request(links[kind].https)).status).toBe(200);
    }
  });
});
