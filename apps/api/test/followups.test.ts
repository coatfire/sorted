import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { addCalendarDays, calendarDaysBetween, CalendarDate, irelandToday, type Booking } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";

async function fixture() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const jwt = await issueJwt(user.id, user.sessionVersion);
  const request = (path: string, method = "POST", body: object = {}) => app.request(`/api/bookings${path}`, {
    method, headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const create = (extra: object = {}) => request("", "POST", {
    client: { name: "Enquiry client" }, service: "Makeup", start_at: new Date().toISOString(), price_cents: 8000, ...extra,
  });
  return { user, request, create };
}

describe("calendar date helpers", () => {
  it("adds calendar days across DST, months, years and leap days", () => {
    expect(addCalendarDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addCalendarDays("2026-12-31", 2)).toBe("2027-01-02");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(calendarDaysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(calendarDaysBetween("2026-10-26", "2026-10-24")).toBe(-2);
    expect(calendarDaysBetween("2026-10-26", "2026-10-26")).toBe(0);
    expect(irelandToday(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
  });
  it.each(["", "2026-02-29", "2026-04-31", "2026-13-01", "01/02/2026", "2026-01-01T12:00:00Z"])("rejects invalid dates: %s", (date) => {
    expect(CalendarDate.safeParse(date).success).toBe(false);
    expect(() => addCalendarDays(date, 2)).toThrow();
  });
});

describe("enquiry follow-ups and payment-request tracking", () => {
  it("defaults new enquiries to two days after today in Ireland; accepts dates and explicit null", async () => {
    const f = await fixture();
    const response = await f.create();
    expect(response.status).toBe(201);
    expect((await response.json() as Booking).followUpOn).toBe(addCalendarDays(irelandToday(), 2));
    expect((await (await f.create({ follow_up_on: "2026-12-20" })).json() as Booking).followUpOn).toBe("2026-12-20");
    expect((await (await f.create({ follow_up_on: null })).json() as Booking).followUpOn).toBeNull();
    expect((await f.create({ follow_up_on: "2026-02-30" })).status).toBe(400);
  });
  it("updates, preserves omitted dates, clears with null, and validates update dates", async () => {
    const f = await fixture();
    const booking = await (await f.create()).json() as Booking;
    const update = (body: object) => f.request(`/${booking.id}`, "PATCH", body);
    expect((await (await update({ follow_up_on: "2026-12-25" })).json() as Booking).followUpOn).toBe("2026-12-25");
    expect((await (await update({ notes: "Notes only" })).json() as Booking).followUpOn).toBe("2026-12-25");
    expect((await update({ follow_up_on: "2026-02-30" })).status).toBe(400);
    expect((await update({ follow_up_on: 123 })).status).toBe(400);
    expect((await (await update({ follow_up_on: null })).json() as Booking).followUpOn).toBeNull();
  });
  it.each(["confirm", "cancel"])("clears follow-up on %s and prevents rescheduling closed enquiries", async (action) => {
    const f = await fixture();
    const booking = await (await f.create()).json() as Booking;
    const response = await f.request(`/${booking.id}/${action}`);
    expect(response.status).toBe(200);
    expect((await response.json() as Booking).followUpOn).toBeNull();
    expect((await f.request(`/${booking.id}`, "PATCH", { follow_up_on: "2026-12-25" })).status).toBe(409);
  });
  it("records the time without claiming a message was sent, and never updates a foreign booking", async () => {
    const f = await fixture();
    const other = await fixture();
    const booking = await (await f.create()).json() as Booking;
    expect(booking.paymentRequestedAt).toBeNull();
    expect((await other.request(`/${booking.id}/payment-requested`)).status).toBe(404);
    expect((await other.request(`/${booking.id}`, "PATCH", { follow_up_on: null })).status).toBe(404);
    const before = Date.now();
    const response = await f.request(`/${booking.id}/payment-requested`);
    expect(response.status).toBe(200);
    const result = await response.json() as Booking;
    expect(Date.parse(result.paymentRequestedAt!)).toBeGreaterThanOrEqual(before);
    expect(result.status).toBe("enquiry");
    expect(await db.select().from(schema.messageLog).where(eq(schema.messageLog.bookingId, booking.id))).toHaveLength(0);
    expect((await f.request(`/${crypto.randomUUID()}/payment-requested`)).status).toBe(404);
    expect((await app.request(`/api/bookings/${booking.id}/payment-requested`, { method: "POST" })).status).toBe(401);
  });
});
