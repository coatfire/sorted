import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { documentMessage, MessageSentInput, type Booking, type BookingDocument, type IssuedDocument, type Payment } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import { messageLabel } from "../../web/src/lib/format";
import { demoBackend, resetDemo } from "../../web/src/lib/demoBackend";

afterEach(() => { vi.unstubAllGlobals(); });

async function fixture() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const token = await issueJwt(user.id, user.sessionVersion);
  const request = (path: string, body?: object, method = body ? "POST" : "GET") => app.request(`/api${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const response = await request("/bookings", { status: "confirmed", client: { name: "Eimear Kelleher", phone: "087 123 4567" }, service: "Bridal hair", price_cents: 8000, deposit_cents: 0, start_at: new Date(Date.now() - 86400000).toISOString() });
  expect(response.status).toBe(201);
  const booking = await response.json() as Booking;
  const issue = async (kind: "invoice" | "receipt", paymentId?: string) => {
    const issued = await request(`/bookings/${booking.id}/documents`, { kind, ...(paymentId ? { payment_id: paymentId } : {}) });
    expect(issued.status).toBeLessThan(300);
    return issued.json() as Promise<BookingDocument>;
  };
  const list = async () => (await request("/bookings/documents")).json() as Promise<IssuedDocument[]>;
  const sent = (documentId: string, extra: object = {}) => request(`/bookings/${booking.id}/message-sent`, { kind: "document", channel: "share", acknowledgement_id: crypto.randomUUID(), document_id: documentId, ...extra });
  return { user, request, booking, issue, list, sent };
}

describe("document message", () => {
  const details = { number: "RCT-0001", client: "Eimear", business: "Glow", service: "Bridal hair" };
  it("thanks for payment on a receipt and adds the review link only when given", () => {
    expect(documentMessage({ ...details, kind: "receipt" })).toBe("Hi Eimear, thanks for your payment. Your receipt RCT-0001 from Glow for Bridal hair is attached.");
    const withReview = documentMessage({ ...details, kind: "receipt", reviewLink: " https://g.page/r/abc/review " });
    expect(withReview.endsWith("a quick Google review would mean a lot: https://g.page/r/abc/review")).toBe(true);
    expect(documentMessage({ ...details, kind: "invoice", number: "INV-0002", reviewLink: null })).toBe("Hi Eimear, your invoice INV-0002 from Glow for Bridal hair is attached.");
    expect(documentMessage({ ...details, kind: "quote", number: "QTE-0001", reviewLink: "" })).not.toContain("review");
  });
  it("keeps document fields off other messages and requires a document id", () => {
    const acknowledgement_id = crypto.randomUUID(), document_id = crypto.randomUUID();
    expect(MessageSentInput.safeParse({ kind: "document", channel: "share", acknowledgement_id, document_id, review_included: true }).success).toBe(true);
    expect(MessageSentInput.safeParse({ kind: "document", channel: "whatsapp", acknowledgement_id }).success).toBe(false);
    expect(MessageSentInput.safeParse({ kind: "confirmation", channel: "share", acknowledgement_id }).success).toBe(false);
    expect(MessageSentInput.safeParse({ kind: "confirmation", channel: "email", acknowledgement_id, document_id }).success).toBe(false);
    expect(MessageSentInput.safeParse({ kind: "payment_request", channel: "email", acknowledgement_id, review_included: true }).success).toBe(false);
  });
});

describe("issued documents list", () => {
  it("lists a trader's documents without snapshots and records sending only on acknowledgement", async () => {
    const f = await fixture();
    const invoice = await f.issue("invoice");
    const paid = await f.request(`/bookings/${f.booking.id}/payments`, { amount_cents: 8000, method: "cash" });
    expect(paid.status).toBeLessThan(300);
    const payment = (await db.select().from(schema.payments).where(eq(schema.payments.bookingId, f.booking.id))).find(row => row.status === "paid") as unknown as Payment;
    const receipt = await f.issue("receipt", payment.id);

    const before = await f.list();
    expect(before.map(row => row.id).sort()).toEqual([invoice.id, receipt.id].sort());
    expect(before.every(row => row.sentAt === null && row.voidedAt === null && !("documentSnapshot" in row) && !("receiptSnapshot" in row))).toBe(true);

    expect((await f.sent(receipt.id, { review_included: true })).status).toBe(200);
    const after = await f.list();
    expect(after.find(row => row.id === receipt.id)!.sentAt).toEqual(expect.any(String));
    expect(after.find(row => row.id === invoice.id)!.sentAt).toBeNull();
    const [log] = await db.select().from(schema.messageLog).where(eq(schema.messageLog.bookingId, f.booking.id));
    expect(log).toMatchObject({ template: "document", meta: { userConfirmed: true, kind: "document", documentId: receipt.id, documentNumber: "RCT-0001", reviewIncluded: true } });
    expect(messageLabel({ id: log.id, bookingId: log.bookingId, template: log.template, status: "sent", sentAt: log.sentAt.toISOString(), meta: log.meta as never })).toBe("RCT-0001 with review request · you confirmed sending");
    const [row] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, f.booking.id));
    expect(row.reviewRequestedAt).toBeInstanceOf(Date);
  });

  it("does not mark a review as requested when the link was left out", async () => {
    const f = await fixture();
    const invoice = await f.issue("invoice");
    expect((await f.sent(invoice.id)).status).toBe(200);
    const [row] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, f.booking.id));
    expect(row.reviewRequestedAt).toBeNull();
  });

  it("is tenant-scoped: another trader sees nothing and cannot acknowledge the document", async () => {
    const mine = await fixture(), other = await fixture();
    const invoice = await mine.issue("invoice");
    expect(await other.list()).toEqual([]);
    expect((await other.sent(invoice.id)).status).toBe(404);
    expect((await other.request(`/bookings/${mine.booking.id}/message-sent`, { kind: "document", channel: "share", acknowledgement_id: crypto.randomUUID(), document_id: invoice.id })).status).toBe(404);
    expect((await mine.list())[0].sentAt).toBeNull();
  });

  it("rejects a document from a different booking and an unknown document", async () => {
    const f = await fixture();
    const invoice = await f.issue("invoice");
    const second = await (await f.request("/bookings", { status: "confirmed", client_id: f.booking.clientId, service: "Trial", price_cents: 5000, deposit_cents: 0, start_at: new Date(Date.now() + 86400000).toISOString() })).json() as Booking;
    expect((await f.request(`/bookings/${second.id}/message-sent`, { kind: "document", channel: "email", acknowledgement_id: crypto.randomUUID(), document_id: invoice.id })).status).toBe(404);
    expect((await f.sent(crypto.randomUUID())).status).toBe(404);
    expect((await f.request(`/bookings/${f.booking.id}/message-sent`, { kind: "document", channel: "email", acknowledgement_id: crypto.randomUUID() })).status).toBe(400);
  });
});

describe("demo parity", () => {
  it("lists issued documents and marks them sent on acknowledgement", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    resetDemo();
    const { bookings, documents } = await demoBackend.load();
    expect(documents).toEqual([]);
    const booking = bookings.find(item => item.status === "confirmed" && item.priceCents !== null)!;
    const invoice = await demoBackend.document(booking.id, "invoice");
    expect((await demoBackend.load()).documents).toEqual([expect.objectContaining({ id: invoice.id, kind: "invoice", bookingId: booking.id, sentAt: null })]);
    await expect(demoBackend.messageSent(booking.id, { kind: "document", channel: "share", acknowledgement_id: crypto.randomUUID(), document_id: crypto.randomUUID() })).rejects.toThrow("Document not found");
    await demoBackend.messageSent(booking.id, { kind: "document", channel: "share", acknowledgement_id: crypto.randomUUID(), document_id: invoice.id, review_included: false });
    expect((await demoBackend.load()).documents[0].sentAt).toEqual(expect.any(String));
  });
});
