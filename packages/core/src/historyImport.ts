import { z } from "zod";
import { CalendarDate } from "./dates";
import { irelandToday } from "./recordPayment";
import { ExpenseCategory, PaymentKind, PaymentMethod } from "./types";
import type { ImportTable } from "./clientImport";

export const IMPORT_MAX_HISTORY_ROWS = 5000;
export const NO_CLIENT = "Client not recorded";
export const NO_SERVICE = "Service not recorded";
export const NO_MERCHANT = "Not recorded";

const Cents = z.number().int().positive().max(100_000_000);
export const HistoryIncomeRow = z.object({
  paid_on: CalendarDate,
  client: z.string().trim().min(1).max(200),
  service: z.string().trim().min(1).max(200),
  kind: PaymentKind,
  method: PaymentMethod.nullable(),
  amount_cents: Cents,
});
export type HistoryIncomeRow = z.infer<typeof HistoryIncomeRow>;
export const HistoryExpenseRow = z.object({
  date: CalendarDate,
  merchant: z.string().trim().min(1).max(200),
  category: ExpenseCategory,
  amount_cents: Cents,
  vat_cents: z.number().int().min(0).max(100_000_000).nullable(),
}).refine((row) => (row.vat_cents ?? 0) <= row.amount_cents, "VAT can't be more than the amount.");
export type HistoryExpenseRow = z.infer<typeof HistoryExpenseRow>;
export const ImportHistoryInput = z.object({
  file_name: z.string().trim().min(1).max(200).optional(),
  income: z.array(HistoryIncomeRow).max(IMPORT_MAX_HISTORY_ROWS),
  expenses: z.array(HistoryExpenseRow).max(IMPORT_MAX_HISTORY_ROWS),
}).refine(({ income, expenses }) => income.length + expenses.length > 0 && income.length + expenses.length <= IMPORT_MAX_HISTORY_ROWS,
  `Send between 1 and ${IMPORT_MAX_HISTORY_ROWS} rows.`);
export type ImportHistoryInput = z.infer<typeof ImportHistoryInput>;
export interface ImportHistoryResult { importId: string | null; payments: number; expenses: number; clients: number; alreadyThere: number }

export interface HistorySheet {
  income: HistoryIncomeRow[];
  expenses: HistoryExpenseRow[];
  /** Rows that can't be added, by reason. */
  noDate: number;
  noAmount: number;
  future: number;
}

const heading = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const text = (value: string | undefined) => (value ?? "").replace(/^'(?=[=+\-@])/, "").replace(/\s+/g, " ").trim().slice(0, 200);

// Earlier entries win. The first three of each are the Export for accountant headings.
const INCOME = {
  date: ["date paid", "date", "paid on", "payment date", "paid", "date received", "received"],
  amount: ["amount eur", "amount", "total", "price", "paid eur", "income", "amount paid", "value", "eur"],
  client: ["client", "client name", "customer", "customer name", "name", "from", "paid by"],
  service: ["service", "description", "details", "job", "treatment", "item", "for"],
  kind: ["kind", "payment type"],
  method: ["method", "payment method", "paid with", "how paid", "type"],
} as const;
const EXPENSES = {
  date: ["date", "expense date", "date paid", "paid on"],
  amount: ["amount eur", "amount", "total", "cost", "price", "gross", "value", "eur"],
  merchant: ["merchant", "supplier", "shop", "vendor", "payee", "paid to", "company", "description", "details", "item"],
  category: ["category", "type"],
  vat: ["vat eur", "vat", "vat amount"],
} as const;
type Found<T> = Partial<Record<keyof T, number>>;
function findColumns<T extends Record<string, readonly string[]>>(options: T, row: string[]): Found<T> {
  const names = row.map(heading);
  const found: Found<T> = {};
  for (const column of Object.keys(options) as (keyof T)[]) {
    for (const option of options[column]!) {
      const index = names.indexOf(option);
      if (index >= 0 && !Object.values(found).includes(index)) { found[column] = index; break; }
    }
  }
  return found;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const SLASHED = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/;
const iso = (year: number, month: number, day: number) => {
  const date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return year >= 2000 && CalendarDate.safeParse(date).success ? date : undefined;
};
/**
 * A date cell as 2025-03-14. 03/04/2025 is 3 April, as written in Ireland, unless the column
 * shows the month comes first.
 */
function readDate(value: string, monthFirst: boolean): string | undefined {
  const cell = value.trim();
  const dashed = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(cell);
  if (dashed) return iso(Number(dashed[1]), Number(dashed[2]), Number(dashed[3]));
  const slashed = SLASHED.exec(cell);
  if (slashed) {
    const [first, second] = [Number(slashed[1]), Number(slashed[2])];
    const year = slashed[3]!.length === 2 ? 2000 + Number(slashed[3]) : Number(slashed[3]);
    return monthFirst ? iso(year, first, second) : iso(year, second, first);
  }
  const named = /^(?:(\d{1,2})(?:st|nd|rd|th)?[ -]([a-z]{3,9})|([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?,?)[ -](\d{4})$/i.exec(cell);
  if (named) {
    const month = MONTHS.indexOf((named[2] ?? named[3])!.slice(0, 3).toLowerCase());
    return month < 0 ? undefined : iso(Number(named[5]), month + 1, Number(named[1] ?? named[4]));
  }
  return undefined;
}

/** Which comes first in this column's 03/04/2025 dates. Undefined when the column has both kinds, so neither can be trusted. */
function monthFirstIn(cells: string[]): boolean | undefined {
  const parts = cells.map((cell) => SLASHED.exec(cell.trim())).filter((match) => match !== null);
  const dayFirst = parts.some((match) => Number(match[1]) > 12), monthFirst = parts.some((match) => Number(match[2]) > 12);
  return dayFirst && monthFirst ? undefined : monthFirst;
}

/**
 * An amount in cent, or undefined when it isn't a plain amount above zero.
 * "€1,250.00" and "1.250,00" are 125000; "55,5" is 5550; "1.250" is not read, since it could be either.
 */
export function readCents(value: string): number | undefined {
  const cell = value.replace(/€|eur/gi, "").replace(/[\s\u00a0]/g, "");
  let plain: string;
  if (/^\d+$/.test(cell)) plain = cell;
  else if (/^\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(cell)) plain = cell.replaceAll(",", "");
  else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(cell)) plain = cell.replaceAll(".", "").replace(",", ".");
  else if (/^\d+[.,]\d{1,2}$/.test(cell)) plain = cell.replace(",", ".");
  // A sum worked out in a spreadsheet can arrive as 0.30000000000000004.
  else if (/^\d+\.\d{6,}$/.test(cell) && Math.abs(Number(cell) * 100 - Math.round(Number(cell) * 100)) < 1e-6) plain = cell;
  else return undefined;
  const cents = Math.round(Number(plain) * 100);
  return cents > 0 && cents <= 100_000_000 ? cents : undefined;
}

const KINDS: Record<string, PaymentKind> = { deposit: "deposit", balance: "balance", full: "full", custom: "custom" };
const METHODS: Record<string, PaymentMethod> = {
  cash: "cash", revolut: "revolut", stripe: "stripe", card: "stripe", "credit card": "stripe", "debit card": "stripe",
  "bank transfer": "bank_transfer", transfer: "bank_transfer", bank: "bank_transfer", eft: "bank_transfer",
};
const CATEGORIES: Record<string, ExpenseCategory> = {
  ...Object.fromEntries(ExpenseCategory.options.map((value) => [heading(value), value])),
  "phone internet": "phone_internet", phone: "phone_internet", internet: "phone_internet", supplies: "materials", products: "materials",
  stock: "materials", fuel: "travel", mileage: "travel", parking: "travel", advertising: "marketing", courses: "training",
};

type Section = { title: string; rows: string[][] };
const TITLE = /^(income|expenses)$/i;
/** A CSV export holds both tables, each under its own INCOME or EXPENSES line. */
function sections({ name, rows }: ImportTable): Section[] {
  const found: Section[] = [{ title: name, rows: [] }];
  for (const row of rows) {
    const filled = row.filter((cell) => cell.trim());
    if (filled.length === 1 && TITLE.test(filled[0]!.trim())) found.push({ title: filled[0]!.trim(), rows: [] });
    else found.at(-1)!.rows.push(row);
  }
  return found.filter((section) => section.rows.length);
}

const cell = (row: string[], index: number | undefined) => (index === undefined ? "" : row[index] ?? "");
const EXAMPLE = /^example\b/i;

/** The payments and expenses in a file laid out like Export for accountant, or any sheet with a date and an amount column. */
export function historySheet(tables: ImportTable[], today = irelandToday()): HistorySheet {
  const sheet: HistorySheet = { income: [], expenses: [], noDate: 0, noAmount: 0, future: 0 };
  let recognised = 0;
  for (const section of tables.flatMap(sections)) {
    const titled = /expense|cost|spend|purchase/i.test(section.title) ? "expenses" : /income|sales|payment|takings|earning/i.test(section.title) ? "income" : undefined;
    let start = -1, kind: "income" | "expenses" | undefined, income: Found<typeof INCOME> = {}, expenses: Found<typeof EXPENSES> = {};
    for (let index = 0; index < Math.min(10, section.rows.length) && start < 0; index++) {
      income = findColumns(INCOME, section.rows[index]!); expenses = findColumns(EXPENSES, section.rows[index]!);
      const asIncome = income.date !== undefined && income.amount !== undefined, asExpenses = expenses.date !== undefined && expenses.amount !== undefined;
      if (!asIncome && !asExpenses) continue;
      const names = section.rows[index]!.map(heading);
      const looksLikeExpenses = ["merchant", "supplier", "shop", "vendor", "payee", "paid to", "category", "vat", "vat eur"].some((name) => names.includes(name));
      const looksLikeIncome = income.client !== undefined || income.service !== undefined;
      kind = titled ?? (looksLikeExpenses ? "expenses" : looksLikeIncome ? "income" : undefined);
      if (kind === "income" && !asIncome || kind === "expenses" && !asExpenses) kind = undefined;
      if (kind) start = index;
    }
    if (!kind) continue;
    recognised++;
    const at = kind === "income" ? income : expenses;
    const body = section.rows.slice(start + 1).filter((row) => row.some((value) => value.trim()));
    const monthFirst = monthFirstIn(body.map((row) => cell(row, at.date)));
    if (monthFirst === undefined) throw new Error("Some dates in that file are day/month/year and some are month/day/year, so Sorted can't tell them apart. Write them all one way, such as 31/12/2025, and try again.");
    for (const row of body) {
      const who = text(cell(row, kind === "income" ? income.client : expenses.merchant));
      if (EXAMPLE.test(who)) continue;
      const date = readDate(cell(row, at.date), monthFirst), cents = readCents(cell(row, at.amount));
      if (!date) { sheet.noDate++; continue; }
      if (!cents) { sheet.noAmount++; continue; }
      if (date > today) { sheet.future++; continue; }
      if (kind === "income") {
        sheet.income.push({
          paid_on: date, client: who || NO_CLIENT, service: text(cell(row, income.service)) || NO_SERVICE,
          kind: KINDS[heading(cell(row, income.kind))] ?? "full", method: METHODS[heading(cell(row, income.method))] ?? null, amount_cents: cents,
        });
      } else {
        const vat = readCents(cell(row, expenses.vat));
        sheet.expenses.push({
          date, merchant: who || NO_MERCHANT, category: CATEGORIES[heading(cell(row, expenses.category))] ?? "other",
          amount_cents: cents, vat_cents: vat !== undefined && vat <= cents ? vat : null,
        });
      }
    }
  }
  if (!recognised) throw new Error("Sorted couldn't find a date column and an amount column in that file. Download the template to see the layout it reads.");
  return sheet;
}

const key = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
const incomeKey = (row: Pick<HistoryIncomeRow, "paid_on" | "client" | "service" | "amount_cents">) =>
  [row.paid_on, key(row.client), key(row.service), row.amount_cents].join("\u0000");
const expenseKey = (row: Pick<HistoryExpenseRow, "date" | "merchant" | "amount_cents">) =>
  [row.date, key(row.merchant), row.amount_cents].join("\u0000");

/** Keeps a row unless Sorted already holds one like it. Two the same in the file are two payments; the same file twice adds nothing. */
function fresh<T>(rows: T[], existing: string[], keyOf: (row: T) => string): T[] {
  const held = new Map<string, number>();
  for (const item of existing) held.set(item, (held.get(item) ?? 0) + 1);
  return rows.filter((row) => {
    const left = held.get(keyOf(row)) ?? 0;
    if (left) held.set(keyOf(row), left - 1);
    return !left;
  });
}

export interface HistoryHeld {
  income: Pick<HistoryIncomeRow, "paid_on" | "client" | "service" | "amount_cents">[];
  expenses: Pick<HistoryExpenseRow, "date" | "merchant" | "amount_cents">[];
}
export function planHistoryImport(rows: Pick<HistorySheet, "income" | "expenses">, held: HistoryHeld) {
  const income = fresh(rows.income, held.income.map(incomeKey), incomeKey);
  const expenses = fresh(rows.expenses, held.expenses.map(expenseKey), expenseKey);
  return { income, expenses, alreadyThere: rows.income.length - income.length + rows.expenses.length - expenses.length };
}

export interface HistoryJob { client: string; service: string; payments: HistoryIncomeRow[] }
/** One past job per payment, except that a balance joins the deposit paid before it by the same client for the same service. */
export function historyJobs(income: HistoryIncomeRow[]): HistoryJob[] {
  const jobs: HistoryJob[] = [], awaitingBalance = new Map<string, HistoryJob>();
  for (const payment of [...income].sort((a, b) => a.paid_on.localeCompare(b.paid_on))) {
    const who = `${key(payment.client)}\u0000${key(payment.service)}`;
    const open = payment.kind === "balance" ? awaitingBalance.get(who) : undefined;
    if (open) { open.payments.push(payment); awaitingBalance.delete(who); continue; }
    const job = { client: payment.client, service: payment.service, payments: [payment] };
    jobs.push(job);
    if (payment.kind === "deposit") awaitingBalance.set(who, job);
  }
  return jobs;
}

export const HISTORY_TEMPLATE = {
  income: ["date_paid", "client", "service", "kind", "method", "amount_eur"],
  expenses: ["date", "merchant", "category", "amount_eur", "has_receipt", "vat_eur"],
};
/** The same two sheets as Export for accountant, so that file can be uploaded as it is. */
export async function historyTemplate(): Promise<Blob> {
  const { default: writeXlsxFile } = await import("write-excel-file/universal");
  const sheet = (name: string, header: string[], rows: (string | number)[][], widths: number[]) => ({
    sheet: name, stickyRowsCount: 1, columns: widths.map((width) => ({ width })),
    data: [
      header.map((value) => ({ value, type: String, fontWeight: "bold" as const })),
      ...rows.map((row) => row.map((value) => typeof value === "number" ? { value, type: Number, format: "0.00" } : value ? { value, type: String } : null)),
    ],
  });
  const blob = await writeXlsxFile([
    sheet("Income", HISTORY_TEMPLATE.income, [
      ["14/03/2025", "Example: Mary Murphy", "Bridal hair", "full", "cash", 120],
      ["02/06/2025", "Example: delete these rows or leave them", "Only the date and amount are needed", "", "", 55],
    ], [14, 40, 36, 10, 16, 14]),
    sheet("Expenses", HISTORY_TEMPLATE.expenses, [
      ["20/03/2025", "Example: Salon Supplies", "materials", 45.5, "", 8.51],
      ["05/04/2025", "Example: categories are " + ExpenseCategory.options.join(", "), "other", 20, "", ""],
    ], [14, 60, 16, 14, 14, 10]),
  ]).toBlob();
  return new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
