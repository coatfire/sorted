import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Services, UpdateUserInput, addCalendarDays, irelandToday } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import { bookingServiceChips, serviceChipPrice } from "../../web/src/lib/bookingServices";
import { demoBackend, resetDemo } from "../../web/src/lib/demoBackend";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("saved services", () => {
  it("trims names, accepts free services and normalises snake_case requests", () => {
    expect(Services.parse([{ name: "  Gel nails  ", priceCents: 3500 }, { name: "Consultation", priceCents: 0 }])).toEqual([{ name: "Gel nails", priceCents: 3500 }, { name: "Consultation", priceCents: 0 }]);
    expect(UpdateUserInput.parse({ services: [{ name: " Nails ", price_cents: 3500 }] }).services).toEqual([{ name: "Nails", priceCents: 3500 }]);
    expect(Services.parse([])).toEqual([]);
    expect(Services.parse(Array.from({ length: 30 }, (_, index) => ({ name: `Service ${index}`, priceCents: 3500 })))).toHaveLength(30);
    expect(UpdateUserInput.parse({}).services).toBeUndefined();
  });
  it.each([
    [{ name: "", priceCents: 3500 }], [{ name: "  ", priceCents: 3500 }], [{ name: "x".repeat(201), priceCents: 0 }],
    [{ name: "Nails", priceCents: -1 }], [{ name: "Nails", priceCents: 35.5 }], [{ name: "Nails", priceCents: 2_147_483_648 }],
    [{ name: "Nails", priceCents: "3500" }], [{ name: "Nails", priceCents: null }],
    [{ name: " Nails ", priceCents: 3500 }, { name: "NAILS", priceCents: 4000 }],
    Array.from({ length: 31 }, (_, index) => ({ name: `Service ${index}`, priceCents: 3500 })),
  ].map(services => ({ services })))("rejects invalid or duplicate service lists $services", ({ services }) => { expect(Services.safeParse(services).success).toBe(false); });

  it("persists only the signed-in account's catalogue, supports edits/removal, and preserves omissions", async () => {
    const [user, other] = await db.insert(schema.users).values([{ email: `${crypto.randomUUID()}@example.com` }, { email: `${crypto.randomUUID()}@example.com` }]).returning();
    const headers = { Authorization: `Bearer ${await issueJwt(user.id, user.sessionVersion)}` };
    const patch = (body: object) => app.request("/api/auth/me", { method: "PATCH", headers, body: JSON.stringify(body) });
    expect((await app.request("/api/auth/me", { method: "PATCH", body: JSON.stringify({ services: [] }) })).status).toBe(401);
    expect(await (await patch({ services: [{ name: " Nails ", price_cents: 3500 }] })).json()).toMatchObject({ services: [{ name: "Nails", priceCents: 3500 }] });
    expect(await (await patch({ business_name: "Studio" })).json()).toMatchObject({ services: [{ name: "Nails", priceCents: 3500 }] });
    expect((await patch({ services: [{ name: "Nails", price_cents: 3500 }, { name: "NAILS", price_cents: 4000 }] })).status).toBe(400);
    expect(await (await patch({ services: [{ name: "Gel nails", price_cents: 4000 }] })).json()).toMatchObject({ services: [{ name: "Gel nails", priceCents: 4000 }] });
    expect(await (await patch({ services: [] })).json()).toMatchObject({ services: [] });
    expect((await db.select().from(schema.users).where(eq(schema.users.id, other.id)))[0].services).toEqual([]);
  });
});

describe("service chips", () => {
  const saved = [{ name: "Gel nails", priceCents: 3500 }];
  const recent = [{ service: "gel NAILS", priceCents: 3000, createdAt: "2026-11-14T10:00:00Z" }, { service: "Blow-dry", priceCents: 4500, createdAt: "2026-11-15T10:00:00Z" }, { service: "Blow-dry", priceCents: 4000, createdAt: "2026-11-13T10:00:00Z" }];
  it("puts saved services first, then unique recent services with their newest price", () => {
    expect(bookingServiceChips(saved, recent)).toEqual([...saved, { name: "Blow-dry", priceCents: 4500 }]);
    expect(bookingServiceChips([], [])).toEqual([]);
    expect(bookingServiceChips([], recent)).toEqual([{ name: "Blow-dry", priceCents: 4500 }, { name: "gel NAILS", priceCents: 3000 }]);
    expect(bookingServiceChips(Array.from({ length: 30 }, (_, index) => ({ name: `Service ${index}`, priceCents: index })), recent)).toHaveLength(6);
  });
  it("fills empty prices and replaces chip-filled prices", () => {
    expect(serviceChipPrice("", false, saved[0])).toEqual({ price: "35", fromChip: true });
    expect(serviceChipPrice("  ", false, saved[0])).toEqual({ price: "35", fromChip: true });
    expect(serviceChipPrice("45.00", true, saved[0])).toEqual({ price: "35", fromChip: true });
  });
  it("never replaces manually typed or Book again-prefilled prices, including zero and a typed chip-equivalent value", () => {
    for (const price of ["60", "0", "35.00"]) expect(serviceChipPrice(price, false, saved[0])).toEqual({ price, fromChip: false });
  });
});

it("mirrors confirmed repeats, enquiry defaults and saved services in demo without simulated sending", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  resetDemo();
  const before = await demoBackend.load();
  const draft = { status: "confirmed" as const, clientId: before.clients[0].id, service: "Hair", startAt: "2026-11-18T10:00:00Z", priceCents: 8000, depositCents: 2500, location: null, notes: null, repeat: { everyWeeks: 1 as const, count: 3 } };
  const created = await demoBackend.createBooking(draft);
  const after = await demoBackend.load();
  expect(created.seriesCount).toBe(3);
  expect(after.bookings.slice(before.bookings.length).every(booking => booking.status === "confirmed" && booking.followUpOn === null)).toBe(true);
  expect(after.payments.length - before.payments.length).toBe(3);
  expect(await demoBackend.messages(created.id)).toEqual([]);
  const enquiry = await demoBackend.createBooking({ ...draft, status: "enquiry", repeat: undefined });
  expect((await demoBackend.load()).bookings.find(booking => booking.id === enquiry.id)).toMatchObject({ status: "enquiry", followUpOn: addCalendarDays(irelandToday(), 2) });
  await demoBackend.updateUser({ name: null, businessName: "Studio", phone: null, reviewLink: null, address: null, iban: null, bic: null, services: [{ name: " Nails ", priceCents: 3500 }] });
  expect((await demoBackend.load()).user.services).toEqual([{ name: "Nails", priceCents: 3500 }]);
});
