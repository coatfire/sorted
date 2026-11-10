/**
 * End-to-end API test against an in-memory Postgres (PGlite): the core loop a
 * sole trader actually walks — log in, book, confirm, complete, get paid,
 * log an expense, export for the accountant.
 */
import { describe, expect, it } from "vitest";
import { app } from "../src/app";
import { issueMagicLinkToken } from "../src/lib/auth";
import { db, schema } from "../src/db";

async function login(email: string) {
  const sent = await app.request("/api/auth/magic-link", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  const { dev_link } = (await sent.json()) as { dev_link: string };
  const token = new URL(dev_link).searchParams.get("token");
  const res = await app.request("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  const { jwt } = (await res.json()) as { jwt: string };
  return (path: string, method = "GET", body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${jwt}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}

const json = async <T = any>(res: Response) => (await res.json()) as T;

describe("auth", () => {
  it("rejects requests without a session", async () => {
    expect((await app.request("/api/bookings")).status).toBe(401);
  });

  it("does not accept a magic-link token as a session", async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: "token@example.com" })
      .returning();
    const token = await issueMagicLinkToken(user.id);
    const res = await app.request("/api/bookings", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it("saves business settings and validates the phone", async () => {
    const call = await login("settings@example.com");
    const ok = await call("/auth/me", "PATCH", {
      business_name: "Studio Test",
      phone: "+353871234567",
    });
    expect(ok.status).toBe(200);
    expect((await json(ok)).businessName).toBe("Studio Test");
    expect((await call("/auth/me", "PATCH", { phone: "087 123" })).status).toBe(400);
  });
});

describe("booking → payment → report", () => {
  it("walks the whole loop", async () => {
    const call = await login("vendor@example.com");

    // Book with an inline new client
    const created = await call("/bookings", "POST", {
      client: { name: "Sarah Keane", phone: "+353871234567" },
      service: "Bridal trial",
      start_at: new Date(Date.now() + 86_400_000).toISOString(),
      price_cents: 35000,
      deposit_cents: 5000,
    });
    expect(created.status).toBe(201);
    const booking = await json(created);
    expect(booking.status).toBe("enquiry");

    // Can't complete an enquiry
    expect((await call(`/bookings/${booking.id}/complete`, "POST")).status).toBe(409);

    // Confirm → pending deposit
    expect((await call(`/bookings/${booking.id}/confirm`, "POST")).status).toBe(200);
    expect((await call(`/bookings/${booking.id}/confirm`, "POST")).status).toBe(409);
    let detail = await json(await call(`/bookings/${booking.id}`));
    expect(detail.payments).toHaveLength(1);
    expect(detail.payments[0]).toMatchObject({ kind: "deposit", amountCents: 5000, status: "pending" });

    // Deposit is locked after confirm; other edits are fine
    expect((await call(`/bookings/${booking.id}`, "PATCH", { deposit_cents: 1000 })).status).toBe(409);
    expect((await call(`/bookings/${booking.id}`, "PATCH", { location: "Studio" })).status).toBe(200);

    // Deposit paid in cash, then job done → balance for the remainder
    const deposit = detail.payments[0];
    expect((await call(`/payments/${deposit.id}/mark-paid`, "POST", { method: "stripe" })).status).toBe(400);
    expect((await call(`/payments/${deposit.id}/mark-paid`, "POST", { method: "cash" })).status).toBe(200);
    expect((await call(`/payments/${deposit.id}/mark-paid`, "POST", { method: "cash" })).status).toBe(409);

    const completed = await json(await call(`/bookings/${booking.id}/complete`, "POST"));
    expect(completed.payment).toMatchObject({ kind: "balance", amountCents: 30000, status: "pending" });
    expect((await call(`/bookings/${booking.id}`, "PATCH", { notes: "x" })).status).toBe(409);

    // Owed list
    const owed = await json(await call("/payments?status=pending"));
    expect(owed).toHaveLength(1);
    expect(owed[0].client.name).toBe("Sarah Keane");

    // No Stripe key in tests → honest 503, not a crash
    expect((await call(`/payments/${completed.payment.id}/link`, "POST")).status).toBe(503);
    await call(`/payments/${completed.payment.id}/mark-paid`, "POST", { method: "bank_transfer" });

    // Expense with a receipt photo
    const pixel =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const receipt = await json(
      await call("/expenses/receipts", "POST", { content_type: "image/png", data_base64: pixel }),
    );
    const today = new Date().toISOString();
    const draft = await call("/expenses", "POST", { merchant: "MAC", confirmed: true });
    expect(draft.status).toBe(400); // confirmed needs all four fields
    const expense = await json(
      await call("/expenses", "POST", {
        receipt_key: receipt.receipt_key,
        merchant: "MAC Cosmetics",
        amount_cents: 8640,
        category: "materials",
        expense_date: today,
        confirmed: true,
      }),
    );
    expect(expense.status).toBe("confirmed");
    const image = await call(`/expenses/${expense.id}/receipt`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");

    // Year summary + accountant CSV
    const summary = await json(await call("/reports/summary"));
    expect(summary).toMatchObject({
      income_cents: 35000,
      expenses_cents: 8640,
      profit_cents: 26360,
    });
    const csv = await (await call("/reports/export")).text();
    expect(csv).toContain('"Sarah Keane","Bridal trial","balance","bank_transfer","300.00"');
    expect(csv).toContain('"MAC Cosmetics","materials","86.40","yes"');

    // Deleting the expense takes its receipt with it
    expect((await call(`/expenses/${expense.id}`, "DELETE")).status).toBe(204);
    expect(await db.select().from(schema.receipts)).toHaveLength(0);
  });

  it("cancelling voids pending payments", async () => {
    const call = await login("cancel@example.com");
    const booking = await json(
      await call("/bookings", "POST", {
        client: { name: "Emma" },
        service: "Makeup",
        start_at: new Date().toISOString(),
        price_cents: 12000,
        deposit_cents: 2000,
      }),
    );
    await call(`/bookings/${booking.id}/confirm`, "POST");
    expect((await call(`/bookings/${booking.id}/cancel`, "POST")).status).toBe(200);
    expect(await json(await call("/payments?status=pending"))).toHaveLength(0);
  });
});

describe("isolation and bad input", () => {
  it("never shows one trader another's data", async () => {
    const alice = await login("alice@example.com");
    const bob = await login("bob@example.com");
    const booking = await json(
      await alice("/bookings", "POST", {
        client: { name: "Private Client" },
        service: "Hair",
        start_at: new Date().toISOString(),
        price_cents: 1000,
      }),
    );
    expect((await bob(`/bookings/${booking.id}`)).status).toBe(404);
    expect((await bob(`/bookings/${booking.id}/confirm`, "POST")).status).toBe(404);
    expect(await json(await bob("/clients"))).toHaveLength(0);
    // Bob can't attach a booking to Alice's client either
    const stolen = await bob("/bookings", "POST", {
      client_id: booking.clientId,
      service: "Hair",
      start_at: new Date().toISOString(),
      price_cents: 1000,
    });
    expect(stolen.status).toBe(404);
  });

  it("answers 4xx, not 500, for junk", async () => {
    const call = await login("junk@example.com");
    expect((await call("/bookings/not-a-uuid")).status).toBe(404);
    expect((await call("/bookings?from=yesterday-ish")).status).toBe(400);
    const res = await app.request("/api/auth/magic-link", { method: "POST", body: "{nope" });
    expect(res.status).toBe(400);
    expect(
      (await call("/bookings", "POST", {
        client: { name: "X" },
        service: "Y",
        start_at: new Date().toISOString(),
        price_cents: 100,
        deposit_cents: 500,
      })).status,
    ).toBe(400);
  });

  it("guards the n8n callbacks with the shared secret", async () => {
    expect((await app.request("/api/internal/reminders")).status).toBe(403);
    // With no secret configured, an empty header must not get in
    const empty = await app.request("/api/internal/reminders", {
      headers: { "X-Internal-Secret": "" },
    });
    expect(empty.status).toBe(403);
  });
});
