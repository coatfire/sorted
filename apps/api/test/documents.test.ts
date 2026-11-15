import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { BookingDocument } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const [client] = await db.insert(schema.clients).values({ userId: user.id, name: "Document client" }).returning();
  const booking = async () => (await db.insert(schema.bookings).values({
    userId: user.id, clientId: client.id, service: "Makeup", startAt: new Date(), priceCents: 12000, depositCents: 2000,
  }).returning())[0];
  const jwt = await issueJwt(user.id, user.sessionVersion);
  const request = (id: string, body: object) => app.request(`/api/bookings/${id}/documents`, {
    method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body),
  });
  return { user, client, booking, request };
}

describe("booking document numbering", () => {
  it("persists, validates and clears user-scoped invoice settings", async () => {
    const first = await fixture();
    const second = await fixture();
    const jwt = await issueJwt(first.user.id, first.user.sessionVersion);
    const patch = (body: object) => app.request("/api/auth/me", {
      method: "PATCH", headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body),
    });
    const saved = await patch({ invoice_accent: "#abc", invoice_footer: "Thank you!\nSee you soon.", vat_number: "ie 1234567 ab" });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ invoiceAccent: "#AABBCC", invoiceFooter: "Thank you!\nSee you soon.", vatNumber: "IE1234567AB" });
    const [other] = await db.select().from(schema.users).where(eq(schema.users.id, second.user.id));
    expect(other).toMatchObject({ invoiceAccent: null, invoiceFooter: null, vatNumber: null });
    expect((await patch({ vat_number: "invalid" })).status).toBe(400);
    expect((await patch({ invoice_logo: "data:image/svg+xml;base64,AAAA" })).status).toBe(400);
    expect(await (await patch({ invoice_logo: null, invoice_accent: null, invoice_footer: null, vat_number: null })).json())
      .toMatchObject({ invoiceLogo: null, invoiceAccent: null, invoiceFooter: null, vatNumber: null });
  });

  it("reuses a stable number and issue date and has separate invoice/receipt sequences", async () => {
    const f = await fixture();
    const b = await f.booking();
    const first = await f.request(b.id, { kind: "invoice" });
    expect(first.status).toBe(200);
    const document = await first.json() as BookingDocument;
    expect(document.number).toBe(1);
    expect(await (await f.request(b.id, { kind: "invoice" })).json()).toEqual(document);
    await db.insert(schema.payments).values({ userId: f.user.id, bookingId: b.id, kind: "deposit", status: "paid", amountCents: 2000 });
    const receipt = await (await f.request(b.id, { kind: "receipt" })).json() as BookingDocument;
    expect(receipt).toMatchObject({ kind: "receipt", number: 1 });
    expect(receipt.id).not.toBe(document.id);
    expect((await (await f.request((await f.booking()).id, { kind: "invoice" })).json() as BookingDocument).number).toBe(2);
  });

  it("handles concurrent requests for the same booking and different bookings without duplicate numbers", async () => {
    const f = await fixture();
    const one = await f.booking();
    const same = await Promise.all(Array.from({ length: 4 }, () => f.request(one.id, { kind: "invoice" })));
    expect(same.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    const documents = await Promise.all(same.map((response) => response.json() as Promise<BookingDocument>));
    expect(new Set(documents.map((document) => document.id)).size).toBe(1);
    const bookings = await Promise.all([f.booking(), f.booking()]);
    const other = await Promise.all(bookings.map((booking) => f.request(booking.id, { kind: "invoice" })));
    expect(other.map((response) => response.status)).toEqual([200, 200]);
    const numbers = await Promise.all(other.map(async (response) => (await response.json() as BookingDocument).number));
    expect(numbers.sort()).toEqual([2, 3]);
  });

  it.each([false, true])("retries a rolled-back unique conflict (nested: %s)", async (nested) => {
    const f = await fixture();
    const b = await f.booking();
    const conflict = nested ? new Error("Unique conflict", { cause: { code: "23505" } }) : Object.assign(new Error("Unique conflict"), { code: "23505" });
    const transaction = vi.spyOn(db, "transaction").mockRejectedValueOnce(conflict);
    const response = await f.request(b.id, { kind: "invoice" });
    expect(response.status).toBe(200);
    expect((await response.json() as BookingDocument).number).toBe(1);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("bounds conflict retries and does not retry unrelated database failures", async () => {
    const f = await fixture();
    const b = await f.booking();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const transaction = vi.spyOn(db, "transaction").mockRejectedValue(Object.assign(new Error("Unique conflict"), { code: "23505" }));
    expect((await f.request(b.id, { kind: "invoice" })).status).toBe(500);
    expect(transaction).toHaveBeenCalledTimes(3);
    transaction.mockClear().mockRejectedValue(new Error("Database unavailable"));
    expect((await f.request(b.id, { kind: "invoice" })).status).toBe(500);
    expect(transaction).toHaveBeenCalledOnce();
  });

  it("requires a paid payment owned by this user and validates document kinds", async () => {
    const f = await fixture();
    const other = await fixture();
    const b = await f.booking();
    await db.insert(schema.payments).values([
      { userId: f.user.id, bookingId: b.id, kind: "deposit", status: "pending", amountCents: 2000 },
      { userId: other.user.id, bookingId: b.id, kind: "deposit", status: "paid", amountCents: 2000 },
    ]);
    expect((await f.request(b.id, { kind: "receipt" })).status).toBe(400);
    expect((await f.request(b.id, { kind: "invalid" })).status).toBe(400);
    expect((await f.request(b.id, {})).status).toBe(400);
  });

  it("scopes booking lookup, number allocation and reuse to the current user", async () => {
    const first = await fixture();
    const second = await fixture();
    const b = await first.booking();
    await first.request(b.id, { kind: "invoice" });
    expect((await second.request(b.id, { kind: "invoice" })).status).toBe(404);
    expect((await second.request(crypto.randomUUID(), { kind: "invoice" })).status).toBe(404);
    const own = await second.request((await second.booking()).id, { kind: "invoice" });
    expect((await own.json() as BookingDocument).number).toBe(1);
  });

  it("keeps the allocation ledger after an unpaid booking is deleted so numbers are not reused", async () => {
    const f = await fixture();
    const b = await f.booking();
    await f.request(b.id, { kind: "invoice" });
    await db.delete(schema.bookings).where(and(eq(schema.bookings.id, b.id), eq(schema.bookings.userId, f.user.id)));
    expect((await (await f.request((await f.booking()).id, { kind: "invoice" })).json() as BookingDocument).number).toBe(2);
  });
});
