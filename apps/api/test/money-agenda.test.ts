import { describe, expect, it } from "vitest";
import { bookingAgenda, lastYearEnd, moneyOwed, moneyYear, type Booking, type Payment, type Expense } from "@sorted/core";
import { appointmentWhen, irelandDayLabel, irelandTime } from "../../web/src/lib/today";

const now = new Date("2026-07-01T23:30:00Z");
const booking = (id: string, patch: Partial<Booking> = {}): Booking => ({ id, clientId: id, service: "Hair", priceCents: 8000, depositCents: 2000, status: "confirmed", startAt: "2026-07-02T09:00:00Z", endAt: null, location: null, notes: null, gcalEventId: null, followUpOn: null, paymentRequestedAt: null, completedAt: null, createdAt: "2026-06-01T10:00:00Z", ...patch });
const payment = (bookingId: string, amountCents: number, patch: Partial<Payment> = {}): Payment => ({ id: crypto.randomUUID(), bookingId, amountCents, kind: "custom", status: "paid", method: "cash", paidAt: "2026-06-30T23:30:00Z", createdAt: "2026-06-30T23:30:00Z", vatRateBp: 2300, linkUrl: null, ...patch });

describe("shared moneyOwed", () => {
  it("returns one oldest-job-first item per booking, not per pending row", () => {
    const rows = [booking("future", { startAt: "2026-07-03T09:00:00Z" }), booking("today"), booking("past", { status: "completed", startAt: "2026-06-30T09:00:00Z" }), booking("enquiry", { status: "enquiry" }), booking("cancelled", { status: "cancelled" }), booking("paid", { status: "completed" })];
    const payments = [payment("past", 2500), payment("paid", 8000), payment("future", 2000, { status: "pending", kind: "deposit" }), payment("future", 8000, { status: "cancelled" }), payment("past", 5500, { status: "pending" }), payment("past", 5500, { status: "pending" }), payment("orphan", 999999)];
    const result = moneyOwed(rows, payments, now);
    expect(result.dueNow.map(item => [item.booking.id, item.owedCents, item.kind])).toEqual([["past", 5500, "Balance"], ["today", 8000, "Full payment"]]);
    expect(result.comingUp.map(item => [item.booking.id, item.owedCents, item.kind])).toEqual([["future", 8000, "Full payment"]]);
    expect(result).toMatchObject({ dueNowCents: 13500, comingUpCents: 8000 });
    expect(rows.map(row => row.id)).toEqual(["future", "today", "past", "enquiry", "cancelled", "paid"]);
  });
  it("labels a wholly unpaid deposit as Deposit only when it equals the booking balance", () => {
    const future = booking("future", { startAt: "2026-07-03T09:00:00Z", priceCents: 2000 });
    expect(moneyOwed([future], [], now).comingUp[0].kind).toBe("Deposit");
    expect(moneyOwed([future], [payment("future", 500)], now).comingUp[0]).toMatchObject({ kind: "Deposit", owedCents: 1500 });
    expect(moneyOwed([{ ...future, priceCents: 8000 }], [payment("future", 2000)], now).comingUp[0].kind).toBe("Balance");
  });
  it("handles missing pending rows, empty/free/overpaid bookings and Irish midnight", () => {
    expect(moneyOwed([], [], now)).toEqual({ dueNow: [], comingUp: [], dueNowCents: 0, comingUpCents: 0 });
    expect(moneyOwed([booking("free", { priceCents: 0 }), booking("paid")], [payment("paid", 9000)], now).dueNow).toEqual([]);
    const midnight = booking("midnight", { startAt: "2026-07-01T23:45:00Z" });
    expect(moneyOwed([midnight], [], new Date("2026-07-01T22:59:59Z")).comingUpCents).toBe(8000);
    expect(moneyOwed([midnight], [], new Date("2026-07-01T23:00:00Z")).dueNowCents).toBe(8000);
    expect(() => moneyOwed([booking("bad", { startAt: "invalid" })], [], now)).toThrow();
  });
});

describe("Ireland-local agenda and next appointment", () => {
  it("groups today, upcoming, wrap-up, later and past at Ireland midnight", () => {
    const result = bookingAgenda([booking("today", { startAt: "2026-07-01T23:45:00Z" }), booking("yesterday", { startAt: "2026-07-01T22:30:00Z" }), booking("tomorrow", { startAt: "2026-07-02T23:00:00Z" }), booking("later", { startAt: "2026-08-01T09:00:00Z" }), booking("past", { status: "completed", startAt: "2026-07-01T20:00:00Z" }), booking("cancelled", { status: "cancelled" }), booking("followup", { status: "enquiry", followUpOn: "2026-07-02" })], now);
    expect(result.today).toBe("2026-07-02");
    expect(result.todays.map(row => row.id)).toEqual(["today", "followup"]);
    expect(result.upcoming.map(row => row.id)).toEqual(["tomorrow"]);
    expect(result.later.map(row => row.id)).toEqual(["later"]);
    expect(result.wrapUp.map(row => row.id)).toEqual(["yesterday"]);
    expect(result.past.map(row => row.id)).toEqual(["past"]);
    expect(result.followUps.map(row => row.id)).toEqual(["followup"]);
    expect(irelandDayLabel("2026-07-01T23:45:00Z", now)).toBe("Today");
    expect(irelandDayLabel("2026-07-02T23:00:00Z", now)).toBe("Tomorrow");
    expect(irelandTime("2026-07-01T23:45:00Z")).toBe("00:45");
  });
  it("chooses the earliest unended confirmed appointment, respecting endAt and the one-hour fallback", () => {
    const rows = [booking("future"), booking("enquiry", { status: "enquiry", startAt: "2026-07-01T23:40:00Z" }), booking("cancelled", { status: "cancelled" }), booking("over", { startAt: "2026-07-01T22:30:00Z" }), booking("now", { startAt: "2026-07-01T22:00:00Z", endAt: "2026-07-02T00:00:00Z" })];
    expect(bookingAgenda(rows, now).nextAppointment?.id).toBe("now");
    expect(bookingAgenda(rows.filter(row => row.id !== "now"), now).nextAppointment?.id).toBe("future");
    expect(bookingAgenda([], now).nextAppointment).toBeUndefined();
    expect(appointmentWhen("2026-07-01T23:00:00Z", now)).toBe("Now");
    expect(appointmentWhen("2026-07-01T23:45:00Z", now)).toBe("In 15 minutes");
    expect(appointmentWhen("2026-07-02T01:30:00Z", now)).toBe("In 2 hours");
    expect(appointmentWhen("2026-07-02T23:00:00Z", now)).toBe("Tomorrow, 00:00");
    expect(appointmentWhen("2026-07-04T13:00:00Z", now)).toMatch(/Sat.*4 Jul.*14:00/);
  });
});

describe("Money year-to-date basis", () => {
  it("uses Irish month boundaries and the same VAT-adjusted YTD figures as tax", () => {
    const settings = { vatRegistered: true, vatRateBp: 2300, vatPeriodMonths: 2, incomeTaxRateBp: 2000 };
    const payments = [payment("a", 12300), payment("a", 1230, { paidAt: "2026-06-30T22:30:00Z" }), payment("a", 12300, { paidAt: "2026-07-03T09:00:00Z" }), payment("a", 12300, { status: "pending" }), payment("a", 12300, { paidAt: "invalid" }), payment("a", 12300, { paidAt: "2025-12-31T23:59:59Z" })];
    const expenses: Expense[] = [{ id: "expense", merchant: "Supplies", amountCents: 2460, vatCents: 460, status: "confirmed", expenseDate: "2026-07-01", category: "materials", receiptKey: null, createdAt: now.toISOString() }];
    const result = moneyYear(payments, expenses, settings, now);
    expect(result.monthlyIncomeCents[5]).toBe(1000);
    expect(result.monthlyIncomeCents[6]).toBe(10000);
    expect(result.monthlyIncomeCents.reduce((a, b) => a + b, 0)).toBe(result.estimate.netIncomeCents);
    expect(result.estimate).toMatchObject({ netIncomeCents: 11000, netExpenseCents: 2000, profitCents: 9000, incomeTaxCents: 1800 });
    expect(moneyYear([], [], settings, now).monthlyIncomeCents).toEqual(Array(12).fill(0));
    expect(() => moneyYear([], [], settings, new Date("invalid"))).toThrow();
  });

  it("shows the whole of last year when asked, and nothing from this year", () => {
    const settings = { vatRegistered: false, vatRateBp: null, vatPeriodMonths: 2, incomeTaxRateBp: null };
    expect(lastYearEnd(now).toISOString()).toBe("2025-12-31T23:59:59.999Z");
    expect(lastYearEnd(new Date("2025-12-31T23:59:59Z")).toISOString()).toBe("2024-12-31T23:59:59.999Z");
    expect(lastYearEnd(new Date("2026-01-01T00:00:00Z")).toISOString()).toBe("2025-12-31T23:59:59.999Z");
    const payments = [
      payment("a", 5000, { paidAt: "2025-01-01T00:00:00Z" }), payment("a", 3000, { paidAt: "2025-12-31T23:59:59Z" }),
      payment("a", 700, { paidAt: "2024-12-31T23:59:59Z" }), payment("a", 900, { paidAt: "2026-01-01T00:00:00Z" }), payment("a", 1100),
    ].map(row => ({ ...row, vatRateBp: null }));
    const expenses: Expense[] = ["2024-12-31", "2025-01-01", "2025-12-31", "2026-01-01"].map((expenseDate, index) => ({ id: `e${index}`, merchant: "Supplies", amountCents: 1000, vatCents: null, status: "confirmed", expenseDate, category: "materials", receiptKey: null, createdAt: now.toISOString() }));
    const result = moneyYear(payments, expenses, settings, lastYearEnd(now));
    expect(result.estimate).toMatchObject({ year: 2025, netIncomeCents: 8000, netExpenseCents: 2000, profitCents: 6000 });
    expect(result.monthlyIncomeCents).toEqual([5000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3000]);
  });
});
