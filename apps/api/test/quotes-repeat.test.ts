import { describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { addCalendarDays, irelandToday, bookAgainStart, bookingAtDublinTime, dublinDateTime, shiftDublinWeeks, type Booking, type BookingDocument } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";

async function fixture() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com`, vatRegistered: true, vatRateBp: 2300 }).returning();
  const jwt = await issueJwt(user.id, user.sessionVersion);
  const request = (path: string, body: object) => app.request(`/api/bookings${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body),
  });
  const create = (extra: object = {}) => request("", {
    client: { name: "Quote client" }, service: "Makeup", price_cents: 12300, deposit_cents: 2000,
    start_at: "2026-10-18T09:00:00Z", end_at: "2026-10-18T10:30:00Z", ...extra,
  });
  const rows = () => db.select().from(schema.bookings).where(eq(schema.bookings.userId, user.id)).orderBy(schema.bookings.startAt);
  return { user, request, create, rows };
}

describe("Dublin repeat dates", () => {
  it.each(["2026-10-25T00:30:12.123Z", "2026-10-25T01:30:12.123Z"])("preserves the original autumn instant %s when editing without changing the date or time", (original) => {
    const fields = dublinDateTime(original);
    expect(fields).toEqual({ date: "2026-10-25", time: "01:30" });
    expect(bookingAtDublinTime(fields.date, fields.time, original).toISOString()).toBe(original);
    expect(bookingAtDublinTime(fields.date, "02:30", original).toISOString()).toBe("2026-10-25T02:30:00.000Z");
    expect(bookingAtDublinTime("2026-10-26", fields.time, original).toISOString()).toBe("2026-10-26T01:30:00.000Z");
  });
  it("keeps the wall clock through autumn and spring, including seconds", () => {
    expect(shiftDublinWeeks("2026-10-18T09:00:12.123Z", 1).toISOString()).toBe("2026-10-25T10:00:12.123Z");
    expect(shiftDublinWeeks("2026-03-22T10:00:00Z", 1).toISOString()).toBe("2026-03-29T09:00:00.000Z");
    expect(shiftDublinWeeks("2026-10-18T09:00:00Z", 0).toISOString()).toBe("2026-10-18T09:00:00.000Z");
    expect(dublinDateTime("2026-07-01T23:30:00Z")).toEqual({ date: "2026-07-02", time: "00:30" });
    expect(bookingAtDublinTime("2026-07-02", "10:00").toISOString()).toBe("2026-07-02T09:00:00.000Z");
  });
  it("moves a missing spring hour forward and keeps the earlier autumn occurrence when repeating summer time", () => {
    expect(shiftDublinWeeks("2026-03-22T01:30:00Z", 1).toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(dublinDateTime(shiftDublinWeeks("2026-03-22T01:30:00Z", 1)).time).toBe("02:30");
    expect(shiftDublinWeeks("2026-10-18T00:30:00Z", 1).toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
  it("books again after the later of the original date or today, with the same weekday and Dublin time", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    expect(bookAgainStart("2026-10-18T09:00:00Z", 1, now).toISOString()).toBe("2026-11-01T10:00:00.000Z");
    expect(bookAgainStart("2026-11-01T10:00:00Z", 2, now).toISOString()).toBe("2026-11-15T10:00:00.000Z");
    expect(bookAgainStart("2026-10-20T09:00:00Z", 1, now).toISOString()).toBe("2026-10-27T10:00:00.000Z");
    for (const weeks of [1, 2, 4, 6]) {
      expect(dublinDateTime(bookAgainStart("2026-10-18T09:00:00Z", weeks, now)).time).toBe("10:00");
    }
  });
  it("rejects invalid dates, times and week intervals", () => {
    expect(() => bookingAtDublinTime("2026-02-30", "10:00")).toThrow();
    expect(() => bookingAtDublinTime("2026-02-20", "25:00")).toThrow();
    expect(() => shiftDublinWeeks("invalid", 1)).toThrow();
    expect(() => shiftDublinWeeks("2026-01-01", 1.5)).toThrow();
    expect(() => bookAgainStart("2026-01-01", 0)).toThrow();
  });
});

describe("quote documents", () => {
  it("reuses one quote number and issue time, with independent per-user sequences and conflict protection", async () => {
    const f = await fixture(), other = await fixture();
    const b = await (await f.create()).json() as Booking;
    const responses = await Promise.all([f.request(`/${b.id}/documents`, { kind: "quote" }), f.request(`/${b.id}/documents`, { kind: "quote" })]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    const quote = await responses[0].json() as BookingDocument;
    expect(await responses[1].json()).toEqual(quote);
    expect(quote).toMatchObject({ kind: "quote", number: 1, vatRateBp: 2300, paymentId: null });
    const second = await (await f.create()).json() as Booking;
    expect((await (await f.request(`/${second.id}/documents`, { kind: "quote" })).json() as BookingDocument).number).toBe(2);
    expect((await (await f.request(`/${b.id}/documents`, { kind: "invoice" })).json() as BookingDocument).number).toBe(1);
    const own = await (await other.create()).json() as Booking;
    expect((await (await other.request(`/${own.id}/documents`, { kind: "quote" })).json() as BookingDocument).number).toBe(1);
    expect((await other.request(`/${b.id}/documents`, { kind: "quote" })).status).toBe(404);
    await expect(db.insert(schema.invoices).values({ userId: f.user.id, bookingId: b.id, kind: "quote", number: 99 })).rejects.toThrow();
  });
  it.each(["confirmed", "completed", "cancelled"] as const)("rejects quotes for %s bookings even when a quote was issued before", async (status) => {
    const f = await fixture();
    const b = await (await f.create()).json() as Booking;
    await f.request(`/${b.id}/documents`, { kind: "quote" });
    await db.update(schema.bookings).set({ status }).where(and(eq(schema.bookings.id, b.id), eq(schema.bookings.userId, f.user.id)));
    expect((await f.request(`/${b.id}/documents`, { kind: "quote" })).status).toBe(409);
  });
});

describe("repeat enquiries", () => {
  it("preserves a 01:30–02:00 booking's duration when the spring clock gap moves its repeated start to 02:30", async () => {
    const f = await fixture();
    const response = await f.create({ start_at: "2026-03-22T01:30:00Z", end_at: "2026-03-22T02:00:00Z", repeat: { every_weeks: 1, count: 2 } });
    expect(response.status).toBe(201);
    const rows = await f.rows();
    expect(rows.map((row) => row.startAt?.toISOString())).toEqual(["2026-03-22T01:30:00.000Z", "2026-03-29T01:30:00.000Z"]);
    expect(rows.map((row) => row.endAt?.toISOString())).toEqual(["2026-03-22T02:00:00.000Z", "2026-03-29T02:00:00.000Z"]);
    expect(dublinDateTime(rows[1].startAt!).time).toBe("02:30");
    expect(dublinDateTime(rows[1].endAt!).time).toBe("03:00");
    expect(rows.every((row) => row.endAt!.getTime() - row.startAt!.getTime() === 30 * 60000)).toBe(true);
  });
  it("creates a series atomically across October DST, shifting end times and following up only on the first", async () => {
    const f = await fixture();
    const response = await f.create({ repeat: { every_weeks: 1, count: 3 } });
    expect(response.status).toBe(201);
    const first = await response.json() as Booking & { seriesCount: number };
    expect(first.seriesCount).toBe(3);
    const rows = await f.rows();
    expect(rows.map((row) => row.startAt?.toISOString())).toEqual(["2026-10-18T09:00:00.000Z", "2026-10-25T10:00:00.000Z", "2026-11-01T10:00:00.000Z"]);
    expect(rows.map((row) => row.endAt?.toISOString())).toEqual(["2026-10-18T10:30:00.000Z", "2026-10-25T11:30:00.000Z", "2026-11-01T11:30:00.000Z"]);
    expect(rows.map((row) => row.followUpOn)).toEqual([addCalendarDays(irelandToday(), 2), null, null]);
    expect(rows.every((row) => row.status === "enquiry" && row.clientId === first.clientId && row.priceCents === 12300 && row.depositCents === 2000)).toBe(true);
    expect(rows[0].id).toBe(first.id);
    expect(await db.select().from(schema.clients).where(eq(schema.clients.userId, f.user.id))).toHaveLength(1);
  });
  it.each([2, 4] as const)("supports every %i weeks, explicit first follow-up and the maximum count", async (every_weeks) => {
    const f = await fixture();
    const response = await f.create({ repeat: { every_weeks, count: 12 }, follow_up_on: "2026-10-19" });
    expect(response.status).toBe(201);
    const rows = await f.rows();
    expect(rows).toHaveLength(12);
    expect(rows[1].startAt).toEqual(shiftDublinWeeks(rows[0].startAt!, every_weeks));
    expect(rows.map((row) => row.followUpOn)).toEqual(["2026-10-19", ...Array<string | null>(11).fill(null)]);
  });
  it("keeps the single-booking response compatible, supports null follow-up and a tenant-owned client", async () => {
    const f = await fixture(), other = await fixture();
    const first = await (await f.create({ follow_up_on: null })).json() as Booking & { seriesCount: number };
    expect(first).toMatchObject({ seriesCount: 1, status: "enquiry", followUpOn: null });
    expect((await other.create({ client: undefined, client_id: first.clientId, repeat: { every_weeks: 1, count: 2 } })).status).toBe(404);
    expect(await other.rows()).toHaveLength(0);
    expect((await f.create({ client: undefined, client_id: first.clientId, repeat: { every_weeks: 1, count: 2 } })).status).toBe(201);
  });
  it.each([{ every_weeks: 0, count: 2 }, { every_weeks: 3, count: 2 }, { every_weeks: 1, count: 1 }, { every_weeks: 1, count: 13 }, { every_weeks: 1, count: 2.5 }, { every_weeks: 1 }, {}])("rejects invalid repeat bounds without creating data: %j", async (repeat) => {
    const f = await fixture();
    expect((await f.create({ repeat })).status).toBe(400);
    expect(await f.rows()).toHaveLength(0);
    expect(await db.select().from(schema.clients).where(eq(schema.clients.userId, f.user.id))).toHaveLength(0);
  });
  it("rolls back the inline client if inserting the series fails", async () => {
    const f = await fixture();
    await db.execute(sql`CREATE FUNCTION reject_repeat_for_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.service = 'Fail repeat atomically' AND NEW.start_at > '2026-10-20'::timestamptz THEN
          RAISE EXCEPTION 'Test series insert failure';
        END IF;
        RETURN NEW;
      END;
    $$`);
    await db.execute(sql`CREATE TRIGGER reject_repeat_for_test BEFORE INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION reject_repeat_for_test()`);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await f.create({ service: "Fail repeat atomically", repeat: { every_weeks: 1, count: 2 } })).status).toBe(500);
      expect(await f.rows()).toHaveLength(0);
      expect(await db.select().from(schema.clients).where(eq(schema.clients.userId, f.user.id))).toHaveLength(0);
    } finally {
      spy.mockRestore();
      await db.execute(sql`DROP TRIGGER reject_repeat_for_test ON bookings`);
      await db.execute(sql`DROP FUNCTION reject_repeat_for_test()`);
    }
  });
});
