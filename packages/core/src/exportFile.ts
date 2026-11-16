import { toCsv, type CsvCell } from "./csv";

export interface ExportIncome {
  paidOn: string;
  client?: string;
  service?: string;
  kind: string;
  method: string | null;
  amountCents: number;
}
export interface ExportExpense {
  date: string;
  merchant: string | null;
  category: string | null;
  amountCents: number | null;
  hasReceipt: boolean;
  vatCents: number | null;
}
/** One table of the accountant export. A number in a row is an amount in euro, unless `decimals` says otherwise. */
export interface ExportSection {
  title: string;
  header: string[];
  rows: CsvCell[][];
  /** Decimal places for this table's numbers. Two when left out. */
  decimals?: number;
}

/** Income and expenses, then the mileage log when it has any trips. */
export const exportSections = (income: ExportIncome[], expenses: ExportExpense[], mileage?: ExportSection): ExportSection[] => [
  {
    title: "Income",
    header: ["date_paid", "client", "service", "kind", "method", "amount_eur"],
    rows: income.map((row) => [row.paidOn, row.client, row.service, row.kind, row.method, row.amountCents / 100]),
  },
  {
    title: "Expenses",
    header: ["date", "merchant", "category", "amount_eur", "has_receipt", "vat_eur"],
    rows: expenses.map((row) => [
      row.date, row.merchant, row.category, (row.amountCents ?? 0) / 100,
      row.hasReceipt ? "yes" : "no", row.vatCents === null ? null : row.vatCents / 100,
    ]),
  },
  ...(mileage?.rows.length ? [mileage] : []),
];

/** Both tables in one CSV, each under its title, with a blank line between. */
export const exportCsvText = (sections: ExportSection[]): string =>
  toCsv(sections.flatMap(({ title, header, rows, decimals = 2 }, index) => [
    ...(index ? [[]] : []),
    [title.toUpperCase()],
    header,
    ...rows.map((row) => row.map((cell) => (typeof cell === "number" ? cell.toFixed(decimals) : cell))),
  ]));

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * An Excel file with one sheet per table. Phone spreadsheet apps misread accented names in a CSV;
 * they read this correctly, and amounts arrive as numbers.
 */
export async function exportXlsx(sections: ExportSection[]): Promise<Blob> {
  const { default: writeXlsxFile } = await import("write-excel-file/universal");
  const width = (rows: CsvCell[][], name: string, column: number) =>
    Math.min(48, Math.max(name.length, ...rows.map((row) => String(row[column] || "").length)) + 2);
  const blob = await writeXlsxFile(sections.map(({ title, header, rows, decimals = 2 }) => ({
    sheet: title,
    stickyRowsCount: 1,
    columns: header.map((name, column) => ({ width: width(rows, name, column) })),
    data: [
      header.map((value) => ({ value, type: String, fontWeight: "bold" as const })),
      ...rows.map((row) => row.map((cell) =>
        typeof cell === "number" ? { value: cell, type: Number, format: `0.${"0".repeat(decimals)}` } : cell ? { value: cell, type: String } : null)),
    ],
  }))).toBlob();
  return new Blob([blob], { type: XLSX_TYPE });
}
