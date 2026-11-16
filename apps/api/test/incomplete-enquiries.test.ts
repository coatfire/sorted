import { afterEach, describe, expect, it, vi } from "vitest";
import { bookingAgenda, bookingStage, buildCalendar, calendarEvent, CreateBookingInput, DEFAULT_BOOKING_CONFIRMATION_TEMPLATE, dublinDateTime, moneyOwed, renderBookingMessage, taxEstimate, type Booking } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import { demoBackend, resetDemo } from "../../web/src/lib/demoBackend";
import { longDay } from "../../web/src/lib/format";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function fixture() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const token = await issueJwt(user.id, user.sessionVersion);
  const request = (path: string, body: object = {}, method = "POST") => app.request(`/api${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
  const create = (extra: object = {}) => request("/bookings", { client: { name: "Bridal client" }, service: "Bridal hair", ...extra });
  return { request, create };
}

describe("incomplete enquiry API", () => {
  it.each(["confirm", "update"])("requires an explicit start when agreeing a TBC time through %s", async action => {
    const f = await fixture();
    const booking = await (await f.create({ start_at: "2027-07-10T12:00:00Z", time_tbc: true, price_cents: 8000 })).json() as Booking;
    const path = `/bookings/${booking.id}${action === "confirm" ? "/confirm" : ""}`;
    const method = action === "confirm" ? "POST" : "PATCH";
    for (const input of [{ time_tbc: false }, { time_tbc: false, start_at: null }]) {
      const response = await f.request(path, input, method);
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "Add a time" });
    }
    expect((await f.request(`/bookings/${booking.id}/confirm`)).status).toBe(422);
    const response = await f.request(path, { time_tbc: false, start_at: "2027-07-10T09:30:00Z" }, method);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ startAt: "2027-07-10T09:30:00.000Z", timeTbc: false, status: action === "confirm" ? "confirmed" : "enquiry" });
  });
  it("saves absent details as null, returns a clear confirm 422, then confirms after a scoped update", async () => {
    const f = await fixture();
    const response = await f.create();
    expect(response.status).toBe(201);
    const booking = await response.json() as Booking;
    expect(booking).toMatchObject({ startAt: null, priceCents: null, timeTbc: false, depositCents: 0, status: "enquiry" });
    const confirmation = await f.request(`/bookings/${booking.id}/confirm`);
    expect(confirmation.status).toBe(422);
    expect(await confirmation.json()).toMatchObject({ error: expect.stringMatching(/date, time, price/) });
    expect((await f.request(`/bookings/${booking.id}`, { start_at: "2027-07-10T09:00:00Z", time_tbc: false, price_cents: 8000 }, "PATCH")).status).toBe(200);
    expect((await f.request(`/bookings/${booking.id}/confirm`)).status).toBe(200);
    expect((await f.request(`/bookings/${booking.id}`, { start_at: null }, "PATCH")).status).toBe(422);
    expect((await f.request(`/bookings/${booking.id}`, { price_cents: null }, "PATCH")).status).toBe(422);
    expect((await f.request(`/bookings/${booking.id}`, { time_tbc: true }, "PATCH")).status).toBe(422);
  });
  it.each(["2027-07-10T12:00:00Z", "2027-01-10T12:00:00Z"])("stores a dated time-TBC enquiry at Ireland midnight: %s", async start_at => {
    const f = await fixture(), response = await f.create({ start_at, time_tbc: true });
    expect(response.status).toBe(201);
    const booking = await response.json() as Booking;
    expect(dublinDateTime(booking.startAt!)).toMatchObject({ date: start_at.slice(0, 10), time: "00:00" });
    expect(booking.timeTbc).toBe(true);
    const blocked = await f.request(`/bookings/${booking.id}/confirm`);
    expect(blocked.status).toBe(422);
    expect(await blocked.json()).toMatchObject({ error: expect.stringContaining("time, price") });
    const confirmed = await f.request(`/bookings/${booking.id}/confirm`, { start_at: start_at.replace("12:00", "09:00"), time_tbc: false, price_cents: 7000 });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ status: "confirmed", timeTbc: false, priceCents: 7000 });
  });
  it("blocks no-price payments, requests, quotes and invoices, and scopes all routes to the tenant", async () => {
    const f = await fixture(), other = await fixture();
    const booking = await (await f.create()).json() as Booking;
    for (const [suffix, body] of [["payments", { amount_cents: 100, method: "cash" }], ["payment-requested", {}], ["payment-link", {}], ["documents", { kind: "quote" }], ["documents", { kind: "invoice" }]] as const) {
      const response = await f.request(`/bookings/${booking.id}/${suffix}`, body);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "Add a price first" });
      expect((await other.request(`/bookings/${booking.id}/${suffix}`, body)).status).toBe(404);
    }
    expect((await other.request(`/bookings/${booking.id}/confirm`)).status).toBe(404);
    expect((await other.request(`/bookings/${booking.id}`, { price_cents: 100 }, "PATCH")).status).toBe(404);
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
    const drive = await f.request("/drive/files", {}, "GET");
    expect(drive.status).toBe(200);
    expect(await drive.json()).toMatchObject({ years: [], documents: [] });
    const csv = await f.request("/reports/export?year=2027", {}, "GET");
    expect(csv.status).toBe(200);
    expect(await csv.text()).not.toContain("Bridal client");
  });
  it("requires full details for confirmed bookings, a price for deposits and a date for repeats", async () => {
    const f = await fixture();
    for (const extra of [{ status: "confirmed" }, { deposit_cents: 100 }, { repeat: { every_weeks: 1, count: 2 } }]) expect((await f.create(extra)).status).toBe(400);
    const booking = await (await f.create({ price_cents: 7000, deposit_cents: 1000 })).json() as Booking;
    expect((await f.request(`/bookings/${booking.id}`, { price_cents: null }, "PATCH")).status).toBe(400);
    expect((await f.request(`/bookings/${booking.id}`, { price_cents: null, deposit_cents: 0 }, "PATCH")).status).toBe(200);
  });
  it("preserves agreed details when confirmation supplies only the missing price", async () => {
    const f = await fixture();
    const booking = await (await f.create({ start_at: "2027-07-10T09:00:00Z" })).json() as Booking;
    const response = await f.request(`/bookings/${booking.id}/confirm`, { price_cents: 9000 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ startAt: booking.startAt, priceCents: 9000, status: "confirmed" });
  });
  it.each([{}, { start_at: "2027-07-10T12:00:00Z", time_tbc: true }, { start_at: "2027-07-10T12:00:00Z" }])("cancels incomplete enquiries as-is and emits their cancellation: %j", async details => {
    const f = await fixture(), other = await fixture();
    const booking = await (await f.create({ ...details, price_cents: 8000, follow_up_on: "2027-07-09" })).json() as Booking;
    const requested = await (await f.request(`/bookings/${booking.id}/payment-requested`)).json() as Booking;
    expect(requested.paymentRequestedAt).toEqual(expect.any(String));
    expect(booking.followUpOn).not.toBeNull();
    expect((await f.request(`/bookings/${booking.id}`, { price_cents: null }, "PATCH")).status).toBe(200);
    expect((await other.request(`/bookings/${booking.id}/cancel`)).status).toBe(404);
    vi.stubEnv("N8N_WEBHOOK_URL", "https://automation.example.com");
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const response = await f.request(`/bookings/${booking.id}/cancel`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "cancelled", startAt: booking.startAt, timeTbc: booking.timeTbc, priceCents: null, followUpOn: null, paymentRequestedAt: requested.paymentRequestedAt });
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ event: "booking.cancelled", booking: { id: booking.id, start_at: booking.startAt, price_cents: null } });
  });
});

const base: Booking = { id: "enquiry", clientId: "client", service: "Bridal hair", startAt: null, timeTbc: false, priceCents: null, depositCents: 0, status: "enquiry", followUpOn: "2027-07-09", paymentRequestedAt: null, endAt: null, location: null, notes: null, gcalEventId: null, completedAt: null, createdAt: "2027-07-01T12:00:00Z" };
describe("incomplete enquiry core", () => {
  it("keeps undated enquiries after dated groups, time-TBC first, follow-ups intact and confirmed-only hero", () => {
    const timed = { ...base, id: "timed", startAt: "2027-07-10T09:00:00Z", priceCents: 7000 };
    const allDay = { ...timed, id: "all-day", timeTbc: true, startAt: "2027-07-09T23:00:00Z" };
    const confirmed = { ...timed, id: "confirmed", status: "confirmed" as const };
    const agenda = bookingAgenda([base, timed, confirmed, allDay], new Date("2027-07-09T12:00:00Z"));
    expect(agenda.undated).toEqual([base]);
    expect(agenda.upcoming.map(booking => booking.id)).toEqual(["all-day", "timed", "confirmed"]);
    expect(agenda.followUps).toHaveLength(3);
    expect(agenda.nextAppointment?.id).toBe("confirmed");
    expect(bookingStage(base, [])).toEqual({ stage: "enquiry", owedCents: 0 });
    expect(moneyOwed([base, allDay, timed], [])).toMatchObject({ dueNowCents: 0, comingUpCents: 0 });
    expect(taxEstimate({ payments: [], expenses: [], settings: { vatRegistered: false, vatRateBp: null, vatPeriodMonths: 2, incomeTaxRateBp: null }, now: new Date("2027-07-09T12:00:00Z") }).netIncomeCents).toBe(0);
  });
  it("skips undated calendar entries and makes time-TBC entries all-day across DST", () => {
    const client = { name: "Client", phone: null };
    const content = buildCalendar({ name: "Enquiries", appUrl: "https://sorted.example", bookings: [{ ...base, client }, { ...base, id: "dated", startAt: "2027-07-09T23:00:00Z", timeTbc: true, client }] });
    expect(content).not.toContain("UID:enquiry@");
    expect(content).toContain("DTSTART;VALUE=DATE:20270710");
    expect(content).toContain("DTEND;VALUE=DATE:20270711");
    expect(content).toContain("Price to be agreed");
    expect(longDay("2027-07-09T23:00:00Z")).toContain("10 July");
    expect(() => calendarEvent({ ...base, client }, "https://sorted.example")).toThrow("Add a date first");
  });
  it("renders missing tokens naturally, never as midnight or a zero price", () => {
    const details = { client: "Client", business: "Studio", date: null, time: null, service: "Bridal hair", priceCents: null, depositCents: 0, balanceCents: 0, iban: null, bic: null, payLink: null };
    const message = renderBookingMessage(DEFAULT_BOOKING_CONFIRMATION_TEMPLATE, details);
    expect(message).toContain("on a date to be agreed at a time to be agreed");
    expect(message).not.toMatch(/Price:|€0|00:00|1970/);
    expect(renderBookingMessage("{date}|{time}|{price}|{deposit}|{balance}", details)).toBe("to be agreed|to be agreed|to be agreed|to be agreed|to be agreed");
    expect(CreateBookingInput.safeParse({ client: { name: "Client" }, service: "Hair" }).success).toBe(true);
  });
  it("keeps demo create, update, confirmation and financial guards aligned", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    resetDemo();
    const draft = { client: { name: "Client" }, service: "Bridal hair", startAt: null, priceCents: null, depositCents: 0, location: null, notes: null };
    const created = await demoBackend.createBooking(draft);
    const declined = await demoBackend.createBooking({ ...draft, followUpOn: "2027-07-09", priceCents: 8000 });
    await demoBackend.paymentRequested(declined.id);
    const requested = (await demoBackend.load()).bookings.find(booking => booking.id === declined.id)!;
    expect(requested.paymentRequestedAt).toEqual(expect.any(String));
    expect(requested.followUpOn).toBe("2027-07-09");
    await demoBackend.updateBooking(declined.id, draft);
    await demoBackend.cancelBooking(declined.id);
    expect((await demoBackend.load()).bookings.find(booking => booking.id === declined.id)).toMatchObject({ status: "cancelled", startAt: null, priceCents: null, followUpOn: null, paymentRequestedAt: requested.paymentRequestedAt });
    await expect(demoBackend.confirmBooking(created.id)).rejects.toThrow(/date, time, price/);
    await expect(demoBackend.paymentRequested(created.id)).rejects.toThrow("Add a price first");
    await expect(demoBackend.document(created.id, "quote")).rejects.toThrow("Add a price first");
    await expect(demoBackend.recordPayment(created.id, { amount_cents: 100, method: "cash" })).rejects.toThrow("Add a price first");
    await demoBackend.updateBooking(created.id, { ...draft, startAt: "2027-07-10T12:00:00Z", timeTbc: true });
    expect((await demoBackend.load()).bookings.find(booking => booking.id === created.id)?.startAt).toBe("2027-07-09T23:00:00.000Z");
    for (const startAt of [undefined, null]) {
      await expect(demoBackend.updateBooking(created.id, { timeTbc: false, startAt })).rejects.toThrow("Add a time");
      await expect(demoBackend.confirmBooking(created.id, { timeTbc: false, startAt })).rejects.toThrow("Add a time");
    }
    expect((await demoBackend.load()).bookings.find(booking => booking.id === created.id)).toMatchObject({ status: "enquiry", timeTbc: true, startAt: "2027-07-09T23:00:00.000Z" });
    await demoBackend.confirmBooking(created.id, { startAt: "2027-07-10T09:00:00Z", timeTbc: false, priceCents: 7000 });
    expect((await demoBackend.load()).bookings.find(booking => booking.id === created.id)).toMatchObject({ status: "confirmed", timeTbc: false, priceCents: 7000 });
  });
});
