import { afterEach, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";

afterEach(() => vi.restoreAllMocks());

async function fixture(status: "enquiry" | "confirmed" | "completed") {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const [client] = await db.insert(schema.clients).values({ userId: user.id, name: "Lock order client" }).returning();
  const [booking] = await db.insert(schema.bookings).values({ userId: user.id, clientId: client.id, status, service: "Hair", startAt: new Date(), priceCents: 8000, depositCents: 2500 }).returning();
  const headers = { Authorization: `Bearer ${await issueJwt(user.id, user.sessionVersion)}` };
  return { user, client, booking, headers };
}

it.each(["create", "record", "document", "confirm", "edit", "complete", "cancel", "anonymise"] as const)("uses the global user → client → booking → payment → invoice row-lock order for %s", async action => {
  const f = await fixture(action === "record" || action === "anonymise" ? "completed" : action === "complete" ? "confirmed" : "enquiry");
  if (action === "record" || action === "anonymise") {
    await db.insert(schema.payments).values({ userId: f.user.id, bookingId: f.booking.id, kind: "deposit", status: "paid", amountCents: 2500 });
  }
  if (action === "anonymise") {
    expect((await app.request(`/api/bookings/${f.booking.id}/documents`, { method: "POST", headers: f.headers, body: JSON.stringify({ kind: "invoice" }) })).status).toBe(200);
  }
  const query = db.select().from(schema.clients);
  const locks = vi.spyOn(Object.getPrototypeOf(query) as typeof query, "for");
  const suffix = { record: "payments", document: "documents", confirm: "confirm", complete: "complete", cancel: "cancel" };
  const path = action === "create" ? "/api/bookings" : action === "anonymise" ? `/api/clients/${f.client.id}` : `/api/bookings/${f.booking.id}${action in suffix ? `/${suffix[action as keyof typeof suffix]}` : ""}`;
  const payload = action === "create" ? { client_id: f.client.id, service: "Hair", start_at: new Date().toISOString(), price_cents: 8000 }
    : action === "record" ? { amount_cents: 1000, method: "cash" }
    : action === "document" ? { kind: "invoice" }
    : action === "anonymise" ? { confirm: true } : action === "edit" ? { notes: "Updated" } : {};
  const response = await app.request(path, { method: action === "anonymise" ? "DELETE" : action === "edit" ? "PATCH" : "POST", headers: f.headers, body: JSON.stringify(payload) });
  expect(response.status).toBe(action === "create" || action === "record" ? 201 : 200);
  const queries = locks.mock.contexts.map(query => (query as { toSQL(): { sql: string } }).toSQL().sql);
  const tables = queries.map(query => query.match(/for (?:share|update) of "(\w+)"$/)?.[1] ?? query.match(/from "(\w+)"/)![1]);
  const order = ["users", "clients", "bookings", "payments", "invoices"];
  expect(tables[0]).toBe("users");
  expect(tables.every(table => order.includes(table))).toBe(true);
  expect(tables.map(table => order.indexOf(table))).toEqual(tables.map(table => order.indexOf(table)).sort((a, b) => a - b));
  if (action === "confirm") expect(tables).toEqual(["users", "clients", "bookings"]);
  if (action === "document") expect(tables).toEqual(["users", "clients", "bookings", "payments"]);
  if (action === "anonymise") expect(tables).toEqual(order);
  for (const query of queries.filter(query => /from "(?:bookings|payments|invoices)"/.test(query) && query.includes("order by"))) {
    expect(query).toMatch(/order by "\w+"\."id"/);
  }
});

it("rolls back and retries a confirmation deadlock without duplicating the deposit", async () => {
  const f = await fixture("enquiry");
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, "transaction").mockImplementationOnce((work, config) => transaction(async tx => {
    await work(tx);
    throw Object.assign(new Error("Simulated deadlock"), { code: "40P01" });
  }, config));
  const response = await app.request(`/api/bookings/${f.booking.id}/confirm`, { method: "POST", headers: f.headers });
  expect(response.status).toBe(200);
  expect(spy).toHaveBeenCalledTimes(2);
  const payments = await db.select().from(schema.payments).where(and(eq(schema.payments.userId, f.user.id), eq(schema.payments.bookingId, f.booking.id)));
  expect(payments).toHaveLength(1);
  expect(payments[0]).toMatchObject({ status: "pending", kind: "deposit", amountCents: 2500 });
});
