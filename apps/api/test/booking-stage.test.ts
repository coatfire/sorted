import { describe, expect, it } from "vitest";
import { bookingStage, type Booking, type Payment } from "@sorted/core";
import { bookingPaymentPhrase, nextBookingDate, unpaidDepositCents } from "../../web/src/lib/bookingDetail";

const now = new Date("2026-11-15T12:00:00Z");
const booking = { id: "booking", status: "confirmed", startAt: "2026-11-16T10:00:00Z", priceCents: 8000 } satisfies Pick<Booking, "id" | "status" | "startAt" | "priceCents">;
const payment = { bookingId: "booking", amountCents: 2500, status: "paid" } satisfies Pick<Payment, "bookingId" | "amountCents" | "status">;

describe("bookingStage", () => {
  it.each([
    { status: "enquiry", stage: "enquiry" },
    { status: "confirmed", stage: "upcoming" },
    { status: "completed", stage: "owing" },
    { status: "cancelled", stage: "cancelled" },
  ] as const)("classifies $status with €55 owed as $stage", ({ status, stage }) => {
    expect(bookingStage({ ...booking, status }, [payment], now)).toEqual({ stage, owedCents: 5500 });
  });
  it.each(["2026-11-15T12:00:00Z", "2026-11-15T00:00:00Z", "2026-11-14T10:00:00Z"])("treats started and past appointments as due: %s", startAt => {
    expect(bookingStage({ ...booking, startAt }, [], now)).toEqual({ stage: "due", owedCents: 8000 });
  });
  it("counts only this booking's paid payments, ignoring cancelled and pending rows", () => {
    const payments = [payment, { ...payment, status: "cancelled" as const, amountCents: 8000 }, { ...payment, status: "pending" as const, amountCents: 5500 }, { ...payment, bookingId: "other", amountCents: 8000 }];
    expect(bookingStage({ ...booking, status: "completed" }, payments, now)).toEqual({ stage: "owing", owedCents: 5500 });
    expect(bookingStage({ ...booking, status: "completed" }, [...payments, { ...payment, amountCents: 5500 }], now)).toEqual({ stage: "paid", owedCents: 0 });
  });
  it("treats free and overpaid completed bookings as paid without negative balances", () => {
    expect(bookingStage({ ...booking, status: "completed", priceCents: 0 }, [], now)).toEqual({ stage: "paid", owedCents: 0 });
    expect(bookingStage({ ...booking, status: "completed" }, [{ ...payment, amountCents: 8500 }], now)).toEqual({ stage: "paid", owedCents: 0 });
    expect(bookingStage(booking, [{ ...payment, amountCents: 8000 }], now)).toEqual({ stage: "upcoming", owedCents: 0 });
  });
  it("changes stage at the actual start, matching Today’s in-future versus Now phrasing", () => {
    const summer = { ...booking, startAt: "2026-07-01T23:30:00Z" };
    expect(bookingStage(summer, [], new Date("2026-07-01T22:59:59Z")).stage).toBe("upcoming");
    expect(bookingStage(summer, [], new Date("2026-07-01T23:00:00Z")).stage).toBe("upcoming");
    expect(bookingStage(summer, [], new Date("2026-07-01T23:29:59Z")).stage).toBe("upcoming");
    expect(bookingStage(summer, [], new Date("2026-07-01T23:30:00Z")).stage).toBe("due");
    expect(bookingStage({ ...booking, startAt: "2026-11-15T23:59:00Z" }, [], now).stage).toBe("upcoming");
    expect(bookingStage({ ...booking, startAt: "2026-11-16T00:30:00Z" }, [], new Date("2026-11-15T23:59:59Z")).stage).toBe("upcoming");
  });
  it("uses instants across both Irish clock changes", () => {
    expect(bookingStage({ ...booking, startAt: "2026-03-29T23:30:00Z" }, [], new Date("2026-03-29T23:05:00Z")).stage).toBe("upcoming");
    expect(bookingStage({ ...booking, startAt: "2026-10-25T00:30:00Z" }, [], new Date("2026-10-24T23:30:00Z")).stage).toBe("upcoming");
  });
  it("rejects invalid dates for confirmed bookings rather than silently assigning a stage", () => {
    expect(() => bookingStage({ ...booking, startAt: "invalid" }, [], now)).toThrow();
    expect(() => bookingStage(booking, [], new Date("invalid"))).toThrow();
  });
});

describe("booking payment descriptions", () => {
  it("computes the unpaid agreed deposit from price minus paid, even without pending rows after undo", () => {
    const withDeposit = { ...booking, depositCents: 2000 };
    expect(unpaidDepositCents(withDeposit, 8000)).toBe(2000);
    expect(unpaidDepositCents(withDeposit, 7000)).toBe(1000);
    expect(unpaidDepositCents(withDeposit, 6000)).toBe(0);
    expect(unpaidDepositCents(withDeposit, 0)).toBe(0);
    expect(unpaidDepositCents({ ...withDeposit, depositCents: 10000 }, 8000)).toBe(8000);
  });
  it("separates work status from payment copy", () => {
    expect(bookingPaymentPhrase("upcoming", 8000, 2000)).toBe("€20.00 deposit due");
    expect(bookingPaymentPhrase("owing", 5500, 0)).toBe("€55.00 to pay");
    expect(bookingPaymentPhrase("paid", 0, 0)).toBe("Paid in full");
    for (const stage of ["enquiry", "cancelled", "due", "upcoming"] as const) expect(bookingPaymentPhrase(stage, 8000, 0)).toBeNull();
    expect(nextBookingDate("2026-07-01T23:30:00Z")).toMatch(/Thursday.*2 July.*00:30/);
  });
});
