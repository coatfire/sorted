/// <reference path="../../web/src/vite-env.d.ts" />
import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { BookingDocument, DriveBackup } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import { PDFPage } from "../../web/node_modules/pdf-lib";
import { createBookingPdf } from "../../web/src/lib/bookingPdf";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(["invoice", "receipt", "quote"] as const)("stores a complete %s snapshot at issue time and reuses it after edits", async kind => {
  const logo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPioAAAAASUVORK5CYII=";
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com`, businessName: "Original studio", vatRegistered: true, vatRateBp: 0, vatNumber: "IE1234567AB", revolutLink: "https://revolut.me/studio", iban: "IE29AIBK93115212345678", invoiceLogo: logo }).returning();
  const [client] = await db.insert(schema.clients).values({ userId: user.id, name: "Original client", email: "client@example.com" }).returning();
  const [booking] = await db.insert(schema.bookings).values({ userId: user.id, clientId: client.id, service: "Hair", startAt: new Date("2026-11-14T10:00:00Z"), priceCents: 8000 }).returning();
  const [payment] = await db.insert(schema.payments).values({ userId: user.id, bookingId: booking.id, kind: "custom", status: "paid", method: "revolut", amountCents: 2500, vatRateBp: 0, paidAt: new Date("2026-11-14T12:00:00Z") }).returning();
  const jwt = await issueJwt(user.id, user.sessionVersion);
  const headers = { Authorization: `Bearer ${jwt}` };
  const request = () => app.request(`/api/bookings/${booking.id}/documents`, { method: "POST", headers, body: JSON.stringify({ kind, ...(kind === "receipt" ? { payment_id: payment.id } : {}) }) });
  const response = await request();
  expect(response.status).toBe(200);
  const issued = await response.json() as BookingDocument;
  expect(issued.documentSnapshot).toMatchObject({ version: 1, vatRegistered: true, data: { logo, business: { name: "Original studio", vatNumber: "IE1234567AB" }, client: { name: "Original client" }, vat: { rate: "0%" }, revolutLink: kind === "receipt" ? null : user.revolutLink } });
  await db.update(schema.users).set({ businessName: "New studio", vatRegistered: false, vatRateBp: null, vatNumber: null, revolutLink: null, iban: null, invoiceLogo: null, invoiceFooter: "Changed footer", invoiceAccent: "#000000" }).where(eq(schema.users.id, user.id));
  await db.update(schema.clients).set({ name: "New client", email: null }).where(and(eq(schema.clients.id, client.id), eq(schema.clients.userId, user.id)));
  await db.update(schema.bookings).set({ service: "Changed service", priceCents: 16000 }).where(and(eq(schema.bookings.id, booking.id), eq(schema.bookings.userId, user.id)));
  await db.update(schema.payments).set({ method: "cash", amountCents: 1000 }).where(and(eq(schema.payments.id, payment.id), eq(schema.payments.userId, user.id)));
  expect(await (await request()).json()).toEqual(issued);
  vi.stubEnv("GOOGLE_CLIENT_ID", "drive-test");
  const backup = await (await app.request("/api/drive/files", { headers })).json() as DriveBackup;
  expect(backup.logo).toBeNull();
  expect(backup.documents).toEqual([issued.documentSnapshot!.data]);
});

it("anonymises client PII in all retained snapshots and rendered PDFs without changing financial data or other clients", async () => {
  const [user, otherUser] = await db.insert(schema.users).values([
    { email: `${crypto.randomUUID()}@example.com`, vatRegistered: true, vatRateBp: 0, vatNumber: "IE1234567AB" },
    { email: `${crypto.randomUUID()}@example.com` },
  ]).returning();
  const headers = { Authorization: `Bearer ${await issueJwt(user.id, user.sessionVersion)}` };
  const otherHeaders = { Authorization: `Bearer ${await issueJwt(otherUser.id, otherUser.sessionVersion)}` };
  const [client, untouched, foreign] = await db.insert(schema.clients).values([
    { userId: user.id, name: "Private client name", email: "private-client@example.com", phone: "+353871234567" },
    { userId: user.id, name: "Unrelated client" },
    { userId: otherUser.id, name: "Other tenant client" },
  ]).returning();
  const bookings = await db.insert(schema.bookings).values([client, untouched, foreign].map(client => ({
    userId: client.userId, clientId: client.id, service: "Hair", startAt: new Date("2026-11-14T10:00:00Z"), priceCents: 8000,
  }))).returning();
  const [booking] = bookings;
  const [payment] = await db.insert(schema.payments).values({ userId: user.id, bookingId: booking.id, kind: "custom", status: "paid", method: "cash", amountCents: 2500, vatRateBp: 0, paidAt: new Date("2026-11-14T12:00:00Z") }).returning();
  const documents: BookingDocument[] = [];
  for (const kind of ["invoice", "receipt", "quote"] as const) {
    const response = await app.request(`/api/bookings/${booking.id}/documents`, { method: "POST", headers, body: JSON.stringify({ kind, payment_id: payment.id }) });
    expect(response.status).toBe(200);
    documents.push(await response.json() as BookingDocument);
  }
  const protectedDocuments: BookingDocument[] = [];
  for (const otherBooking of bookings.slice(1)) {
    const response = await app.request(`/api/bookings/${otherBooking.id}/documents`, { method: "POST", headers: otherBooking.userId === user.id ? headers : otherHeaders, body: JSON.stringify({ kind: "invoice" }) });
    expect(response.status).toBe(200);
    protectedDocuments.push(await response.json() as BookingDocument);
  }
  const [legacyBooking] = await db.insert(schema.bookings).values({ userId: user.id, clientId: client.id, service: "Hair", startAt: booking.startAt, priceCents: 8000, status: "completed" }).returning();
  const [legacy] = await db.insert(schema.invoices).values({ userId: user.id, bookingId: legacyBooking.id, kind: "invoice", number: 99 }).returning();
  await db.update(schema.bookings).set({ status: "completed" }).where(eq(schema.bookings.id, booking.id));
  const remove = (auth: typeof headers) => app.request(`/api/clients/${client.id}`, { method: "DELETE", headers: auth, body: JSON.stringify({ confirm: true }) });
  expect((await remove(otherHeaders)).status).toBe(404);
  expect(await (await remove(headers)).json()).toEqual({ outcome: "anonymised" });
  const rows = await db.select().from(schema.invoices).where(and(eq(schema.invoices.userId, user.id), eq(schema.invoices.bookingId, booking.id)));
  const font = await readFile(new URL("../../web/src/assets/DejaVuSans.ttf", import.meta.url));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(font)));
  const draw = vi.spyOn(PDFPage.prototype, "drawText");
  for (const original of documents) {
    const row = rows.find(row => row.id === original.id)!;
    expect(row.documentSnapshot).toEqual({ ...original.documentSnapshot, data: { ...original.documentSnapshot!.data, client: { name: "Deleted client", email: null, phone: null } } });
    if (original.kind !== "quote") {
      const reopened = await app.request(`/api/bookings/${booking.id}/documents`, { method: "POST", headers, body: JSON.stringify({ kind: original.kind, payment_id: payment.id }) });
      expect((await reopened.json() as BookingDocument).documentSnapshot).toEqual(row.documentSnapshot);
    }
    expect((await createBookingPdf(row.documentSnapshot!.data)).size).toBeGreaterThan(0);
  }
  const labels = draw.mock.calls.map(([text]) => text).join("\n");
  expect(labels).toContain("Deleted client");
  for (const pii of [client.name, client.email!, client.phone!]) expect(labels).not.toContain(pii);
  expect((await db.select().from(schema.invoices).where(eq(schema.invoices.id, legacy.id)))[0].documentSnapshot).toBeNull();
  for (const original of protectedDocuments) {
    const [row] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, original.id));
    expect(row.documentSnapshot).toEqual(original.documentSnapshot);
  }
  vi.stubEnv("GOOGLE_CLIENT_ID", "drive-test");
  const backup = await (await app.request("/api/drive/files", { headers })).json() as DriveBackup;
  for (const pii of [client.name, client.email!, client.phone!]) expect(JSON.stringify(backup.documents)).not.toContain(pii);
  expect(backup.documents.filter(doc => doc.client.name === "Deleted client")).toHaveLength(4);
});
