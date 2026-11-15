import { afterEach, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { BookingDocument, DriveBackup } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";

afterEach(() => vi.unstubAllEnvs());

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
