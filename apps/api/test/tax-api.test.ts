import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import type { BookingDocument, Expense, User } from "@sorted/core";

async function account() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const jwt = await issueJwt(user.id, user.sessionVersion);
  const request = (path: string, method = "GET", body?: object) => app.request(`/api${path}`, {
    method, headers: { Authorization: `Bearer ${jwt}` }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { user, request };
}

describe("VAT and tax persistence", () => {
  it("defaults safely, validates merged partial settings, supports zero/custom rates, and isolates users", async () => {
    const first = await account(); const other = await account();
    expect(await (await first.request("/auth/me")).json()).toMatchObject({ vatRegistered: false, vatRateBp: null, vatPeriodMonths: 2, incomeTaxRateBp: null });
    expect((await first.request("/auth/me", "PATCH", { vat_registered: true })).status).toBe(400);
    const saved = await first.request("/auth/me", "PATCH", { vat_registered: true, vat_rate_bp: 1337, vat_period_months: 4, income_tax_rate_bp: 2000 });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ vatRegistered: true, vatRateBp: 1337, vatPeriodMonths: 4, incomeTaxRateBp: 2000 });
    expect((await first.request("/auth/me", "PATCH", { vat_rate_bp: null })).status).toBe(400);
    for (const body of [{ vat_rate_bp: 3001 }, { vat_rate_bp: -1 }, { vat_rate_bp: 1.5 }, { vat_period_months: 3 }, { income_tax_rate_bp: 10001 }]) {
      expect((await first.request("/auth/me", "PATCH", body)).status).toBe(400);
    }
    expect((await first.request("/auth/me", "PATCH", { vat_rate_bp: 0, income_tax_rate_bp: 0 })).status).toBe(200);
    expect((await first.request("/auth/me", "PATCH", { vat_period_months: 12 })).status).toBe(200);
    const second = await (await other.request("/auth/me")).json() as User;
    expect(second).toMatchObject({ vatRegistered: false, vatRateBp: null, incomeTaxRateBp: null });
    expect((await first.request("/auth/me", "PATCH", { vat_registered: false, vat_rate_bp: null, income_tax_rate_bp: null })).status).toBe(200);
  });

  it("persists and exports reclaimable expense VAT with validation, clearing and tenant scoping", async () => {
    const first = await account(); const other = await account();
    const date = new Date().toISOString();
    const body = { merchant: "VAT supplies", amount_cents: 12300, vat_cents: 2300, expense_date: date, category: "materials", confirmed: true };
    const created = await first.request("/expenses", "POST", body);
    expect(created.status).toBe(201);
    const expense = await created.json() as Expense;
    expect(expense).toMatchObject({ amountCents: 12300, vatCents: 2300 });
    expect((await first.request("/expenses", "POST", { ...body, vat_cents: 12301 })).status).toBe(400);
    expect((await first.request(`/expenses/${expense.id}`, "PATCH", { ...body, amount_cents: 1000 })).status).toBe(400);
    expect((await other.request(`/expenses/${expense.id}`, "PATCH", body)).status).toBe(404);
    expect(await (await other.request("/expenses")).json()).toEqual([]);
    expect((await first.request(`/expenses/${expense.id}`, "PATCH", { ...body, amount_cents: 2460, vat_cents: 460 })).status).toBe(200);
    const year = new Date().getFullYear();
    const csv = await (await first.request(`/reports/export?year=${year}&format=csv`)).text();
    expect(csv).toContain('"has_receipt","vat_eur"');
    expect(csv).toContain('"24.60","no","4.60"');
    expect(await (await other.request(`/reports/export?year=${year}&format=csv`)).text()).not.toContain("VAT supplies");
    const cleared = await first.request(`/expenses/${expense.id}`, "PATCH", { ...body, vat_cents: null });
    expect(await cleared.json()).toMatchObject({ vatCents: null });
    expect((await first.request("/expenses", "POST", { ...body, vat_cents: 0 })).status).toBe(201);
  });

  it("freezes a receipt's VAT rate inside the issue transaction", async () => {
    const { user, request } = await account();
    await request("/auth/me", "PATCH", { vat_registered: true, vat_rate_bp: 2300 });
    const [client] = await db.insert(schema.clients).values({ userId: user.id, name: "VAT client" }).returning();
    const [booking] = await db.insert(schema.bookings).values({ userId: user.id, clientId: client.id, service: "Makeup", startAt: new Date(), priceCents: 12300 }).returning();
    const [payment] = await db.insert(schema.payments).values({ userId: user.id, bookingId: booking.id, kind: "full", amountCents: 12300, status: "paid" }).returning();
    const body = { kind: "receipt", payment_id: payment.id };
    const before = await (await request(`/bookings/${booking.id}/documents`, "POST", body)).json() as BookingDocument;
    expect(before.receiptSnapshot).toMatchObject({ vatRateBp: 2300 });
    await request("/auth/me", "PATCH", { vat_registered: false, vat_rate_bp: 900 });
    expect(await (await request(`/bookings/${booking.id}/documents`, "POST", body)).json()).toEqual(before);
  });
});
