import { afterEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { assembleBookingDocument, backupFiles, bookingStage, moneyOwed, moneyYear, planDriveBackup, taxEstimate, type BookingDocument, type DriveBackup, type Payment } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import * as events from "../src/lib/events";
import * as stripe from "../src/lib/stripe";
import { demoBackend, resetDemo } from "../../web/src/lib/demoBackend";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const edit = { amount_cents: 5000, method: "revolut", paid_at: "2025-02-01T12:00:00Z" };
async function fixture() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com`, businessName: "Studio" }).returning();
  const [client] = await db.insert(schema.clients).values({ userId: user.id, name: "Client" }).returning();
  const [booking] = await db.insert(schema.bookings).values({ userId: user.id, clientId: client.id, status: "completed", service: "Nails", startAt: new Date("2025-01-09"), priceCents: 10000 }).returning();
  const [payment] = await db.insert(schema.payments).values({ userId: user.id, bookingId: booking.id, kind: "custom", status: "paid", method: "cash", amountCents: 4000, paidAt: new Date("2025-01-10T12:00:00Z"), vatRateBp: 0 }).returning();
  const headers = { Authorization: `Bearer ${await issueJwt(user.id, user.sessionVersion)}` };
  const request = (path: string, method = "GET", body?: object) => app.request(`/api${path}`, { headers, method, body: body && JSON.stringify(body) });
  const correct = (body = edit) => request(`/payments/${payment.id}`, "PATCH", body);
  const undo = () => request(`/payments/${payment.id}/undo`, "POST");
  const receipt = () => request(`/bookings/${booking.id}/documents`, "POST", { kind: "receipt", payment_id: payment.id });
  const payments = () => db.select().from(schema.payments).where(eq(schema.payments.bookingId, booking.id));
  return { user, client, booking, payment, request, correct, undo, receipt, payments };
}

it("edits a manual payment, retaining its tax snapshot and allowing an old Stripe link marker", async () => {
  const f = await fixture();
  await db.update(schema.payments).set({ stripePaymentLinkId: "old-link" }).where(eq(schema.payments.id, f.payment.id));
  const emit = vi.spyOn(events, "emitBookingEvent").mockResolvedValue(undefined);
  expect(await (await f.correct()).json()).toMatchObject({ id: f.payment.id, amountCents: 5000, method: "revolut", paidAt: "2025-02-01T12:00:00.000Z", status: "paid", vatRateBp: 0 });
  expect(emit).toHaveBeenCalledWith(f.user.id, f.booking.id, "payment.corrected", expect.objectContaining({ id: f.payment.id }));
});

it("rejects total overpayment including the other paid rows, without changing anything", async () => {
  const f = await fixture();
  await db.insert(schema.payments).values({ userId: f.user.id, bookingId: f.booking.id, kind: "custom", status: "paid", method: "cash", amountCents: 6000 });
  expect((await f.correct()).status).toBe(409); expect((await f.payments()).find(payment => payment.id === f.payment.id)?.amountCents).toBe(4000);
});

it.each([{ amount_cents: 0 }, { amount_cents: 0.1 }, { method: "stripe" }, { paid_at: "bad" }, { paid_at: "2099-01-01T12:00:00Z" }])("rejects invalid edits %j", async extra => {
  const f = await fixture(); expect((await f.correct({ ...edit, ...extra })).status).toBe(400);
});

it("blocks edits once a receipt exists", async () => {
  const f = await fixture(); expect((await f.receipt()).status).toBe(200);
  const response = await f.correct(); expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "A receipt was issued for this payment. Undo it and record it again." });
});

it.each([null, "stripe-link"])("blocks editing and undoing card payments (link marker: %s)", async stripePaymentLinkId => {
  const f = await fixture(); await db.update(schema.payments).set({ method: "stripe", stripePaymentLinkId }).where(eq(schema.payments.id, f.payment.id));
  for (const response of [await f.correct(), await f.undo()]) {
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: "Paid by card — refund it in Stripe" });
  }
  expect((await f.payments())[0].status).toBe("paid");
});

it.each([false, true])("undo retains the payment and frozen receipt, with receipt issued: %s", async issued => {
  const f = await fixture();
  const receipt = issued ? await (await f.receipt()).json() as BookingDocument : null;
  const emit = vi.spyOn(events, "emitBookingEvent").mockResolvedValue(undefined);
  const result = await f.undo(); expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ id: f.payment.id, status: "cancelled", amountCents: 4000, method: "cash", paidAt: f.payment.paidAt!.toISOString() });
  expect((await db.select().from(schema.bookings).where(eq(schema.bookings.id, f.booking.id)))[0].status).toBe("completed");
  expect(emit).toHaveBeenCalledWith(f.user.id, f.booking.id, "payment.undone", expect.objectContaining({ id: f.payment.id }));
  if (receipt) {
    const document = await (await f.receipt()).json() as BookingDocument;
    expect(document.voidedAt).toBeTruthy(); expect(document.id).toBe(receipt.id);
    expect(document.receiptSnapshot).toEqual(receipt.receiptSnapshot); expect(document.documentSnapshot).toEqual(receipt.documentSnapshot);
    const data = assembleBookingDocument(
      { ...f.user, createdAt: f.user.createdAt.toISOString(), emailVerifiedAt: f.user.emailVerifiedAt?.toISOString() ?? null, driveBackedUpAt: f.user.driveBackedUpAt?.toISOString() ?? null },
      { ...f.booking, startAt: f.booking.startAt.toISOString(), endAt: null, completedAt: null, paymentRequestedAt: null, createdAt: f.booking.createdAt.toISOString() },
      { ...f.client, createdAt: f.client.createdAt.toISOString() }, [], document,
    );
    expect(data.voided).toBe(true); expect(data.total).toBe(receipt.documentSnapshot!.data.total);
  } else expect(await db.select().from(schema.invoices).where(eq(schema.invoices.bookingId, f.booking.id))).toEqual([]);
  expect((await f.undo()).status).toBe(409); expect((await f.correct()).status).toBe(409);
});

it("excludes undone payments from totals, tax, yearly income, CSVs and refreshed Drive backups", async () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  const f = await fixture(); await f.receipt(); await f.undo();
  const payments = (await f.payments()).map(payment => ({ ...payment, paidAt: payment.paidAt?.toISOString() ?? null, createdAt: payment.createdAt.toISOString() }));
  const booking = { ...f.booking, startAt: f.booking.startAt.toISOString() }, now = new Date("2025-12-31");
  expect(bookingStage(booking, payments, now)).toEqual({ stage: "owing", owedCents: 10000 });
  expect(moneyOwed([booking], payments, now).dueNowCents).toBe(10000);
  expect(taxEstimate({ payments, expenses: [], settings: f.user, now }).yearIncomeCents).toBe(0);
  expect(moneyYear(payments, [], f.user, now).monthlyIncomeCents).toEqual(Array(12).fill(0));
  const csv = await (await f.request("/reports/export?year=2025")).text(); expect(csv).not.toContain('"40.00"');
  const backup = await (await f.request("/drive/files")).json() as DriveBackup;
  expect(backup.years).toEqual([2025]); expect(backup.documents[0].voided).toBe(true);
  const plan = planDriveBackup(backupFiles(backup), [{ path: "Receipts/RCT-0001.pdf", id: "existing-receipt" }, { path: "sorted-2025.csv", id: "existing-csv" }]);
  expect(plan.map(file => file.action)).toEqual(["update", "update"]);
  const listed = await (await f.request("/payments")).json() as { payment: Payment; receiptVoidedAt: string | null }[];
  expect(listed[0].receiptVoidedAt).toBeTruthy();
});

it("keeps all corrections tenant-scoped and requires authentication", async () => {
  const owner = await fixture(), other = await fixture();
  expect((await app.request(`/api/payments/${owner.payment.id}/undo`, { method: "POST" })).status).toBe(401);
  expect((await other.request(`/payments/${owner.payment.id}`, "PATCH", edit)).status).toBe(404);
  expect((await other.request(`/payments/${owner.payment.id}/undo`, "POST")).status).toBe(404);
  expect((await owner.payments())[0].status).toBe("paid");
});

it.each(["edit", "undo"] as const)("locks users → clients → bookings → payments → invoices for %s", async action => {
  const f = await fixture(), query = db.select().from(schema.clients);
  const locks = vi.spyOn(Object.getPrototypeOf(query) as typeof query, "for");
  expect((await (action === "edit" ? f.correct() : f.undo())).status).toBe(200);
  const tables = locks.mock.contexts.map(query => (query as { toSQL(): { sql: string } }).toSQL().sql).map(sql => sql.match(/for (?:share|update) of "(\w+)"$/)?.[1] ?? sql.match(/from "(\w+)"/)![1]);
  expect(tables).toEqual(["users", "clients", "bookings", "payments", "invoices"]);
});

it("rolls back and retries a deadlock without duplicating undo or receipt mutation events", async () => {
  const f = await fixture(); await f.receipt();
  const transaction = db.transaction.bind(db), emit = vi.spyOn(events, "emitBookingEvent").mockResolvedValue(undefined);
  const spy = vi.spyOn(db, "transaction").mockImplementationOnce((work, config) => transaction(async tx => { await work(tx); throw Object.assign(new Error("deadlock"), { code: "40P01" }); }, config));
  expect((await f.undo()).status).toBe(200); expect(spy).toHaveBeenCalledTimes(2); expect(emit).toHaveBeenCalledTimes(1);
  expect((await f.payments())).toHaveLength(1); expect((await (await f.receipt()).json() as BookingDocument).voidedAt).toBeTruthy();
});

it("serialises competing edits against the booking's total", async () => {
  const f = await fixture();
  const [other] = await db.insert(schema.payments).values({ userId: f.user.id, bookingId: f.booking.id, kind: "custom", status: "paid", method: "cash", amountCents: 1000 }).returning();
  const responses = await Promise.all([f.correct({ ...edit, amount_cents: 8000 }), f.request(`/payments/${other.id}`, "PATCH", { ...edit, amount_cents: 8000 })]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  expect((await f.payments()).reduce((sum, payment) => sum + payment.amountCents, 0)).toBeLessThanOrEqual(10000);
});

it("serialises receipt issuance against undo without leaving an unvoided receipt", async () => {
  const f = await fixture();
  const [receipt, undo] = await Promise.all([f.receipt(), f.undo()]);
  expect(undo.status).toBe(200); expect([200, 400]).toContain(receipt.status);
  const documents = await db.select().from(schema.invoices).where(eq(schema.invoices.paymentId, f.payment.id));
  expect(documents.every(document => document.voidedAt !== null)).toBe(true);
});

it("rejects an empty edit", async () => {
  const f = await fixture(); expect((await f.request(`/payments/${f.payment.id}`, "PATCH", {})).status).toBe(400);
});

it.each([{ amount_cents: 5000 }, { method: "revolut" }, { paid_at: edit.paid_at }])("supports partial edits %j without replacing omitted fields", async patch => {
  const f = await fixture();
  const response = await f.request(`/payments/${f.payment.id}`, "PATCH", patch); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ amountCents: patch.amount_cents ?? 4000, method: patch.method ?? "cash", paidAt: patch.paid_at ? new Date(patch.paid_at).toISOString() : f.payment.paidAt!.toISOString() });
});

it("preserves undone payments and voided receipts when their client is anonymised", async () => {
  const f = await fixture(); await f.receipt(); await f.undo();
  expect(await (await f.request(`/clients/${f.client.id}`, "DELETE", { confirm: true })).json()).toEqual({ outcome: "anonymised" });
  expect((await f.payments())[0].status).toBe("cancelled");
  expect((await db.select().from(schema.invoices).where(eq(schema.invoices.paymentId, f.payment.id)))[0].voidedAt).toBeTruthy();
});

it("cancels stale pending links after commit when a correction changes the balance", async () => {
  const f = await fixture(), deactivate = vi.spyOn(stripe, "deactivatePaymentLink").mockImplementation(async () => { expect((await f.payments()).find(payment => payment.id === f.payment.id)?.amountCents).toBe(5000); });
  const [pending] = await db.insert(schema.payments).values({ userId: f.user.id, bookingId: f.booking.id, kind: "balance", amountCents: 6000, stripePaymentLinkId: "pending-link" }).returning();
  expect((await f.correct()).status).toBe(200); expect((await f.payments()).find(payment => payment.id === pending.id)?.status).toBe("cancelled");
  expect(deactivate).toHaveBeenCalledWith("pending-link");
});

it("mirrors edits, receipt protection, undo and export exclusion in the demo", async () => {
  const values = new Map<string, string>(); vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  resetDemo(); const before = await demoBackend.load(), payment = before.payments.find(payment => payment.status === "paid" && payment.method !== "stripe")!;
  await demoBackend.editPayment(payment.id, { amount_cents: 1, method: "revolut", paid_at: edit.paid_at });
  const receipt = await demoBackend.document(payment.bookingId, "receipt", payment.id);
  await expect(demoBackend.editPayment(payment.id, { ...edit, method: "cash" })).rejects.toThrow("A receipt was issued");
  await demoBackend.undoPayment(payment.id);
  const after = await demoBackend.load(); expect(after.payments.find(item => item.id === payment.id)).toMatchObject({ status: "cancelled", amountCents: 1, receiptVoidedAt: expect.any(String) });
  const voided = await demoBackend.document(payment.bookingId, "receipt", payment.id);
  expect(voided.documentSnapshot).toEqual(receipt.documentSnapshot); expect(voided.voidedAt).toBeTruthy();
  expect(await (await demoBackend.exportCsv(2025)).text()).not.toContain('"0.01"');
});
