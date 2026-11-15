import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { addCalendarDays, irelandToday, type Booking } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import { createActionGuard } from "../../web/src/lib/action";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function fixture() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const headers = { Authorization: `Bearer ${await issueJwt(user.id, user.sessionVersion)}` };
  const create = (extra: object = {}) => app.request("/api/bookings", { method: "POST", headers, body: JSON.stringify({
    client: { name: "Áine Murphy", phone: "+353871234567" }, service: "Gel nails", price_cents: 6000, deposit_cents: 2000,
    start_at: "2026-10-18T09:00:00Z", ...extra,
  }) });
  return { user, headers, create };
}

describe("appointment-first creation", () => {
  it("atomically creates a confirmed appointment and pending deposit, without follow-up or sending anything", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "https://automation.example.com");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const f = await fixture();
    const response = await f.create({ status: "confirmed", follow_up_on: "2026-11-20" });
    expect(response.status).toBe(201);
    const booking = await response.json() as Booking;
    expect(booking).toMatchObject({ status: "confirmed", followUpOn: null, depositCents: 2000 });
    const payments = await db.select().from(schema.payments).where(eq(schema.payments.userId, f.user.id));
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ bookingId: booking.id, kind: "deposit", status: "pending", amountCents: 2000, paidAt: null, method: null });
    expect(await db.select().from(schema.messageLog).where(eq(schema.messageLog.userId, f.user.id))).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("confirms every repeat occurrence with its own pending deposit and no follow-up across the Dublin clock change", async () => {
    const f = await fixture();
    const response = await f.create({ status: "confirmed", repeat: { every_weeks: 1, count: 3 } });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: "confirmed", seriesCount: 3 });
    const rows = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, f.user.id)).orderBy(schema.bookings.startAt);
    expect(rows.map(row => row.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
    expect(rows.map(row => row.followUpOn)).toEqual([null, null, null]);
    expect(rows.map(row => row.startAt.toISOString())).toEqual(["2026-10-18T09:00:00.000Z", "2026-10-25T10:00:00.000Z", "2026-11-01T10:00:00.000Z"]);
    const payments = await db.select().from(schema.payments).where(eq(schema.payments.userId, f.user.id));
    expect(payments).toHaveLength(3);
    expect(new Set(payments.map(payment => payment.bookingId))).toEqual(new Set(rows.map(row => row.id)));
    expect(payments.every(payment => payment.kind === "deposit" && payment.amountCents === 2000 && payment.status === "pending")).toBe(true);
    expect(await db.select().from(schema.clients).where(eq(schema.clients.userId, f.user.id))).toHaveLength(1);
  });

  it("does not create a payment for a confirmed appointment without a deposit", async () => {
    const f = await fixture();
    expect((await f.create({ status: "confirmed", deposit_cents: 0 })).status).toBe(201);
    expect(await db.select().from(schema.payments).where(eq(schema.payments.userId, f.user.id))).toEqual([]);
  });

  it.each([{}, { status: "enquiry" }])("keeps the two-day enquiry default and creates no deposit payment for %j", async extra => {
    const f = await fixture();
    const response = await f.create(extra);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: "enquiry", followUpOn: addCalendarDays(irelandToday(), 2) });
    expect(await db.select().from(schema.payments).where(eq(schema.payments.userId, f.user.id))).toEqual([]);
  });

  it.each(["completed", "cancelled", "", null])("rejects unsupported initial status %j without creating rows", async status => {
    const f = await fixture();
    expect((await f.create({ status })).status).toBe(400);
    expect(await db.select().from(schema.bookings).where(eq(schema.bookings.userId, f.user.id))).toEqual([]);
  });

  it("rolls back the client, all confirmed repeats and deposits together", async () => {
    const f = await fixture();
    const transaction = db.transaction.bind(db);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(db, "transaction").mockImplementationOnce((work, config) => transaction(async tx => {
      await work(tx);
      throw new Error("Simulated failure after deposit insertion");
    }, config));
    expect((await f.create({ status: "confirmed", repeat: { every_weeks: 1, count: 3 } })).status).toBe(500);
    expect(await db.select().from(schema.clients).where(eq(schema.clients.userId, f.user.id))).toEqual([]);
    expect(await db.select().from(schema.bookings).where(eq(schema.bookings.userId, f.user.id))).toEqual([]);
    expect(await db.select().from(schema.payments).where(eq(schema.payments.userId, f.user.id))).toEqual([]);
  });

  it("does not double-create a confirmed booking or deposit when a committed save cannot reload", async () => {
    const f = await fixture();
    const run = createActionGuard();
    const create = vi.fn(async () => { expect((await f.create({ status: "confirmed" })).status).toBe(201); });
    const reload = vi.fn(async () => { throw new Error("Offline"); });
    await expect(run(create, reload, vi.fn())).rejects.toThrow("Saved, but the screen couldn't update");
    await expect(run(create, reload, vi.fn())).rejects.toThrow("Reload before recording anything else");
    expect(create).toHaveBeenCalledOnce();
    expect(await db.select().from(schema.bookings).where(eq(schema.bookings.userId, f.user.id))).toHaveLength(1);
    expect(await db.select().from(schema.payments).where(eq(schema.payments.userId, f.user.id))).toHaveLength(1);
  });
});
