import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { irelandToday, paymentPaidAt, RecordPaymentInput, type BookingDocument, type Payment } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import { completeAction } from "../../web/src/lib/action";

afterEach(() => { vi.useRealTimers(); });

async function fixture(status: "confirmed" | "completed" | "cancelled" | "enquiry" = "confirmed") {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com`, vatRegistered: true, vatRateBp: 2300 }).returning();
  const [client] = await db.insert(schema.clients).values({ userId: user.id, name: "Instalment client" }).returning();
  const [booking] = await db.insert(schema.bookings).values({ userId: user.id, clientId: client.id, status, service: "Service", startAt: new Date(), priceCents: 10000, depositCents: 2000 }).returning();
  const [deposit] = await db.insert(schema.payments).values({ userId: user.id, bookingId: booking.id, kind: "deposit", amountCents: 2000 }).returning();
  const jwt = await issueJwt(user.id, user.sessionVersion);
  const request = (path: string, body: object) => app.request(`/api${path}`, { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) });
  const record = (amount = 3000, extra: object = {}) => request(`/bookings/${booking.id}/payments`, { amount_cents: amount, method: "bank_transfer", ...extra });
  const payments = () => db.select().from(schema.payments).where(and(eq(schema.payments.userId, user.id), eq(schema.payments.bookingId, booking.id)));
  return { user, booking, deposit, record, request, payments };
}

describe("record instalment payments", () => {
  it.each([true, false])("settles Money's full owed amount once, with pending deposit present: %s", async pending => {
    const f = await fixture("confirmed");
    if (!pending) await db.delete(schema.payments).where(eq(schema.payments.id, f.deposit.id));
    expect((await f.record(10000, { method: "revolut" })).status).toBe(201);
    const rows = await f.payments();
    expect(rows.filter(row => row.status === "paid").reduce((sum, row) => sum + row.amountCents, 0)).toBe(10000);
    expect(rows.filter(row => row.status === "pending")).toHaveLength(0);
    if (pending) expect(rows.find(row => row.id === f.deposit.id)?.status).toBe("cancelled");
    expect((await f.record(10000)).status).toBe(400);
    expect((await f.payments()).filter(row => row.status === "paid")).toHaveLength(1);
  });

  it("records the €55 cash balance on a completed €80 booking with a paid €25 deposit on 15 November", async () => {
    vi.setSystemTime(new Date("2026-11-15T14:00:00Z"));
    const f = await fixture("completed");
    await db.update(schema.bookings).set({ priceCents: 8000, depositCents: 2500, completedAt: new Date("2026-11-14T12:30:00Z") }).where(eq(schema.bookings.id, f.booking.id));
    await db.update(schema.payments).set({ amountCents: 2500, status: "paid", method: "bank_transfer", paidAt: new Date("2026-11-09T08:00:00Z") }).where(eq(schema.payments.id, f.deposit.id));
    await db.insert(schema.payments).values({ userId: f.user.id, bookingId: f.booking.id, kind: "balance", amountCents: 5500, createdAt: new Date("2026-11-14T12:30:00Z") });
    const response = await f.record(5500, { method: "cash", paid_on: "2026-11-15" });
    expect(response.status).toBe(201);
    const rows = await f.payments();
    expect(rows.filter(row => row.status === "paid").reduce((sum, row) => sum + row.amountCents, 0)).toBe(8000);
    expect(rows.filter(row => row.status === "pending")).toEqual([]);
  });

  it("reports a failed reload after the real payment handler commits, rather than treating it as success", async () => {
    const f = await fixture("completed");
    const saved = vi.fn();
    await expect(completeAction(async () => {
      expect((await f.record(3000)).status).toBe(201);
    }, async () => { throw new TypeError("Network unavailable"); }, saved)).rejects.toThrow("Saved, but the screen couldn't update");
    expect(saved).toHaveBeenCalledOnce();
    expect((await f.payments()).filter(row => row.status === "paid")).toMatchObject([{ amountCents: 3000 }]);
  });

  it("records a payment taken on a card terminal as card, which stays editable", async () => {
    const f = await fixture();
    const { payment } = await (await f.record(3000, { method: "card" })).json() as { payment: Payment };
    expect(payment).toMatchObject({ status: "paid", method: "card", amountCents: 3000 });
  });
  it.each(["cash", "bank_transfer", "revolut", "card"] as const)("marks an existing pending payment paid by %s", async method => {
    const f = await fixture();
    expect((await f.request(`/payments/${f.deposit.id}/mark-paid`, { method })).status).toBe(200);
    expect((await f.payments()).find(row => row.id === f.deposit.id)).toMatchObject({ status: "paid", method });
  });
  it("records multiple part payments, freezes VAT, cancels the deposit and gives each a stable receipt", async () => {
    const f = await fixture();
    const response = await f.record();
    expect(response.status).toBe(201);
    const { payment } = await response.json() as { payment: Payment };
    expect(payment).toMatchObject({ kind: "custom", status: "paid", amountCents: 3000, method: "bank_transfer", vatRateBp: 2300 });
    expect(irelandToday(new Date(payment.paidAt!))).toBe(irelandToday());
    expect((await f.payments()).find((row) => row.id === f.deposit.id)?.status).toBe("cancelled");
    expect((await f.payments()).filter((row) => row.status === "pending")).toHaveLength(0);
    const receipt = await (await f.request(`/bookings/${f.booking.id}/documents`, { kind: "receipt", payment_id: payment.id })).json() as BookingDocument;
    await db.update(schema.users).set({ vatRateBp: 900 }).where(eq(schema.users.id, f.user.id));
    const second = await (await f.record(2500, { method: "revolut", paid_on: "2026-07-01" })).json() as { payment: Payment };
    expect(second.payment).toMatchObject({ paidAt: "2026-07-01T11:00:00.000Z", vatRateBp: 900 });
    const rows = await f.payments();
    expect(f.booking.priceCents! - rows.filter((row) => row.status === "paid").reduce((sum, row) => sum + row.amountCents, 0)).toBe(4500);
    const repeated = await (await f.request(`/bookings/${f.booking.id}/documents`, { kind: "receipt", payment_id: payment.id })).json() as BookingDocument;
    expect(repeated).toEqual(receipt);
    const secondReceipt = await (await f.request(`/bookings/${f.booking.id}/documents`, { kind: "receipt", payment_id: second.payment.id })).json() as BookingDocument;
    expect(secondReceipt.number).not.toBe(receipt.number);
    expect(secondReceipt.receiptSnapshot?.vatRateBp).toBe(900);
  });

  it("rejects overpayment with the remaining amount and leaves rows unchanged", async () => {
    const f = await fixture();
    await f.record(3000);
    const before = await f.payments();
    const response = await f.record(7001);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "That's more than the €70.00 still owed." });
    expect(await f.payments()).toEqual(before);
  });

  it.each(["cancelled", "enquiry"] as const)("rejects %s bookings", async (status) => {
    const f = await fixture(status);
    expect((await f.record()).status).toBe(409);
    expect(await f.payments()).toHaveLength(1);
  });

  it("hides another user's booking", async () => {
    const owner = await fixture();
    const other = await fixture();
    expect((await other.request(`/bookings/${owner.booking.id}/payments`, { amount_cents: 1, method: "cash" })).status).toBe(404);
    expect(await owner.payments()).toHaveLength(1);
  });

  it("replaces pending rows with exactly the completed booking remainder, then clears it on full payment", async () => {
    const f = await fixture("completed");
    expect((await f.record(3000)).status).toBe(201);
    expect((await f.payments()).filter((row) => row.status === "pending")).toMatchObject([{ kind: "balance", amountCents: 7000 }]);
    expect((await f.record(7000)).status).toBe(201);
    expect((await f.payments()).filter((row) => row.status === "pending")).toEqual([]);
    expect((await f.record(1)).status).toBe(400);
  });

  it("uses zero VAT while unregistered", async () => {
    const f = await fixture();
    await db.update(schema.users).set({ vatRegistered: false }).where(eq(schema.users.id, f.user.id));
    const response = await f.record();
    expect((await response.json() as { payment: Payment }).payment.vatRateBp).toBe(0);
  });

  it("preserves the earliest cancelled pending debt's age across part payments", async () => {
    const f = await fixture("completed");
    const oldest = new Date("2026-01-10T12:00:00Z");
    await db.update(schema.payments).set({ createdAt: new Date("2026-02-10T12:00:00Z") })
      .where(and(eq(schema.payments.id, f.deposit.id), eq(schema.payments.userId, f.user.id)));
    await db.insert(schema.payments).values([
      { userId: f.user.id, bookingId: f.booking.id, kind: "balance", amountCents: 8000, createdAt: oldest },
      { userId: f.user.id, bookingId: f.booking.id, kind: "balance", amountCents: 10000, status: "cancelled", createdAt: new Date("2025-12-01T12:00:00Z") },
    ]);
    for (const remainder of [7000, 4000]) {
      expect((await f.record(3000)).status).toBe(201);
      expect((await f.payments()).filter((row) => row.status === "pending"))
        .toMatchObject([{ kind: "balance", amountCents: remainder, createdAt: oldest }]);
    }
  });

  it("uses completion time for a replacement balance when no pending row exists", async () => {
    const f = await fixture("completed");
    const completedAt = new Date("2026-01-10T12:00:00Z");
    await db.update(schema.bookings).set({ completedAt }).where(and(eq(schema.bookings.id, f.booking.id), eq(schema.bookings.userId, f.user.id)));
    await db.update(schema.payments).set({ status: "cancelled" }).where(and(eq(schema.payments.id, f.deposit.id), eq(schema.payments.userId, f.user.id)));
    expect((await f.record(3000)).status).toBe(201);
    expect((await f.payments()).filter((row) => row.status === "pending"))
      .toMatchObject([{ kind: "balance", amountCents: 7000, createdAt: completedAt }]);
  });

  it("serialises competing instalments against the remaining balance", async () => {
    const f = await fixture();
    const responses = await Promise.all([f.record(6000), f.record(6000)]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 400]);
    expect((await f.payments()).filter((row) => row.status === "paid")).toHaveLength(1);
  });

  it("does not overpay when an existing deposit is marked paid concurrently", async () => {
    const f = await fixture();
    const [recorded, marked] = await Promise.all([
      f.record(9000), f.request(`/payments/${f.deposit.id}/mark-paid`, { method: "cash" }),
    ]);
    expect([[201, 409], [400, 200]]).toContainEqual([recorded.status, marked.status]);
    expect((await f.payments()).filter((row) => row.status === "paid").reduce((sum, row) => sum + row.amountCents, 0)).toBeLessThanOrEqual(10000);
  });

  it.each([{ paid_on: "2099-01-01" }, { paid_on: "2026-02-30" }, { paid_on: "" }, { method: "stripe" }, { amount_cents: 0 }, { amount_cents: 0.5 }])("rejects invalid input %j without changing payments", async (extra) => {
    const f = await fixture();
    expect((await f.record(100, extra)).status).toBe(400);
    expect(await f.payments()).toHaveLength(1);
  });
});

describe("Irish payment dates", () => {
  it("defaults to Ireland's today and uses now for an explicit today", () => {
    const now = new Date("2026-07-01T23:30:00Z");
    expect(irelandToday(now)).toBe("2026-07-02");
    expect(paymentPaidAt(undefined, now)).toEqual(now);
    expect(paymentPaidAt("2026-07-02", now)).toEqual(now);
  });
  it.each([["2026-01-01", "12"], ["2026-07-01", "11"], ["2026-03-29", "11"], ["2026-10-25", "12"]])("uses Dublin noon for %s", (date, hour) => {
    expect(paymentPaidAt(date, new Date("2026-12-01")).toISOString()).toBe(`${date}T${hour}:00:00.000Z`);
  });
  it("rejects impossible dates and future dates", () => {
    expect(() => paymentPaidAt("2026-02-30")).toThrow();
    expect(() => paymentPaidAt("2026-07-03", new Date("2026-07-01"))).toThrow("future");
    expect(RecordPaymentInput.safeParse({ amount_cents: 1, method: "cash" }).success).toBe(true);
    expect(RecordPaymentInput.safeParse({ amount_cents: 1, method: "card" }).success).toBe(true);
  });
});
