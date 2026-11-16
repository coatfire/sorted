import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { User } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import { demoBackend, resetDemo } from "../../web/src/lib/demoBackend";

async function trader() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const token = await issueJwt(user.id, user.sessionVersion);
  const request = (path: string, body?: object, method = body ? "POST" : "GET") => app.request(`/api${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const me = async () => (await request("/auth/me")).json() as Promise<User>;
  return { user, request, me };
}

describe("the import offer on Today", () => {
  it("stays open for a new trader until they dismiss it, and dismissing is remembered", async () => {
    const { request, me } = await trader(), other = await trader();
    expect((await me()).importOfferClosedAt).toBeNull();
    // Changing other settings leaves it open.
    expect((await request("/auth/me", { business_name: "Studio by Aoife" }, "PATCH")).status).toBe(200);
    expect((await me()).importOfferClosedAt).toBeNull();

    const closed = await (await request("/auth/me", { import_offer_closed: true }, "PATCH")).json() as User;
    expect(closed.importOfferClosedAt).toBeTruthy();
    expect(closed.businessName).toBe("Studio by Aoife");
    // Dismissing again, or saving another setting, keeps the first answer.
    await request("/auth/me", { import_offer_closed: true }, "PATCH");
    await request("/auth/me", { name: "Aoife" }, "PATCH");
    expect((await me()).importOfferClosedAt).toBe(closed.importOfferClosedAt);
    expect((await other.me()).importOfferClosedAt).toBeNull();
  });

  it("can't be switched back on", async () => {
    const { request, me } = await trader();
    await request("/auth/me", { import_offer_closed: true }, "PATCH");
    for (const value of [false, null, "no"]) expect((await request("/auth/me", { import_offer_closed: value }, "PATCH")).status).toBe(400);
    expect((await me()).importOfferClosedAt).toBeTruthy();
  });

  it("closes once a client list is imported, but not when the file adds nothing", async () => {
    const { user, request, me } = await trader(), other = await trader();
    await db.insert(schema.clients).values({ userId: user.id, name: "Gráinne Flynn" });
    expect(await (await request("/imports/clients", { clients: [{ name: "gráinne flynn" }] })).json()).toMatchObject({ importId: null, added: 0 });
    expect((await me()).importOfferClosedAt).toBeNull();
    expect((await request("/imports/clients", { file_name: "clients.xlsx", clients: [{ name: "Méabh Kavanagh" }] })).status).toBe(201);
    expect((await me()).importOfferClosedAt).toBeTruthy();
    expect((await other.me()).importOfferClosedAt).toBeNull();
  });

  it("closes once past income or expenses are imported, and keeps an earlier dismissal's time", async () => {
    const { request, me } = await trader(), dismissed = await trader();
    const file = { income: [], expenses: [{ date: "2025-03-20", merchant: "Salon Supplies", category: "materials", amount_cents: 4550, vat_cents: 851 }] };
    expect((await request("/imports/history", file)).status).toBe(201);
    expect((await me()).importOfferClosedAt).toBeTruthy();

    const at = new Date("2026-01-05T09:00:00.000Z");
    await db.update(schema.users).set({ importOfferClosedAt: at }).where(eq(schema.users.id, dismissed.user.id));
    expect((await dismissed.request("/imports/history", file)).status).toBe(201);
    expect((await dismissed.me()).importOfferClosedAt).toBe(at.toISOString());
  });

  it("stays closed after the import is undone", async () => {
    const { request, me } = await trader();
    const { importId } = await (await request("/imports/clients", { clients: [{ name: "Róisín Daly" }] })).json() as { importId: string };
    expect((await request(`/imports/${importId}`, { confirm: true }, "DELETE")).status).toBe(200);
    expect((await me()).importOfferClosedAt).toBeTruthy();
  });
});

describe("the import offer in demo mode", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("is closed for the sample trader, and a dismissal is saved the way the server saves it", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    resetDemo();
    const user = async () => (await demoBackend.load()).user;
    const seeded = (await user()).importOfferClosedAt;
    expect(seeded).toBeTruthy();
    await demoBackend.updateUser({ importOfferClosed: true });
    expect((await user()).importOfferClosedAt).toBe(seeded);
    expect(await user()).not.toHaveProperty("importOfferClosed");
    expect(JSON.parse(values.get("sorted_demo_v3")!).user).not.toHaveProperty("importOfferClosed");
    await demoBackend.importClients("clients.xlsx", [{ name: "Offer Test Client" }]);
    expect((await user()).importOfferClosedAt).toBe(seeded);
  });
});
