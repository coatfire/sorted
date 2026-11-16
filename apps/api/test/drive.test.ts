import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { backupFiles, planDriveBackup, type DriveBackup, type BookingDocumentData } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";

beforeEach(() => { vi.stubEnv("GOOGLE_CLIENT_ID", "drive-test-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", ""); });
afterEach(() => vi.unstubAllEnvs());

async function account() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const [client] = await db.insert(schema.clients).values({ userId: user.id, name: "Backup client" }).returning();
  const jwt = await issueJwt(user.id, user.sessionVersion);
  const request = (path = "/files", method = "GET") => app.request(`/api/drive${path}`, { method, headers: { Authorization: `Bearer ${jwt}` } });
  const seed = async () => {
    const [booking] = await db.insert(schema.bookings).values({ userId: user.id, clientId: client.id, service: user.id, startAt: new Date("2025-07-01"), priceCents: 12000 }).returning();
    const document = async (body: object) => app.request(`/api/bookings/${booking.id}/documents`, { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) });
    await document({ kind: "invoice" }); await document({ kind: "quote" });
    const [payment] = await db.insert(schema.payments).values({ userId: user.id, bookingId: booking.id, kind: "custom", status: "paid", amountCents: 5000, paidAt: new Date("2024-08-02") }).returning();
    await document({ kind: "receipt", payment_id: payment.id });
    await db.update(schema.bookings).set({ status: "confirmed" }).where(eq(schema.bookings.id, booking.id));
    const [receipt] = await db.insert(schema.receipts).values({ userId: user.id, contentType: "image/png", dataBase64: "eA==" }).returning();
    const [expense] = await db.insert(schema.expenses).values({ userId: user.id, receiptKey: receipt.id, merchant: "Supplies", amountCents: 500, expenseDate: new Date("2023-10-01"), status: "confirmed" }).returning();
    return { booking, expense };
  };
  return { user, request, seed };
}

describe("Drive backup API", () => {
  it("publishes the public client ID and gates Drive independently from Google sign-in", async () => {
    const health = await (await app.request("/api/health")).json();
    expect(health).toMatchObject({ googleClientId: "drive-test-client", features: { googleDrive: true, googleSignIn: false } });
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    expect(await (await app.request("/api/health")).json()).toMatchObject({ googleClientId: null, features: { googleDrive: false } });
    const f = await account();
    expect((await f.request()).status).toBe(404);
    expect((await f.request("/backed-up", "POST")).status).toBe(404);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, f.user.id));
    expect(user.driveBackedUpAt).toBeNull();
  });
  it("requires authentication and lists only issued documents, owned photos and financial years", async () => {
    expect((await app.request("/api/drive/files")).status).toBe(401);
    expect((await app.request("/api/drive/backed-up", { method: "POST" })).status).toBe(401);
    const owner = await account(), other = await account();
    const own = await owner.seed(); await other.seed();
    const response = await owner.request();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const backup = await response.json() as DriveBackup;
    expect(backup.userId).toBe(owner.user.id);
    expect(backup.documents.map((item) => item.number).sort()).toEqual(["INV-0001", "QTE-0001", "RCT-0001"]);
    expect(backup.documents.every((item) => item.lineItem.description.startsWith(owner.user.id))).toBe(true);
    expect(backup.photos).toEqual([{ id: own.expense.id, receiptKey: own.expense.receiptKey, date: "2023-10-01", merchant: "Supplies", contentType: "image/png" }]);
    expect(backup.years).toEqual([2023, 2024]);
    const empty = await account();
    expect(await (await empty.request()).json()).toEqual({ userId: empty.user.id, logo: null, documents: [], photos: [], years: [] });
  });
  it("sets only the authenticated user's completion timestamp", async () => {
    const owner = await account(), other = await account();
    const before = Date.now();
    const response = await owner.request("/backed-up", "POST");
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(new Date(result.driveBackedUpAt).getTime()).toBeGreaterThanOrEqual(before);
    const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, owner.user.id));
    expect(updated.driveBackedUpAt!.toISOString()).toBe(result.driveBackedUpAt);
    const [untouched] = await db.select().from(schema.users).where(eq(schema.users.id, other.user.id));
    expect(untouched.driveBackedUpAt).toBeNull();
  });
});

describe("Drive backup planning", () => {
  it("refreshes historical root CSVs absent from current financial years, including an empty account", () => {
    const existing = [{ path: "sorted-2024.csv", id: "old-year" }, { path: "Receipts/sorted-2023.csv", id: "nested" }, { path: "sorted-not-a-year.csv", id: "unrelated" }];
    expect(planDriveBackup([{ path: "sorted-2026.csv", kind: "csv", index: 2026 }], existing)).toMatchObject([
      { index: 2026, action: "create" }, { index: 2024, action: "update", id: "old-year" },
    ]);
    expect(planDriveBackup([], existing)).toEqual([{ path: "sorted-2024.csv", kind: "csv", index: 2024, id: "old-year", action: "update" }]);
  });
  it("creates missing files, skips existing documents/photos and updates every existing CSV in place", () => {
    const plan = planDriveBackup([
      { path: "Invoices/INV-0001.pdf", kind: "document", index: 0 },
      { path: "Quotes/QTE-0001.pdf", kind: "document", index: 1 },
      { path: "Expense photos/photo.png", kind: "photo", index: 0 },
      { path: "sorted-2024.csv", kind: "csv", index: 2024 },
      { path: "sorted-2026.csv", kind: "csv", index: 2026 },
    ], ["Invoices/INV-0001.pdf", "Expense photos/photo.png", "sorted-2024.csv", "sorted-2026.csv"].map((path) => ({ path, id: path })));
    expect(plan.map((item) => item.action)).toEqual(["skip", "create", "skip", "update", "update"]);
    expect(plan.at(-1)?.id).toBe("sorted-2026.csv");
    expect(planDriveBackup([], [])).toEqual([]);
  });
  it("uses stable document paths, safe photo names/extensions and unique financial years", () => {
    const files = backupFiles({ userId: "user", logo: null, documents: [{ kind: "receipt", number: "RCT-0001" }, { kind: "quote", number: "QTE-0001" }] as BookingDocumentData[], photos: [
      { id: "id", receiptKey: "key", date: "2026-07-01", merchant: "A/B \\ Shop", contentType: "image/png" },
      { id: "id2", receiptKey: "key2", date: "2026-07-02", merchant: null, contentType: "image/jpeg" },
    ], years: [2026, 2024, 2026] });
    expect(files.map((file) => file.path)).toEqual(["Receipts/RCT-0001.pdf", "Quotes/QTE-0001.pdf", "Expense photos/2026-07-01-AB  Shop-id.png", "Expense photos/2026-07-02-receipt-id2.jpg", "sorted-2024.csv", "sorted-2026.csv"]);
    expect(backupFiles({ userId: "user", logo: null, documents: [], photos: [], years: [] })).toEqual([]);
  });
});
