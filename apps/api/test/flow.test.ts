/**
 * End-to-end API test against an in-memory Postgres (PGlite): the core loop a
 * sole trader actually walks — log in, book, confirm, complete, get paid,
 * log an expense, export for the accountant.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { app } from "../src/app";
import { issueEmailToken } from "../src/lib/auth";
import { db, schema } from "../src/db";
import * as events from "../src/lib/events";
import { env } from "../src/lib/env";
import { deactivatePaymentLink } from "../src/lib/stripe";

const stripe = vi.hoisted(() => ({
  createPrice: vi.fn(),
  createLink: vi.fn(),
  updateLink: vi.fn(),
  constructEvent: vi.fn(),
  retrieveIntent: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class {
    prices = { create: stripe.createPrice };
    paymentLinks = { create: stripe.createLink, update: stripe.updateLink };
    webhooks = { constructEvent: stripe.constructEvent };
    paymentIntents = { retrieve: stripe.retrieveIntent };
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

async function login(email: string) {
  const sent = await app.request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password: "test-password" }),
  });
  const { dev_link } = (await sent.json()) as { dev_link: string };
  const token = new URL(dev_link).searchParams.get("token");
  const verified = await app.request("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  expect(verified.status).toBe(200);
  const res = await app.request("/api/auth/login", {
    method: "POST", body: JSON.stringify({ email, password: "test-password" }),
  });
  expect(res.status).toBe(200);
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
  async function requestLink(email: string) {
    return app.request("/api/auth/signup", {
      method: "POST", body: JSON.stringify({ email, password: "test-password" }),
    });
  }

  async function verify(token: string) {
    return app.request("/api/auth/verify", {
      method: "POST", body: JSON.stringify({ token }),
    });
  }

  async function linkToken(response: Response) {
    expect(response.status).toBe(200);
    const { dev_link } = await json<{ dev_link: string }>(response);
    const token = new URL(dev_link).searchParams.get("token");
    if (!token) throw new Error("Missing login token");
    return token;
  }

  it.each(["provider", "network", "missing key"])("fails safely in production when login email fails (%s)", async (failure) => {
    const email = `email-failure-${crypto.randomUUID()}@example.com`;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const retainedToken = await linkToken(await requestLink(email));
    const retainedRows = await db.select().from(schema.loginTokens).where(eq(schema.loginTokens.email, email));
    log.mockClear();
    vi.spyOn(env, "isLocal").mockReturnValue(false);
    vi.spyOn(env, "resendKey").mockReturnValue(failure === "missing key" ? undefined : "re_test_placeholder");
    let attemptedToken: string | undefined;
    const send = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { text: string };
      attemptedToken = new URL(body.text.split("\n")[2]).searchParams.get("token") ?? undefined;
      if (failure === "network") throw new Error(body.text);
      return new Response(body.text, { status: 503 });
    });
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await requestLink(email);
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "We couldn't send your login email. Try again in a minute." });
      expect(await db.select().from(schema.loginTokens).where(eq(schema.loginTokens.email, email))).toEqual(retainedRows);
    }
    expect(log).not.toHaveBeenCalled();
    const logs = [...log.mock.calls, ...error.mock.calls].flat().map(String).join("\n");
    expect(logs).not.toContain("token=");
    if (failure === "missing key") {
      expect(send).not.toHaveBeenCalled();
    } else {
      expect(attemptedToken).toBeTruthy();
      expect(logs).not.toContain(attemptedToken!);
      expect((await verify(attemptedToken!)).status).toBe(401);
    }
    expect((await verify(retainedToken)).status).toBe(200);
  });

  it.each([false, true])("keeps local login links usable when email is unavailable (provider failure=%s)", async (providerFailure) => {
    vi.spyOn(env, "isLocal").mockReturnValue(true);
    vi.spyOn(env, "resendKey").mockReturnValue(providerFailure ? "re_test_placeholder" : undefined);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Email unavailable", { status: 503 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await requestLink(`local-email-${crypto.randomUUID()}@example.com`);
    expect(response.status).toBe(200);
    const { ok, dev_link } = await json<{ ok: boolean; dev_link: string }>(response);
    expect(ok).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(dev_link));
    const token = new URL(dev_link).searchParams.get("token");
    expect(token).toBeTruthy();
    expect((await verify(token!)).status).toBe(200);
  });

  it("returns success without a development link when production email succeeds", async () => {
    vi.spyOn(env, "isLocal").mockReturnValue(false);
    vi.spyOn(env, "resendKey").mockReturnValue("re_test_placeholder");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const email = `email-success-${crypto.randomUUID()}@example.com`;
    const response = await requestLink(email);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(log).not.toHaveBeenCalled();
    expect(await db.select().from(schema.loginTokens).where(eq(schema.loginTokens.email, email))).toHaveLength(1);
  });

  it("allows a login link once and rejects reuse with the invalid-link error", async () => {
    const token = await linkToken(await requestLink("single-use@example.com"));
    const first = await verify(token);
    expect(first.status).toBe(200);
    const { jwt } = await json<{ jwt: string }>(first);
    expect((await app.request("/api/auth/me", {
      headers: { Authorization: `Bearer ${jwt}` },
    })).status).toBe(200);
    const reused = await verify(token);
    expect(reused.status).toBe(401);
    expect(await reused.json()).toEqual({ error: "Invalid or expired login link" });
  });

  it("consumes a link atomically when two verifications arrive together", async () => {
    const token = await linkToken(await requestLink("simultaneous@example.com"));
    const responses = await Promise.all([verify(token), verify(token)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
  });

  it("rate limits the fourth request per email, including used links and case variants", async () => {
    const email = "rate-limit@example.com";
    const token = await linkToken(await requestLink(email));
    expect((await verify(token)).status).toBe(200);
    expect((await requestLink(email.toUpperCase())).status).toBe(200);
    expect((await requestLink(email)).status).toBe(200);
    const fourth = await requestLink(email);
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({
      error: "Too many login links requested. Check your email, or try again in 15 minutes.",
    });
    const rows = await db.select().from(schema.loginTokens).where(eq(schema.loginTokens.email, email));
    expect(rows).toHaveLength(3);
    expect((await requestLink("separate-limit@example.com")).status).toBe(200);
  });

  it("serializes concurrent requests for a new email", async () => {
    const email = "concurrent-links@example.com";
    const responses = await Promise.all(Array.from({ length: 6 }, () => requestLink(email)));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 200, 429, 429, 429]);
    const rows = await db.select().from(schema.loginTokens).where(eq(schema.loginTokens.email, email));
    expect(rows).toHaveLength(3);
  });

  it("does not count requests older than fifteen minutes", async () => {
    const email = "old-links@example.com";
    await db.insert(schema.loginTokens).values(Array.from({ length: 3 }, () => ({
      email, createdAt: new Date(Date.now() - 16 * 60 * 1000),
    })));
    expect((await requestLink(email)).status).toBe(200);
  });

  it("rejects missing, invalid, unrecorded and mismatched tokens", async () => {
    expect((await verify("")).status).toBe(400);
    expect((await verify("not-a-token")).status).toBe(401);
    expect((await requestLink("not-an-email")).status).toBe(400);
    const [user] = await db.insert(schema.users).values({ email: "invalid-token@example.com" }).returning();
    const unrecorded = await issueEmailToken(user.id, crypto.randomUUID());
    expect((await verify(unrecorded)).status).toBe(401);
    const missingId = await issueEmailToken(user.id, "");
    expect((await verify(missingId)).status).toBe(401);
    const email = "different-owner@example.com";
    const [record] = await db.insert(schema.loginTokens).values({ email }).returning();
    const mismatch = await issueEmailToken(user.id, record.id);
    expect((await verify(mismatch)).status).toBe(401);
    const [unchanged] = await db.select().from(schema.loginTokens).where(and(
      eq(schema.loginTokens.id, record.id), eq(schema.loginTokens.email, email),
    ));
    expect(unchanged.usedAt).toBeNull();
  });

  it("rejects requests without a session", async () => {
    expect((await app.request("/api/bookings")).status).toBe(401);
  });

  it("does not accept an email token as a session", async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: "token@example.com" })
      .returning();
    const [loginToken] = await db.insert(schema.loginTokens).values({ email: user.email }).returning();
    const token = await issueEmailToken(user.id, loginToken.id);
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

describe("client deletion", () => {
  async function fixture(paid = false, status: "completed" | "cancelled" | "enquiry" | "confirmed" = "completed") {
    const call = await login(`delete-${crypto.randomUUID()}@example.com`);
    const { id: userId } = await json<{ id: string }>(await call("/auth/me"));
    const [client] = await db.insert(schema.clients).values({
      userId, name: "Private client", phone: "+353871234567", email: "private@example.com", notes: "Private notes",
    }).returning();
    const [booking] = await db.insert(schema.bookings).values({
      userId, clientId: client.id, service: "Hair", startAt: new Date(), priceCents: 12000,
      status, location: "Private address", notes: "Private booking notes",
    }).returning();
    const [payment] = await db.insert(schema.payments).values({
      userId, bookingId: booking.id, kind: "full", amountCents: 12000,
      status: paid ? "paid" : "pending", paidAt: paid ? new Date() : null,
      method: paid ? "cash" : null,
    }).returning();
    await db.insert(schema.messageLog).values([
      { userId, clientId: client.id, template: "confirmation" },
      { userId, bookingId: booking.id, template: "confirmation" },
      { userId, clientId: client.id, bookingId: booking.id, template: "confirmation" },
    ]);
    const [receipt] = await db.insert(schema.receipts).values({
      userId, contentType: "image/png", dataBase64: "aGVsbG8=",
    }).returning();
    return { call, userId, client, booking, payment, receipt };
  }

  it("deletes messages, payments, bookings and client, but leaves receipts alone", async () => {
    const { call, userId, client, receipt } = await fixture(false, "cancelled");
    expect(await json<{ outcome: string }>(await call(`/clients/${client.id}`, "DELETE", { confirm: true })))
      .toEqual({ outcome: "deleted" });
    expect((await call(`/clients/${client.id}`)).status).toBe(404);
    expect(await json<unknown[]>(await call("/bookings"))).toEqual([]);
    expect(await json<unknown[]>(await call("/payments"))).toEqual([]);
    expect(await db.select().from(schema.messageLog).where(eq(schema.messageLog.userId, userId))).toEqual([]);
    expect(await db.select().from(schema.receipts).where(eq(schema.receipts.userId, userId))).toEqual([receipt]);
  });

  it("anonymises paid clients and preserves all payments, year totals, and receipts", async () => {
    const { call, userId, client, booking, payment, receipt } = await fixture(true);
    const before = await json<unknown>(await call("/reports/summary"));
    expect(await json<{ outcome: string }>(await call(`/clients/${client.id}`, "DELETE", { confirm: true })))
      .toEqual({ outcome: "anonymised" });
    const [anonymous] = await db.select().from(schema.clients).where(and(
      eq(schema.clients.id, client.id), eq(schema.clients.userId, userId),
    ));
    expect(anonymous).toEqual({ ...client, name: "Deleted client", phone: null, email: null, notes: null });
    expect(await db.select().from(schema.bookings).where(eq(schema.bookings.userId, userId)))
      .toEqual([{ ...booking, notes: null, location: null }]);
    expect(await db.select().from(schema.payments).where(eq(schema.payments.userId, userId))).toEqual([payment]);
    expect(await db.select().from(schema.messageLog).where(eq(schema.messageLog.userId, userId))).toEqual([]);
    expect(await db.select().from(schema.receipts).where(eq(schema.receipts.userId, userId))).toEqual([receipt]);
    expect(await json<unknown>(await call("/reports/summary"))).toEqual(before);
    const csv = await (await call("/reports/export")).text();
    expect(csv).toContain('"Deleted client","Hair","full","cash","120.00"');
    expect(csv).not.toContain("Private client");
  });

  it("deactivates only deleted pending links, after the client deletion commits", async () => {
    const { call, userId, client, booking, payment } = await fixture();
    vi.spyOn(env, "stripeKey").mockReturnValue("sk_test_placeholder");
    await db.update(schema.payments).set({ stripePaymentLinkId: "plink_delete_1" }).where(and(
      eq(schema.payments.id, payment.id), eq(schema.payments.userId, userId),
    ));
    await db.insert(schema.payments).values([
      { userId, bookingId: booking.id, kind: "balance", amountCents: 12000, stripePaymentLinkId: "plink_delete_2" },
      { userId, bookingId: booking.id, kind: "balance", amountCents: 12000, stripePaymentLinkId: "plink_cancelled", status: "cancelled" },
      { userId, bookingId: booking.id, kind: "balance", amountCents: 12000 },
    ]);
    let committed = false;
    const transaction: typeof db.transaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementationOnce(async (callback, config) => {
      const result = await transaction(callback, config);
      committed = true;
      return result;
    });
    const committedAtDeactivation: boolean[] = [];
    stripe.updateLink.mockImplementation(async () => {
      committedAtDeactivation.push(committed);
      return {};
    });
    const response = await call(`/clients/${client.id}`, "DELETE", { confirm: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "deleted" });
    expect(stripe.updateLink).toHaveBeenCalledTimes(2);
    expect(stripe.updateLink).toHaveBeenCalledWith("plink_delete_1", { active: false });
    expect(stripe.updateLink).toHaveBeenCalledWith("plink_delete_2", { active: false });
    expect(committedAtDeactivation).toEqual([true, true]);
    expect((await call(`/clients/${client.id}`)).status).toBe(404);
  });

  it("does not deactivate retained pending links when anonymising a paid client", async () => {
    const { call, userId, client, booking } = await fixture(true);
    vi.spyOn(env, "stripeKey").mockReturnValue("sk_test_placeholder");
    const [pending] = await db.insert(schema.payments).values({
      userId, bookingId: booking.id, kind: "balance", amountCents: 12000, stripePaymentLinkId: "plink_retained",
    }).returning();
    const response = await call(`/clients/${client.id}`, "DELETE", { confirm: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "anonymised" });
    expect(stripe.updateLink).not.toHaveBeenCalled();
    expect(await db.select().from(schema.payments).where(and(
      eq(schema.payments.id, pending.id), eq(schema.payments.userId, userId),
    ))).toEqual([pending]);
  });

  it("requires explicit confirmation, including for an empty client", async () => {
    const call = await login(`empty-delete-${crypto.randomUUID()}@example.com`);
    const client = await json<{ id: string }>(await call("/clients", "POST", { name: "Empty client" }));
    for (const body of [undefined, null, {}, { confirm: false }, { confirm: "true" }]) {
      expect((await call(`/clients/${client.id}`, "DELETE", body)).status).toBe(400);
    }
    expect((await call(`/clients/${client.id}`)).status).toBe(200);
    expect((await call(`/clients/${client.id}`, "DELETE", { confirm: true })).status).toBe(200);
    expect((await call(`/clients/${client.id}`, "DELETE", { confirm: true })).status).toBe(404);
  });

  it.each(["enquiry", "confirmed"] as const)("refuses clients with %s bookings without changing data", async (status) => {
    const { call, userId, client } = await fixture(true, status);
    const before = await json<unknown>(await call(`/clients/${client.id}`));
    const response = await call(`/clients/${client.id}`, "DELETE", { confirm: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Cancel or complete their open bookings first." });
    expect(await json<unknown>(await call(`/clients/${client.id}`))).toEqual(before);
    expect(await db.select().from(schema.messageLog).where(eq(schema.messageLog.userId, userId))).toHaveLength(3);
  });

  it("does not let another tenant delete or anonymise a client", async () => {
    const { call, userId, client } = await fixture(true);
    const other = await login(`delete-other-${crypto.randomUUID()}@example.com`);
    const before = await json<unknown>(await call(`/clients/${client.id}`));
    expect((await other(`/clients/${client.id}`, "DELETE", { confirm: true })).status).toBe(404);
    expect(await json<unknown>(await call(`/clients/${client.id}`))).toEqual(before);
    expect(await db.select().from(schema.messageLog).where(eq(schema.messageLog.userId, userId))).toHaveLength(3);
  });

  it.each([false, true])("rolls back all writes if the transaction fails (paid=%s)", async (paid) => {
    const { call, userId, client, payment } = await fixture(paid);
    vi.spyOn(env, "stripeKey").mockReturnValue("sk_test_placeholder");
    await db.update(schema.payments).set({ stripePaymentLinkId: "plink_rollback" }).where(and(
      eq(schema.payments.id, payment.id), eq(schema.payments.userId, userId),
    ));
    const before = await json<unknown>(await call(`/clients/${client.id}`));
    const transaction: typeof db.transaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementationOnce((callback, config) => transaction(async (tx) => {
      await callback(tx);
      throw new Error("Simulated deletion failure");
    }, config));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call(`/clients/${client.id}`, "DELETE", { confirm: true })).status).toBe(500);
    expect(stripe.updateLink).not.toHaveBeenCalled();
    expect(await json<unknown>(await call(`/clients/${client.id}`))).toEqual(before);
    expect(await db.select().from(schema.messageLog).where(eq(schema.messageLog.userId, userId))).toHaveLength(3);
  });
});

describe("transactional writes", () => {
  function failTransaction() {
    const transaction: typeof db.transaction = db.transaction.bind(db);
    return vi.spyOn(db, "transaction").mockImplementationOnce((callback, config) =>
      transaction(async (tx) => {
        await callback(tx);
        throw new Error("Simulated transaction failure");
      }, config),
    );
  }

  it("rolls back inline client creation if the booking transaction fails", async () => {
    const call = await login("rollback-create@example.com");
    const transaction = failTransaction();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await call("/bookings", "POST", {
        client: { name: "Rolled back client" }, service: "Hair",
        start_at: new Date().toISOString(), price_cents: 12000,
      });
      expect(response.status).toBe(500);
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(await json(await call("/clients"))).toEqual([]);
      expect(await json(await call("/bookings"))).toEqual([]);
    } finally {
      transaction.mockRestore();
      error.mockRestore();
    }
  });

  it.each(["confirm", "complete", "cancel"])("rolls back %s and emits no event when the transaction fails", async (action) => {
    const call = await login(`rollback-${action}@example.com`);
    const booking = await json<{ id: string }>(await call("/bookings", "POST", {
      client: { name: "Rollback" }, service: "Hair", start_at: new Date().toISOString(),
      price_cents: 12000, deposit_cents: 2000,
    }));
    if (action !== "confirm") await call(`/bookings/${booking.id}/confirm`, "POST");
    const before = await json<unknown>(await call(`/bookings/${booking.id}`));
    const transaction = failTransaction();
    const emit = vi.spyOn(events, "emitEvent");
    const emitBooking = vi.spyOn(events, "emitBookingEvent");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await call(`/bookings/${booking.id}/${action}`, "POST")).status).toBe(500);
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(await json(await call(`/bookings/${booking.id}`))).toEqual(before);
      expect(emit).not.toHaveBeenCalled();
      expect(emitBooking).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
      emit.mockRestore();
      emitBooking.mockRestore();
      error.mockRestore();
    }
  });

  it("only emits after the booking transaction has committed", async () => {
    const call = await login("post-commit@example.com");
    const booking = await json<{ id: string }>(await call("/bookings", "POST", {
      client: { name: "Post commit" }, service: "Hair", start_at: new Date().toISOString(),
      price_cents: 0,
    }));
    const transaction: typeof db.transaction = db.transaction.bind(db);
    let committed = false;
    const spy = vi.spyOn(db, "transaction").mockImplementation(async <T>(
      callback: Parameters<typeof db.transaction<T>>[0],
      config?: Parameters<typeof db.transaction<T>>[1],
    ) => {
      const result = await transaction<T>(callback, config);
      committed = true;
      return result;
    });
    const emit = vi.spyOn(events, "emitEvent").mockImplementation(async () => {
      expect(committed).toBe(true);
    });
    const emitBooking = vi.spyOn(events, "emitBookingEvent").mockImplementation(async () => {
      expect(committed).toBe(true);
    });
    try {
      expect((await call(`/bookings/${booking.id}/confirm`, "POST")).status).toBe(200);
      committed = false;
      const completed = await call(`/bookings/${booking.id}/complete`, "POST");
      expect(completed.status).toBe(200);
      expect(await json(completed)).toMatchObject({ payment: null });
      expect(emit).not.toHaveBeenCalled();
      expect(emitBooking.mock.calls.map(call => call[2])).toEqual(["booking.confirmed", "booking.completed"]);
    } finally {
      spy.mockRestore();
      emit.mockRestore();
      emitBooking.mockRestore();
    }
  });

  it("rolls back expense and receipt deletion together", async () => {
    const call = await login("rollback-expense@example.com");
    const { id: userId } = await json<{ id: string }>(await call("/auth/me"));
    const [receipt] = await db.insert(schema.receipts).values({
      userId, contentType: "image/png", dataBase64: "aGVsbG8=",
    }).returning();
    const expense = await json<{ id: string }>(await call("/expenses", "POST", {
      receipt_key: receipt.id, merchant: "Rollback",
    }));
    const transaction = failTransaction();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await call(`/expenses/${expense.id}`, "DELETE")).status).toBe(500);
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(await db.select().from(schema.expenses).where(and(
        eq(schema.expenses.id, expense.id), eq(schema.expenses.userId, userId),
      ))).toHaveLength(1);
      expect(await db.select().from(schema.receipts).where(and(
        eq(schema.receipts.id, receipt.id), eq(schema.receipts.userId, userId),
      ))).toHaveLength(1);
    } finally {
      transaction.mockRestore();
      error.mockRestore();
    }
    expect((await call(`/expenses/${expense.id}`, "DELETE")).status).toBe(204);
    expect((await call(`/expenses/${expense.id}`, "DELETE")).status).toBe(404);
  });
});

describe("payment link safety", () => {
  async function pendingDeposit() {
    const call = await login(`safety-${crypto.randomUUID()}@example.com`);
    const booking = await json<{ id: string; userId: string }>(await call("/bookings", "POST", {
      client: { name: "Payment safety" },
      service: "Hair",
      start_at: new Date().toISOString(),
      price_cents: 10000,
      deposit_cents: 2000,
    }));
    await call(`/bookings/${booking.id}/confirm`, "POST");
    const detail = await json<{ payments: { id: string }[] }>(await call(`/bookings/${booking.id}`));
    const paymentId = detail.payments[0].id;
    return { call, booking, paymentId };
  }

  function configureStripe() {
    vi.spyOn(env, "stripeKey").mockReturnValue("sk_test_placeholder");
    vi.spyOn(env, "stripeWebhookSecret").mockReturnValue("whsec_placeholder");
    stripe.createPrice.mockResolvedValue({ id: "price_test" });
    stripe.createLink.mockResolvedValue({ id: "plink_test", url: "https://example.com/pay" });
    stripe.updateLink.mockResolvedValue({});
  }

  it("creates a single-use scoped link, reuses it, and hides it from another user", async () => {
    const { call, booking, paymentId } = await pendingDeposit();
    configureStripe();
    const other = await login(`other-${crypto.randomUUID()}@example.com`);
    expect((await other(`/payments/${paymentId}/link`, "POST")).status).toBe(404);
    expect((await other(`/payments/${paymentId}/mark-paid`, "POST", { method: "cash" })).status).toBe(404);
    expect((await call(`/payments/${paymentId}/link`, "POST")).status).toBe(200);
    expect(stripe.createPrice).toHaveBeenCalledWith(expect.objectContaining({ unit_amount: 2000 }));
    const metadata = { payment_id: paymentId, user_id: booking.userId };
    expect(stripe.createLink).toHaveBeenCalledWith(expect.objectContaining({
      restrictions: { completed_sessions: { limit: 1 } },
      metadata,
      payment_intent_data: { metadata },
    }));
    expect((await call(`/payments/${paymentId}/link`, "POST")).status).toBe(200);
    expect(stripe.createLink).toHaveBeenCalledTimes(1);
    const paid = await call(`/payments/${paymentId}/mark-paid`, "POST", { method: "cash" });
    expect(paid.status).toBe(200);
    expect(await json(paid)).toMatchObject({ id: paymentId, status: "paid", method: "cash" });
    expect(stripe.updateLink).toHaveBeenCalledWith("plink_test", { active: false });
  });

  it.each(["complete", "cancel"])("deactivates voided links on %s without changing the response", async (action) => {
    const { call, booking, paymentId } = await pendingDeposit();
    configureStripe();
    await call(`/payments/${paymentId}/link`, "POST");
    let committed = false;
    const transaction: typeof db.transaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementationOnce(async (callback, config) => {
      const result = await transaction(callback, config);
      committed = true;
      return result;
    });
    stripe.updateLink.mockImplementation(async () => {
      expect(committed).toBe(true);
      return {};
    });
    const response = await call(`/bookings/${booking.id}/${action}`, "POST");
    expect(response.status).toBe(200);
    expect(stripe.updateLink).toHaveBeenCalledWith("plink_test", { active: false });
    const detail = await json<{ payments: { id: string; status: string }[] }>(await call(`/bookings/${booking.id}`));
    expect(detail.payments.find((payment) => payment.id === paymentId)?.status).toBe("cancelled");
    if (action === "complete") {
      expect(await json(response)).toMatchObject({ payment: { kind: "full", amountCents: 10000, status: "pending" } });
    } else {
      expect(await json(response)).toMatchObject({ id: booking.id, status: "cancelled" });
    }
  });

  it.each(["complete", "cancel"])("does not deactivate links when %s rolls back", async (action) => {
    const { call, booking, paymentId } = await pendingDeposit();
    configureStripe();
    await call(`/payments/${paymentId}/link`, "POST");
    const transaction: typeof db.transaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementationOnce((callback, config) =>
      transaction(async (tx) => {
        await callback(tx);
        throw new Error("forced rollback");
      }, config),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call(`/bookings/${booking.id}/${action}`, "POST")).status).toBe(500);
    expect(stripe.updateLink).not.toHaveBeenCalled();
    const detail = await json<{ booking: { status: string }; payments: { status: string }[] }>(
      await call(`/bookings/${booking.id}`),
    );
    expect(detail.booking.status).toBe("confirmed");
    expect(detail.payments).toHaveLength(1);
    expect(detail.payments[0].status).toBe("pending");
  });

  it("does nothing without a key and never throws on deactivation failure", async () => {
    vi.spyOn(env, "stripeKey").mockReturnValue(undefined);
    await expect(deactivatePaymentLink("plink_test")).resolves.toBeUndefined();
    expect(stripe.updateLink).not.toHaveBeenCalled();
    configureStripe();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    stripe.updateLink.mockRejectedValue(new Error("unavailable"));
    await expect(deactivatePaymentLink("plink_test")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("[payments] Stripe link deactivation failed", "plink_test");
  });

  it("returns an honest error if link creation fails", async () => {
    const { call, paymentId } = await pendingDeposit();
    configureStripe();
    vi.spyOn(console, "error").mockImplementation(() => {});
    stripe.createLink.mockRejectedValue(new Error("unavailable"));
    expect((await call(`/payments/${paymentId}/link`, "POST")).status).toBe(502);
  });

  it("only accepts pending payments with matching user metadata and logs late payments", async () => {
    const { call, booking, paymentId } = await pendingDeposit();
    configureStripe();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    async function webhook(metadata: Record<string, string>) {
      stripe.constructEvent.mockReturnValue({
        type: "checkout.session.completed",
        data: { object: { id: "cs_test", metadata } },
      });
      const response = await app.request("/api/webhooks/stripe", {
        method: "POST", headers: { "stripe-signature": "test" }, body: "raw body",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });
    }
    async function payment() {
      const [row] = await db.select().from(schema.payments).where(and(
        eq(schema.payments.id, paymentId), eq(schema.payments.userId, booking.userId),
      ));
      return row;
    }
    await webhook({ payment_id: paymentId });
    expect(error).toHaveBeenCalledWith(paymentId, "cs_test");
    await webhook({});
    expect(error).toHaveBeenCalledWith("missing", "cs_test");
    await webhook({ payment_id: paymentId, user_id: crypto.randomUUID() });
    expect((await payment()).status).toBe("pending");
    expect((await call("/auth/me", "PATCH", { vat_registered: true, vat_rate_bp: 2300 })).status).toBe(200);
    await webhook({ payment_id: paymentId, user_id: booking.userId });
    const paid = await payment();
    expect(paid.status).toBe("paid");
    expect(paid.vatRateBp).toBe(2300);
    await call("/auth/me", "PATCH", { vat_rate_bp: 900 });
    await webhook({ payment_id: paymentId, user_id: booking.userId });
    expect((await payment()).paidAt).toEqual(paid.paidAt);
    expect((await payment()).vatRateBp).toBe(2300);

    const unregistered = await pendingDeposit();
    await webhook({ payment_id: unregistered.paymentId, user_id: unregistered.booking.userId });
    const received = await json<{ payments: { vatRateBp: number | null }[] }>(await unregistered.call(`/bookings/${unregistered.booking.id}`));
    expect(received.payments[0].vatRateBp).toBe(0);

    const cancelled = await pendingDeposit();
    await cancelled.call(`/bookings/${cancelled.booking.id}/cancel`, "POST");
    await webhook({ payment_id: cancelled.paymentId, user_id: cancelled.booking.userId });
    expect(error).toHaveBeenCalledWith(cancelled.paymentId, "cs_test");
    const detail = await json<{ payments: { status: string }[] }>(await cancelled.call(`/bookings/${cancelled.booking.id}`));
    expect(detail.payments[0].status).toBe("cancelled");
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
    expect((await bob(`/bookings/${booking.id}/complete`, "POST")).status).toBe(404);
    expect((await bob(`/bookings/${booking.id}/cancel`, "POST")).status).toBe(404);
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
    const res = await app.request("/api/auth/signup", { method: "POST", body: "{nope" });
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
