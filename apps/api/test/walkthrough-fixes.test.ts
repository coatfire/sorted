import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { addCalendarDays, CreateClientInput, irelandToday, moneyOwed, UpdateClientInput, type Booking, type MessageSentInput } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import { directionsLink, messageLabel, paymentRecordedToast, whatsappLink } from "../../web/src/lib/format";
import { demoBackend, resetDemo } from "../../web/src/lib/demoBackend";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function fixture() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const token = await issueJwt(user.id, user.sessionVersion);
  const request = (path: string, body: object = {}, method = "POST") => app.request(`/api${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const create = async (status = "enquiry") => {
    const response = await request("/bookings", { status, client: { name: "Eimear Kelleher", phone: "(087) 123-4567" }, service: "Hair", price_cents: 8000, deposit_cents: 2000, start_at: new Date(Date.now() + 7 * 86400000).toISOString() });
    expect(response.status).toBe(201);
    return response.json() as Promise<Booking>;
  };
  const read = async (id: string) => (await db.select().from(schema.bookings).where(eq(schema.bookings.id, id)))[0];
  const history = (id: string) => db.select().from(schema.messageLog).where(eq(schema.messageLog.bookingId, id));
  return { user, request, create, read, history };
}

describe("WhatsApp numbers", () => {
  it.each([
    ["087 123 4567", "353871234567"], ["(086) 123-4567", "353861234567"],
    ["+353 (87) 123-4567", "353871234567"], ["00353 87 123 4567", "353871234567"],
    ["353871234567", "353871234567"], ["+44 (7700) 900-123", "447700900123"],
    ["447700900123", "447700900123"], ["+65 8123 4567", "6581234567"], ["6581234567", "6581234567"],
    ["+47 912 34 567", "4791234567"], ["4791234567", "4791234567"],
  ])("normalises saved and previously stored %s", (phone, expected) => {
    expect(CreateClientInput.parse({ name: "Client", phone }).phone).toBe(expected);
    expect(UpdateClientInput.parse({ phone }).phone).toBe(expected);
    expect(whatsappLink(phone, "Hi Áine")).toBe(`https://wa.me/${expected}?text=Hi%20%C3%81ine`);
    expect(whatsappLink(CreateClientInput.parse({ name: "Client", phone }).phone!, "")).toBe(`https://wa.me/${expected}?text=`);
  });
  it("allows omitted/cleared mobiles but rejects invalid values", () => {
    expect(CreateClientInput.parse({ name: "Client" }).phone).toBeUndefined();
    expect(UpdateClientInput.parse({ phone: null }).phone).toBeNull();
    for (const phone of ["", "not a number", "123", "+1234567890123456"]) expect(UpdateClientInput.safeParse({ phone }).success).toBe(false);
  });
  it("normalises inline creation and direct client saves at the API boundary", async () => {
    const f = await fixture();
    const booking = await f.create();
    expect((await db.select().from(schema.clients).where(eq(schema.clients.id, booking.clientId)))[0].phone).toBe("353871234567");
    expect(await (await f.request(`/clients/${booking.clientId}`, { phone: "00353 (86) 987-6543" }, "PATCH")).json()).toMatchObject({ phone: "353869876543" });
    expect(await (await f.request("/clients", { name: "International", phone: "+44 (7700) 900123" })).json()).toMatchObject({ phone: "447700900123" });
  });
});

describe("explicit message acknowledgement", () => {
  it.each(["confirmation", "payment_request", "follow_up"] as const)("records %s only at acknowledgement, and retries idempotently", async kind => {
    const f = await fixture();
    const booking = await f.create();
    const before = await f.read(booking.id);
    expect(await f.history(booking.id)).toEqual([]);
    const input: MessageSentInput = { kind, channel: "whatsapp", acknowledgement_id: crypto.randomUUID() };
    expect((await f.request(`/bookings/${booking.id}/message-sent`, input)).status).toBe(200);
    const saved = await f.read(booking.id);
    expect(saved.status).toBe("enquiry");
    expect(saved.followUpOn).toBe(kind === "follow_up" ? addCalendarDays(irelandToday(), 3) : before.followUpOn);
    if (kind === "payment_request") expect(saved.paymentRequestedAt).not.toBeNull();
    else expect(saved.paymentRequestedAt).toBeNull();
    const history = await f.history(booking.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ channel: "whatsapp", template: kind === "follow_up" ? "reminder" : kind, meta: { userConfirmed: true, kind, acknowledgementId: input.acknowledgement_id } });
    expect((await f.request(`/bookings/${booking.id}/message-sent`, input)).status).toBe(200);
    expect(await f.read(booking.id)).toEqual(saved);
    expect(await f.history(booking.id)).toHaveLength(1);
    expect(await db.select().from(schema.payments).where(eq(schema.payments.bookingId, booking.id))).toEqual([]);
    expect(await db.select().from(schema.invoices).where(eq(schema.invoices.bookingId, booking.id))).toEqual([]);
  });
  it("acknowledges email and labels history as user-confirmed, not verified delivery", async () => {
    const f = await fixture();
    const booking = await f.create();
    await f.request(`/bookings/${booking.id}/message-sent`, { kind: "follow_up", channel: "email", acknowledgement_id: crypto.randomUUID() });
    expect((await f.history(booking.id))[0].channel).toBe("email");
    expect(messageLabel({ id: "log", bookingId: booking.id, template: "reminder", status: "sent", sentAt: new Date().toISOString(), meta: { userConfirmed: true, kind: "follow_up" } })).toBe("Follow-up · you confirmed sending");
  });
  it.each(["confirm", "cancel"])("%s resolves only the enquiry follow-up, preserving payment reminders", async action => {
    const f = await fixture();
    const enquiry = await f.create(), unrelated = await f.create("confirmed");
    const timestamp = new Date("2026-11-01T12:00:00Z");
    await db.update(schema.bookings).set({ paymentRequestedAt: timestamp }).where(eq(schema.bookings.userId, f.user.id));
    await f.request(`/bookings/${enquiry.id}/message-sent`, { kind: "follow_up", channel: "email", acknowledgement_id: crypto.randomUUID() });
    expect((await f.request(`/bookings/${enquiry.id}/${action}`)).status).toBe(200);
    expect(await f.read(enquiry.id)).toMatchObject({ followUpOn: null, paymentRequestedAt: timestamp });
    expect((await f.read(unrelated.id)).paymentRequestedAt).toEqual(timestamp);
    expect((await f.request(`/bookings/${enquiry.id}/message-sent`, { kind: "follow_up", channel: "email", acknowledgement_id: crypto.randomUUID() })).status).toBe(409);
    expect((await f.read(enquiry.id)).followUpOn).toBeNull();
  });
  it("validates acknowledgements and isolates tenants without changing follow-ups", async () => {
    const f = await fixture(), other = await fixture();
    const booking = await f.create();
    const before = await f.read(booking.id);
    const input = { kind: "follow_up", channel: "email", acknowledgement_id: crypto.randomUUID() };
    expect((await other.request(`/bookings/${booking.id}/message-sent`, input)).status).toBe(404);
    expect((await f.request(`/bookings/${crypto.randomUUID()}/message-sent`, input)).status).toBe(404);
    expect((await f.request(`/bookings/${booking.id}/message-sent`, {})).status).toBe(400);
    expect((await f.request(`/bookings/${booking.id}/message-sent`, { ...input, channel: "sms" })).status).toBe(400);
    expect((await app.request(`/api/bookings/${booking.id}/message-sent`, { method: "POST", body: JSON.stringify(input) })).status).toBe(401);
    expect(await f.read(booking.id)).toEqual(before);
    expect(await f.history(booking.id)).toEqual([]);
  });
  it("rolls back reminder changes if recording contact history fails", async () => {
    const f = await fixture();
    const booking = await f.create();
    const before = await f.read(booking.id);
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementation((work, config) => transaction(async tx => {
      vi.spyOn(tx, "insert").mockImplementation(() => { throw new Error("History unavailable"); });
      return work(tx);
    }, config));
    expect((await f.request(`/bookings/${booking.id}/message-sent`, { kind: "follow_up", channel: "email", acknowledgement_id: crypto.randomUUID() })).status).toBe(500);
    expect(await f.read(booking.id)).toEqual(before);
    expect(await f.history(booking.id)).toEqual([]);
  });
});

it("demo mirrors acknowledgements, repeated follow-ups, resolving enquiries and Coming up payment totals", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  resetDemo();
  const before = await demoBackend.load();
  const created = await demoBackend.createBooking({ status: "enquiry", client: { name: "Eimear Kelleher", phone: "087 123-4567" }, service: "Hair", startAt: new Date(Date.now() + 7 * 86400000).toISOString(), priceCents: 8000, depositCents: 0, location: null, notes: null });
  expect((await demoBackend.load()).clients.find(client => client.name === "Eimear Kelleher")?.phone).toBe("353871234567");
  expect(await demoBackend.messages(created.id)).toEqual([]);
  const input: MessageSentInput = { kind: "follow_up", channel: "whatsapp", acknowledgement_id: crypto.randomUUID() };
  await demoBackend.messageSent(created.id, input);
  await demoBackend.messageSent(created.id, input);
  expect(await demoBackend.messages(created.id)).toHaveLength(1);
  expect((await demoBackend.load()).bookings.find(booking => booking.id === created.id)).toMatchObject({ status: "enquiry", followUpOn: addCalendarDays(irelandToday(), 3), paymentRequestedAt: null });
  await demoBackend.messageSent(created.id, { ...input, acknowledgement_id: crypto.randomUUID() });
  expect(await demoBackend.messages(created.id)).toHaveLength(2);
  await demoBackend.confirmBooking(created.id);
  const confirmed = await demoBackend.load();
  expect(confirmed.bookings.find(booking => booking.id === created.id)).toMatchObject({ status: "confirmed", followUpOn: null });
  expect(await demoBackend.messages(created.id)).toHaveLength(2);
  const expected = moneyOwed(confirmed.bookings, confirmed.payments).comingUpCents;
  await demoBackend.recordPayment(created.id, { amount_cents: 6500, method: "cash" });
  const paid = await demoBackend.load();
  expect(moneyOwed(paid.bookings, paid.payments).comingUpCents).toBe(expected - 6500);
  expect(paymentRecordedToast("Eimear Kelleher", 6500)).toBe("Marked Eimear Kelleher €65.00 paid");
  await demoBackend.cancelBooking(created.id);
  expect((await demoBackend.load()).bookings.find(booking => booking.id === created.id)?.followUpOn).toBeNull();
  await expect(demoBackend.messageSent(created.id, { ...input, acknowledgement_id: crypto.randomUUID() })).rejects.toThrow("Only enquiries");
  expect((await demoBackend.load()).bookings.filter(booking => before.bookings.some(item => item.id === booking.id))).toEqual(before.bookings);
});

it("adds Ireland to a directions link unless the address already names a country", () => {
  const destination = (location: string) => decodeURIComponent(directionsLink(location).split("destination=")[1]);
  expect(destination("7 West Village, Ballincollig, Cork")).toBe("7 West Village, Ballincollig, Cork, Ireland");
  expect(destination("12 Main St, Cork, ")).toBe("12 Main St, Cork, Ireland");
  expect(destination("12 Main St, Cork, Ireland")).toBe("12 Main St, Cork, Ireland");
  expect(destination("3 High St, Newry, UK")).toBe("3 High St, Newry, UK");
});
