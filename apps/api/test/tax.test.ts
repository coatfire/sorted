import { describe, expect, it } from "vitest";
import { taxEstimate, TaxSettings, percentToBasisPoints, inclusiveVat, CreateExpenseInput, ConfirmExpenseInput, type Payment, type Expense } from "@sorted/core";

const now = "2026-11-15T12:00:00Z";
const settings = { vatRegistered: true, vatRateBp: 2300, vatPeriodMonths: 2, incomeTaxRateBp: 2000 };
const payment = (amountCents: number, paidAt = "2026-11-10T12:00:00Z", patch: Partial<Payment> = {}): Payment => ({
  id: "payment", bookingId: "booking", kind: "full", amountCents, method: "cash", status: "paid", linkUrl: null, paidAt, createdAt: paidAt, vatRateBp: null, ...patch,
});
const expense = (amountCents: number, vatCents: number | null, expenseDate = "2026-11-10T12:00:00Z", patch: Partial<Expense> = {}): Expense => ({
  id: "expense", merchant: "Supplies", amountCents, vatCents, category: "materials", expenseDate, status: "confirmed", receiptKey: null, createdAt: expenseDate, ...patch,
});

describe("Ireland tax estimates", () => {
  it("keeps zero VAT before registration, preserves old paid rates and falls back only for legacy null", () => {
    const payments = [payment(12300, undefined, { vatRateBp: 0 }), payment(10900, undefined, { vatRateBp: 900 }), payment(12300)];
    expect(taxEstimate({ payments, expenses: [], settings, now })).toMatchObject({ salesVatCents: 3200, yearSalesVatCents: 3200, netIncomeCents: 32300 });
    expect(taxEstimate({ payments, expenses: [], settings: { ...settings, vatRateBp: 1350 }, now }).salesVatCents).toBe(2363);
    expect(taxEstimate({ payments, expenses: [], settings: { ...settings, vatRegistered: false }, now }).salesVatCents).toBe(900);
  });
  it("calculates every component from VAT-inclusive paid income and confirmed expenses", () => {
    const result = taxEstimate({ payments: [payment(12300)], expenses: [expense(2460, 460)], settings, now });
    expect(result).toMatchObject({ periodLabel: "Nov–Dec 2026", periodStart: "2026-11-01", periodEnd: "2027-01-01", year: 2026,
      periodIncomeCents: 12300, salesVatCents: 2300, purchaseVatCents: 460, vatDueCents: 1840,
      yearIncomeCents: 12300, yearSalesVatCents: 2300, yearExpenseCents: 2460, yearPurchaseVatCents: 460,
      netIncomeCents: 10000, netExpenseCents: 2000, profitCents: 8000, incomeTaxCents: 1600 });
  });

  it("separates the current VAT period from calendar-year-to-date income tax", () => {
    const result = taxEstimate({ payments: [payment(12300), payment(1230, "2026-01-10T12:00:00Z"), payment(12300, "2026-12-10T12:00:00Z")],
      expenses: [expense(2460, 460), expense(246, 46, "2026-01-10"), expense(2460, 460, "2026-12-10")], settings, now });
    expect(result).toMatchObject({ periodIncomeCents: 24600, salesVatCents: 4600, purchaseVatCents: 920, yearIncomeCents: 13530,
      yearExpenseCents: 2706, yearSalesVatCents: 2530, yearPurchaseVatCents: 506, profitCents: 8800, incomeTaxCents: 1760 });
  });

  it("ignores pending/cancelled payments, missing/invalid dates, draft expenses and other years", () => {
    const result = taxEstimate({ payments: [payment(12300, now, { status: "pending" }), payment(12300, now, { status: "cancelled" }),
      payment(12300, now, { paidAt: null }), payment(12300, "invalid"), payment(12300, "2025-11-10")],
    expenses: [expense(2460, 460, now, { status: "needs_review" }), expense(2460, 460, "invalid"), expense(2460, 460, now, { expenseDate: null }),
      expense(2460, 460, now, { amountCents: null }), expense(2460, 460, "2025-11-10")], settings, now });
    expect(result).toMatchObject({ salesVatCents: 0, purchaseVatCents: 0, vatDueCents: 0, profitCents: 0, incomeTaxCents: 0 });
  });

  it("rounds VAT per payment and income tax to integer cents", () => {
    const payments = [payment(1), payment(1), payment(1)];
    expect(taxEstimate({ payments, expenses: [], settings, now })).toMatchObject({ salesVatCents: 0, profitCents: 3, incomeTaxCents: 1 });
    expect(inclusiveVat(3, 2300)).toBe(1);
    expect(inclusiveVat(11350, 1350)).toBe(1350);
    expect(inclusiveVat(10900, 900)).toBe(900);
    expect(inclusiveVat(10000, 0)).toBe(0);
  });

  it("allows a VAT refund and a loss without negative income tax", () => {
    expect(taxEstimate({ payments: [payment(1230)], expenses: [expense(12300, 2300)], settings, now }))
      .toMatchObject({ vatDueCents: -2070, profitCents: -9000, incomeTaxCents: 0 });
  });

  it("ignores VAT when not registered, distinguishes unset tax from zero, and handles empty inputs", () => {
    const input = { payments: [payment(12300)], expenses: [expense(2460, 460)], now };
    expect(taxEstimate({ ...input, settings: { ...settings, vatRegistered: false } }))
      .toMatchObject({ salesVatCents: 0, purchaseVatCents: 0, profitCents: 9840, incomeTaxCents: 1968 });
    expect(taxEstimate({ ...input, settings: { ...settings, incomeTaxRateBp: null } }).incomeTaxCents).toBeNull();
    expect(taxEstimate({ ...input, settings: { ...settings, incomeTaxRateBp: 0, vatRateBp: 0 } }))
      .toMatchObject({ salesVatCents: 0, purchaseVatCents: 460, incomeTaxCents: 0 });
    expect(taxEstimate({ payments: [], expenses: [], settings, now })).toMatchObject({ vatDueCents: 0, profitCents: 0, incomeTaxCents: 0 });
  });

  it.each([
    [2, "2026-01-01", "Jan–Feb 2026", "2026-01-01", "2026-03-01"],
    [2, "2026-03-01", "Mar–Apr 2026", "2026-03-01", "2026-05-01"],
    [4, "2026-05-01", "May–Aug 2026", "2026-05-01", "2026-09-01"],
    [4, "2026-11-15", "Sep–Dec 2026", "2026-09-01", "2027-01-01"],
    [6, "2026-04-30", "Jan–Jun 2026", "2026-01-01", "2026-07-01"],
    [6, "2026-07-01", "Jul–Dec 2026", "2026-07-01", "2027-01-01"],
    [12, "2026-11-15", "Jan–Dec 2026", "2026-01-01", "2027-01-01"],
  ])("aligns %i-month periods to January at %s", (months, date, label, start, end) => {
    expect(taxEstimate({ payments: [], expenses: [], settings: { ...settings, vatPeriodMonths: months }, now: date }))
      .toMatchObject({ periodLabel: label, periodStart: start, periodEnd: end });
  });

  it("uses Irish business dates through summer DST, leap days and year boundaries", () => {
    expect(taxEstimate({ payments: [payment(12300, "2026-06-30T23:30:00Z"), payment(12300, "2026-06-30T22:30:00Z")], expenses: [], settings, now: "2026-07-02" }))
      .toMatchObject({ periodLabel: "Jul–Aug 2026", salesVatCents: 2300, yearSalesVatCents: 4600 });
    expect(taxEstimate({ payments: [], expenses: [expense(2460, 460, "2028-02-29")], settings, now: "2028-02-29T12:00:00Z" }).purchaseVatCents).toBe(460);
    expect(taxEstimate({ payments: [payment(12300, "2026-12-31T23:59:59Z"), payment(12300, "2027-01-01T00:00:00Z")], expenses: [], settings, now: "2027-01-01T12:00:00Z" }))
      .toMatchObject({ periodLabel: "Jan–Feb 2027", yearIncomeCents: 12300, periodIncomeCents: 12300 });
  });

  it("does not mutate inputs and rejects invalid settings or now", () => {
    const p = Object.freeze(payment(12300)); const e = Object.freeze(expense(2460, null));
    expect(taxEstimate({ payments: Object.freeze([p]), expenses: Object.freeze([e]), settings: Object.freeze(settings), now: new Date(now) }).purchaseVatCents).toBe(0);
    expect(() => taxEstimate({ payments: [], expenses: [], settings: { ...settings, vatRateBp: null }, now })).toThrow();
    expect(() => taxEstimate({ payments: [], expenses: [], settings, now: "invalid" })).toThrow("valid date");
  });
});

describe("tax and expense validation", () => {
  it("validates basis points, required VAT rate and period options", () => {
    expect(TaxSettings.parse({})).toEqual({ vatRegistered: false, vatRateBp: null, vatPeriodMonths: 2, incomeTaxRateBp: null });
    for (const patch of [{ vatRateBp: null }, { vatRateBp: -1 }, { vatRateBp: 3001 }, { vatRateBp: 1350.5 }, { incomeTaxRateBp: 10001 }, { incomeTaxRateBp: -1 }, { vatPeriodMonths: 3 }]) {
      expect(TaxSettings.safeParse({ ...settings, ...patch }).success).toBe(false);
    }
    expect(TaxSettings.safeParse({ ...settings, vatRateBp: 0, incomeTaxRateBp: 10000 }).success).toBe(true);
  });
  it("parses up to two decimal places without float rounding or exponent notation", () => {
    expect(percentToBasisPoints("13.5", 3000)).toBe(1350);
    expect(percentToBasisPoints("13.37", 3000)).toBe(1337);
    expect(percentToBasisPoints("0", 3000)).toBe(0);
    expect(percentToBasisPoints("30.00", 3000)).toBe(3000);
    expect(percentToBasisPoints("100.00")).toBe(10000);
    for (const value of ["", "-1", "30.01", "1.001", "1e1", "NaN", "Infinity"]) expect(percentToBasisPoints(value, 3000)).toBeNull();
  });
  it("validates optional VAT against expense amount for create and confirmation", () => {
    const fields = { merchant: "Supplies", amount_cents: 100, category: "materials", expense_date: now };
    for (const schema of [CreateExpenseInput, ConfirmExpenseInput]) {
      for (const vat_cents of [null, undefined, 0, 100]) expect(schema.safeParse({ ...fields, vat_cents }).success).toBe(true);
      for (const vat_cents of [-1, 101, 0.5]) expect(schema.safeParse({ ...fields, vat_cents }).success).toBe(false);
    }
    expect(CreateExpenseInput.safeParse({ vat_cents: 1 }).success).toBe(false);
  });
});
