import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull, lte } from "drizzle-orm";
import {
  exportCsvText, exportSections, exportXlsx, historyJobs, historySheet, historyTemplate, parseCsv, planHistoryImport, readCents, readTables,
  type ImportBatch, type ImportHistoryResult, type UndoImportResult,
} from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import { demoBackend, resetDemo } from "../../web/src/lib/demoBackend";

afterEach(() => { vi.unstubAllGlobals(); });

const TODAY = "2026-11-16";
const sheet = (rows: string[][], name = "") => historySheet([{ name, rows }], TODAY);

async function trader() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const token = await issueJwt(user.id, user.sessionVersion);
  const request = (path: string, body?: object, method = body ? "POST" : "GET") => app.request(`/api${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const imports = async () => (await request("/imports")).json() as Promise<ImportBatch[]>;
  const counts = async () => ({
    clients: (await db.select().from(schema.clients).where(eq(schema.clients.userId, user.id))).length,
    bookings: (await db.select().from(schema.bookings).where(eq(schema.bookings.userId, user.id))).length,
    payments: (await db.select().from(schema.payments).where(eq(schema.payments.userId, user.id))).length,
    expenses: (await db.select().from(schema.expenses).where(eq(schema.expenses.userId, user.id))).length,
  });
  return { user, request, imports, counts };
}

const income = [
  { paid_on: "2025-03-01", client: "Gráinne Flynn", service: "Bridal hair", kind: "deposit", method: "revolut", amount_cents: 5000 },
  { paid_on: "2025-06-14", client: "Gráinne Flynn", service: "Bridal hair", kind: "balance", method: "cash", amount_cents: 15000 },
  { paid_on: "2025-07-02", client: "Méabh Kavanagh", service: "Blow dry", kind: "full", method: null, amount_cents: 5500 },
  { paid_on: "2025-07-02", client: "Méabh Kavanagh", service: "Blow dry", kind: "full", method: null, amount_cents: 5500 },
] as const;
const expenses = [{ date: "2025-03-20", merchant: "Salon Supplies", category: "materials", amount_cents: 4550, vat_cents: 851 }] as const;

describe("reading past income and expenses", () => {
  it("reads amounts as cent and leaves out what could be read two ways", () => {
    expect(["55", "55.5", "55,50", "€1,250.00", "1.250,00", "1 250.00", "0.30000000000000004", "EUR 20"].map(readCents)).toEqual([5500, 5550, 5550, 125000, 125000, 125000, 30, 2000]);
    expect(["1.250", "-20", "0", "(20)", "20 or 30", "", "abc", "12.345"].map(readCents)).toEqual(Array(8).fill(undefined));
  });

  it("reads dates the Irish way, and month first only when the column shows it", () => {
    const dates = (values: string[]) => sheet([["Date", "Client", "Amount"], ...values.map((value) => [value, "A", "10"])]).income.map((row) => row.paid_on);
    expect(dates(["2025-03-14", "03/04/2025", "14.03.25", "3-4-2025", "14 Mar 2025", "14th March 2025", "March 14, 2025", "2025-03-14T10:00:00Z"]))
      .toEqual(["2025-03-14", "2025-04-03", "2025-03-14", "2025-04-03", "2025-03-14", "2025-03-14", "2025-03-14", "2025-03-14"]);
    expect(dates(["03/04/2025", "12/25/2025"])).toEqual(["2025-03-04", "2025-12-25"]);
    expect(() => dates(["13/04/2025", "12/25/2025"])).toThrow(/day\/month\/year and some are month\/day\/year/);
    const odd = sheet([["Date", "Client", "Amount"], ["31/02/2025", "A", "10"], ["soon", "A", "10"], ["", "Total", "20"], ["17/11/2026", "A", "10"], ["16/11/2026", "A", "x"], ["16/11/2026", "A", "10"]]);
    expect(odd).toMatchObject({ noDate: 3, future: 1, noAmount: 1 });
    expect(odd.income.map((row) => row.paid_on)).toEqual(["2026-11-16"]);
  });

  it("reads a hand-made sheet, its headings and gaps", () => {
    const found = sheet([
      ["Takings 2025"],
      ["Payment date", "Customer", "Description", "Paid with", "Total"],
      ["14/03/2025", "Róisín Daly", "'=SUM(1,2)", "Card", "€120.00"],
      ["15/03/2025", "", "", "bank transfer", "55"],
      ["", "", "", "", ""],
      ["16/03/2025", "Example: Mary", "x", "", "10"],
    ]);
    expect(found.income).toEqual([
      { paid_on: "2025-03-14", client: "Róisín Daly", service: "=SUM(1,2)", kind: "full", method: "card", amount_cents: 12000 },
      { paid_on: "2025-03-15", client: "Client not recorded", service: "Service not recorded", kind: "full", method: "bank_transfer", amount_cents: 5500 },
    ]);
    const spent = sheet([["Date", "Supplier", "Type", "Cost", "VAT"], ["01/02/2025", "Three", "Phone & internet", "35", "6.54"], ["02/02/2025", "", "nonsense", "10", "99"]]);
    expect(spent.expenses).toEqual([
      { date: "2025-02-01", merchant: "Three", category: "phone_internet", amount_cents: 3500, vat_cents: 654 },
      { date: "2025-02-02", merchant: "Not recorded", category: "other", amount_cents: 1000, vat_cents: null },
    ]);
    expect(sheet([["Date", "Details", "Amount"], ["01/02/2025", "x", "5"]], "Expenses 2025").expenses).toHaveLength(1);
    expect(() => sheet([["Date", "Details", "Amount"], ["01/02/2025", "x", "5"]])).toThrow(/couldn't find a date column/);
    expect(() => sheet([["Name", "Phone"], ["Mary", "087"]])).toThrow(/couldn't find a date column/);
  });

  it("reads Sorted's own export back, as Excel and as CSV", async () => {
    const sections = exportSections(
      [{ paidOn: "2025-03-14", client: "Gráinne Flynn", service: "Bridal hair – bride", kind: "deposit", method: "cash", amountCents: 5505 }],
      [{ date: "2025-03-20", merchant: "Méabh's Supplies", category: "phone_internet", amountCents: 4550, hasReceipt: true, vatCents: 851 }],
    );
    const expected = {
      income: [{ paid_on: "2025-03-14", client: "Gráinne Flynn", service: "Bridal hair – bride", kind: "deposit", method: "cash", amount_cents: 5505 }],
      expenses: [{ date: "2025-03-20", merchant: "Méabh's Supplies", category: "phone_internet", amount_cents: 4550, vat_cents: 851 }],
    };
    expect(historySheet(await readTables(await exportXlsx(sections)), TODAY)).toMatchObject(expected);
    expect(historySheet([{ name: "", rows: parseCsv(exportCsvText(sections)) }], TODAY)).toMatchObject(expected);
    const template = historySheet(await readTables(await historyTemplate()), TODAY);
    expect(template).toEqual({ income: [], expenses: [], noDate: 0, noAmount: 0, future: 0 });
  });

  it("adds a row unless Sorted holds one like it, and joins a balance to its deposit", () => {
    const held = { income: [{ paid_on: "2025-07-02", client: "méabh  kavanagh", service: "BLOW DRY", amount_cents: 5500 }], expenses: [{ date: "2025-03-20", merchant: "salon supplies", amount_cents: 4550 }] };
    const plan = planHistoryImport({ income: [...income], expenses: [...expenses] }, held);
    expect(plan).toMatchObject({ alreadyThere: 2, expenses: [] });
    expect(plan.income).toHaveLength(3);
    expect(historyJobs([...income]).map((job) => [job.client, job.payments.map((payment) => payment.amount_cents)]))
      .toEqual([["Gráinne Flynn", [5000, 15000]], ["Méabh Kavanagh", [5500]], ["Méabh Kavanagh", [5500]]]);
  });
});

describe("saving past income and expenses", () => {
  it("adds paid, completed past jobs that can't trigger a reminder, a review request or a receipt", async () => {
    const { user, request, imports, counts } = await trader();
    const [existing] = await db.insert(schema.clients).values({ userId: user.id, name: "gráinne flynn", phone: "353871234567" }).returning();
    const response = await request("/imports/history", { file_name: "2025.xlsx", income, expenses });
    expect(response.status).toBe(201);
    const result = await response.json() as ImportHistoryResult;
    expect(result).toMatchObject({ payments: 4, expenses: 1, clients: 1, alreadyThere: 0 });
    expect(await counts()).toEqual({ clients: 2, bookings: 3, payments: 4, expenses: 1 });

    const bookings = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, user.id));
    const bridal = bookings.find((booking) => booking.service === "Bridal hair")!;
    expect(bridal).toMatchObject({ clientId: existing!.id, status: "completed", priceCents: 20000, depositCents: 5000, timeTbc: true, notes: "Imported from 2025.xlsx", importId: result.importId });
    expect([bridal.startAt?.toISOString(), bridal.completedAt?.toISOString()]).toEqual(["2025-06-13T23:00:00.000Z", "2025-06-14T11:00:00.000Z"]);
    expect(bookings.every((booking) => booking.reminderSentAt && booking.reviewRequestedAt && booking.completedAt && booking.status === "completed")).toBe(true);
    const due = await db.select().from(schema.bookings).where(and(eq(schema.bookings.userId, user.id), eq(schema.bookings.status, "completed"),
      lte(schema.bookings.completedAt, new Date()), isNull(schema.bookings.reviewRequestedAt)));
    expect(due).toEqual([]);
    const payments = await db.select().from(schema.payments).where(eq(schema.payments.userId, user.id));
    expect(payments.every((payment) => payment.status === "paid" && payment.vatRateBp === 0 && payment.importId === result.importId)).toBe(true);
    expect(payments.map((payment) => payment.paidAt?.toISOString()).sort()[0]).toBe("2025-03-01T12:00:00.000Z");
    expect(await db.select().from(schema.invoices).where(eq(schema.invoices.userId, user.id))).toEqual([]);
    expect(await db.select().from(schema.messageLog).where(eq(schema.messageLog.userId, user.id))).toEqual([]);
    const [expense] = await db.select().from(schema.expenses).where(eq(schema.expenses.userId, user.id));
    expect(expense).toMatchObject({ merchant: "Salon Supplies", category: "materials", amountCents: 4550, vatCents: 851, status: "confirmed" });
    expect(expense!.expenseDate?.toISOString()).toBe("2025-03-20T00:00:00.000Z");

    const summary = await (await request("/reports/summary?year=2025")).json() as { income_cents: number; expenses_cents: number };
    expect(summary).toMatchObject({ income_cents: 31000, expenses_cents: 4550 });
    const exported = await (await request("/reports/export?year=2025")).text();
    expect(historySheet([{ name: "", rows: parseCsv(exported) }], TODAY)).toMatchObject({ income: [...income].map((row) => expect.objectContaining({ paid_on: row.paid_on, amount_cents: row.amount_cents })) });
    expect(await imports()).toMatchObject([{ kind: "history", fileName: "2025.xlsx", payments: 4, expenses: 1, clients: 1 }]);

    // The same file again, and the trader's own export of it, add nothing.
    const again = await request("/imports/history", { file_name: "2025.xlsx", income, expenses });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ importId: null, payments: 0, expenses: 0, clients: 0, alreadyThere: 5 });
    const round = historySheet([{ name: "", rows: parseCsv(exported) }], TODAY);
    expect(await (await request("/imports/history", { income: round.income, expenses: round.expenses })).json()).toMatchObject({ payments: 0, expenses: 0, alreadyThere: 5 });
    expect(await counts()).toEqual({ clients: 2, bookings: 3, payments: 4, expenses: 1 });
  });

  it("uses the trader's VAT rate, refuses bad input and keeps traders apart", async () => {
    const { user, request, counts } = await trader();
    const other = await trader();
    await db.update(schema.users).set({ vatRegistered: true, vatRateBp: 1350 }).where(eq(schema.users.id, user.id));
    for (const body of [
      {}, { income: [], expenses: [] }, { income: [{ ...income[0], amount_cents: 0 }], expenses: [] }, { income: [{ ...income[0], paid_on: "14/03/2025" }], expenses: [] },
      { income: [{ ...income[0], paid_on: "2999-01-01" }], expenses: [] }, { income: [], expenses: [{ ...expenses[0], vat_cents: 5000 }] },
      { income: [{ ...income[0], client: "" }], expenses: [] }, { income: [{ ...income[0], method: "cheque" }], expenses: [] },
    ]) expect((await request("/imports/history", body)).status).toBe(400);
    expect((await app.request("/api/imports/history", { method: "POST", body: "{}" })).status).toBe(401);
    expect(await counts()).toEqual({ clients: 0, bookings: 0, payments: 0, expenses: 0 });

    const result = await (await request("/imports/history", { income: [income[2]], expenses })).json() as ImportHistoryResult;
    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.userId, user.id));
    expect(payment!.vatRateBp).toBe(1350);
    expect(await other.counts()).toEqual({ clients: 0, bookings: 0, payments: 0, expenses: 0 });
    expect(await other.imports()).toEqual([]);
    expect((await other.request(`/imports/${result.importId}`, { confirm: true }, "DELETE")).status).toBe(404);
    // The other trader importing the same rows gets their own.
    expect(await (await other.request("/imports/history", { income: [income[2]], expenses })).json()).toMatchObject({ payments: 1, expenses: 1, clients: 1 });
    expect(await counts()).toEqual({ clients: 1, bookings: 1, payments: 1, expenses: 1 });
  });

  it("undoes an import, keeping what the trader has built on since", async () => {
    const { user, request, imports, counts } = await trader();
    const [mine] = await db.insert(schema.expenses).values({ userId: user.id, merchant: "Mine", amountCents: 100, expenseDate: new Date("2025-01-01T00:00:00Z"), status: "confirmed" }).returning();
    const result = await (await request("/imports/history", { file_name: "2025.xlsx", income, expenses: [...expenses, { ...expenses[0], merchant: "With photo" }] })).json() as ImportHistoryResult;
    const payments = await db.select().from(schema.payments).where(eq(schema.payments.userId, user.id));
    const receipted = payments.find((payment) => payment.amountCents === 15000)!;
    await db.insert(schema.invoices).values({ userId: user.id, bookingId: receipted.bookingId, paymentId: receipted.id, kind: "receipt", number: 1 });
    await db.update(schema.expenses).set({ receiptKey: "photo" }).where(and(eq(schema.expenses.userId, user.id), eq(schema.expenses.merchant, "With photo")));

    expect((await request(`/imports/${result.importId}`, {}, "DELETE")).status).toBe(400);
    const undone = await (await request(`/imports/${result.importId}`, { confirm: true }, "DELETE")).json() as UndoImportResult;
    // The receipted balance keeps its deposit: the job stays whole, so nothing reads as still owed.
    expect(undone).toEqual({ removed: 3, kept: 3 });
    expect(await counts()).toEqual({ clients: 1, bookings: 1, payments: 2, expenses: 2 });
    expect(await imports()).toEqual([]);
    const [kept] = await db.select().from(schema.bookings).where(eq(schema.bookings.userId, user.id));
    expect(kept).toMatchObject({ id: receipted.bookingId, importId: null, priceCents: 20000 });
    expect((await db.select().from(schema.payments).where(eq(schema.payments.userId, user.id))).map((payment) => payment.amountCents).sort()).toEqual([15000, 5000]);
    expect(kept!.reviewRequestedAt).not.toBeNull();
    expect((await db.select().from(schema.expenses).where(eq(schema.expenses.id, mine!.id)))).toHaveLength(1);
  });

  it("adds the second of two identical rows when Sorted already holds the first", async () => {
    const { request, counts } = await trader();
    const twice = income.slice(2);
    await request("/imports/history", { income: twice.slice(0, 1), expenses: [] });
    // The whole file is sent, as the import screen does, and exactly the one missing payment is added.
    expect(await (await request("/imports/history", { income: twice, expenses: [] })).json()).toMatchObject({ payments: 1, alreadyThere: 1 });
    expect((await counts()).payments).toBe(2);
    expect(await (await request("/imports/history", { income: twice, expenses: [] })).json()).toMatchObject({ importId: null, payments: 0, alreadyThere: 2 });
  });

  it("saves a card payment as Card rather than a Stripe charge, so it can still be corrected", async () => {
    const { user, request } = await trader();
    await request("/imports/history", { income: [{ paid_on: "2025-05-01", client: "Card Client", service: "Cut", kind: "full", method: "card", amount_cents: 6000 }], expenses: [] });
    expect(["card", "Credit Card", "debit card", "stripe"].map((cell) => historySheet([{ name: "Income", rows: [["date_paid", "client", "service", "method", "amount_eur"], ["2025-05-01", "A", "Cut", cell, "60"]] }]).income[0]?.method)).toEqual(Array(4).fill("card"));
    const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.userId, user.id));
    expect(payment).toMatchObject({ method: "card", linkUrl: null });
    expect((await request("/imports/history", { income: [{ paid_on: "2025-05-02", client: "Card Client", service: "Cut", kind: "full", method: "stripe", amount_cents: 6000 }], expenses: [] })).status).toBe(400);
    expect((await request(`/payments/${payment!.id}`, { amount_cents: 5000 }, "PATCH")).status).toBe(200);
    expect((await db.select().from(schema.payments).where(eq(schema.payments.id, payment!.id)))[0]).toMatchObject({ amountCents: 5000, method: "card" });
    expect((await request(`/payments/${payment!.id}/undo`, {})).status).toBe(200);
  });

  it("does the same in demo mode", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    resetDemo();
    const before = await demoBackend.load();
    const rows = { income: [...income], expenses: [...expenses] };
    const result = await demoBackend.importHistory("2025.xlsx", rows);
    expect(result).toMatchObject({ payments: 4, expenses: 1, clients: 2, alreadyThere: 0 });
    expect(await demoBackend.importHistory("2025.xlsx", rows)).toEqual({ importId: null, payments: 0, expenses: 0, clients: 0, alreadyThere: 5 });
    const after = await demoBackend.load();
    const added = after.bookings.filter((booking) => booking.notes === "Imported from 2025.xlsx");
    expect(added.map((booking) => [booking.status, booking.timeTbc, booking.priceCents]).sort()).toEqual([["completed", true, 20000], ["completed", true, 5500], ["completed", true, 5500]].sort());
    expect(after.payments.length - before.payments.length).toBe(4);
    expect(after.documents).toEqual(before.documents);
    expect(await demoBackend.imports()).toMatchObject([{ id: result.importId, kind: "history", payments: 4, expenses: 1, clients: 2 }]);
    const receipted = after.payments.find((payment) => payment.amountCents === 15000 && added.some((booking) => booking.id === payment.bookingId))!;
    await demoBackend.document(receipted.bookingId, "receipt", receipted.id);
    expect(await demoBackend.undoImport(result.importId!)).toEqual({ removed: 3, kept: 2 });
    const undone = await demoBackend.load();
    expect(undone.payments.length - before.payments.length).toBe(2);
    expect(undone.expenses).toHaveLength(before.expenses.length);
    expect(undone.clients.map((client) => client.name).sort()).toEqual([...before.clients.map((client) => client.name), "Gráinne Flynn"].sort());
  });
});
