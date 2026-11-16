import { z } from "zod";
import { CreateClientInput, normaliseClientPhone, type Client } from "./types";

export const IMPORT_MAX_CLIENTS = 2000;
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const CLIENT_TEMPLATE_HEADER = ["Name", "Phone", "Email", "Notes"];
const EXAMPLE = /^example\b/i;

export const ImportClientsInput = z.object({
  file_name: z.string().trim().min(1).max(200).optional(),
  clients: z.array(CreateClientInput).min(1).max(IMPORT_MAX_CLIENTS),
});
export type ImportClientsInput = z.infer<typeof ImportClientsInput>;

/** One import a trader ran, and how many of its rows are still in Sorted. */
export interface ImportBatch {
  id: string;
  kind: "clients";
  fileName: string | null;
  createdAt: string;
  clients: number;
}
export interface ImportClientsResult { importId: string | null; added: number; alreadyThere: number }
export interface UndoImportResult { removed: number; kept: number }

export interface ImportClientRow { name: string; phone?: string; email?: string; notes?: string }
export interface ClientSheet {
  rows: ImportClientRow[];
  /** Column headings as written in the file, for "Name from 'Full Name'" in the preview. */
  columns: Partial<Record<"name" | "phone" | "email" | "notes", string>>;
  noName: number;
  unreadPhones: number;
  unreadEmails: number;
}

/** Splits CSV text into rows. Accepts commas, semicolons or tabs, quoted cells and a leading BOM. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const first = source.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const count = (mark: string) => first.split(mark).length;
  const delimiter = [",", ";", "\t"].reduce((best, mark) => count(mark) > count(best) ? mark : best);
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char !== '"') cell += char;
      else if (source[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const heading = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Earlier entries win, so "Mobile" beats "Telephone" when a file has both.
const HEADINGS = {
  name: ["name", "full name", "client", "client name", "customer", "customer name", "display name", "contact", "contact name"],
  first: ["first name", "firstname", "given name", "forename"],
  last: ["last name", "lastname", "family name", "surname"],
  phone: ["mobile", "mobile number", "mobile phone", "phone", "phone number", "whatsapp", "contact number", "phone 1 value", "primary phone", "telephone", "tel", "cell"],
  email: ["email", "e mail", "email address", "e mail address", "e mail 1 value", "email 1 value"],
  notes: ["notes", "note", "comments", "comment"],
} as const;
type Column = keyof typeof HEADINGS;

function findColumns(row: string[]) {
  const names = row.map(heading);
  const found: Partial<Record<Column, number>> = {};
  for (const column of Object.keys(HEADINGS) as Column[]) {
    for (const option of HEADINGS[column]) {
      const index = names.indexOf(option);
      if (index >= 0) { found[column] = index; break; }
    }
  }
  return found;
}

// The accountant export puts ' in front of text a spreadsheet could run as a formula.
const text = (value: string | undefined) => (value ?? "").replace(/^'(?=[=+\-@])/, "").replace(/\s+/g, " ").trim();
const digitsOnly = (value: string) => /^[+\d\s().,/-]+$/.test(value);
const readPhone = (value: string) => {
  const phone = digitsOnly(value) ? normaliseClientPhone(value) : null;
  // An Irish mobile is 08x plus seven digits; anything longer has something else stuck to it.
  return phone && !(phone.startsWith("3538") && phone.length !== 12) ? phone : undefined;
};

/**
 * The number in a phone cell, or undefined when there isn't exactly one way to read it. A wrong number is worse
 * than none, so the cell is then kept in the notes instead.
 *   "087 123 4567 or 01 234 5678"  several numbers: the first
 *   "087 123 4567, ext 12"         a number and some words: the number
 *   "087/1234567"                  a dialling prefix and the rest: one number
 *   "087 123 4567/12"              a number and loose digits: not read
 */
function firstPhone(value: string): string | undefined {
  const parts = value.split(/:::|[,;/]|\bor\b/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return readPhone(value);
  const numeric = parts.filter(digitsOnly);
  if (numeric.every(readPhone)) return numeric.map(readPhone)[0];
  const [prefix, rest] = parts;
  const split = parts.length === 2 && numeric.length === 2 && /^\(?[+0]/.test(prefix!) && prefix!.replace(/\D/g, "").length <= 5 && /^[1-9]/.test(rest!);
  return split ? readPhone(value) : undefined;
}
const isEmail = (value: string) => z.string().email().max(320).safeParse(value).success;
const firstEmail = (value: string) => value.toLowerCase().split(/:::|[,;/\s]/).find(isEmail);

/** Reads a client list out of a spreadsheet's rows. Throws when no names column can be found. */
export function clientSheet(table: string[][]): ClientSheet {
  const start = table.slice(0, 10).findIndex((row) => {
    const found = findColumns(row);
    return found.name !== undefined || found.first !== undefined || found.last !== undefined;
  });
  if (start < 0) throw new Error("Sorted couldn't find a column of names. Put the heading Name above your clients' names and try again.");
  const header = table[start]!, at = findColumns(header);
  const sheet: ClientSheet = {
    rows: [], noName: 0, unreadPhones: 0, unreadEmails: 0,
    columns: {
      name: at.name !== undefined ? header[at.name] : [at.first, at.last].flatMap((i) => i === undefined ? [] : [header[i]]).join(" + "),
      phone: at.phone === undefined ? undefined : header[at.phone],
      email: at.email === undefined ? undefined : header[at.email],
      notes: at.notes === undefined ? undefined : header[at.notes],
    },
  };
  const cell = (row: string[], index: number | undefined) => index === undefined ? "" : text(row[index]);
  for (const row of table.slice(start + 1)) {
    if (!row.some((value) => text(value))) continue;
    const name = (cell(row, at.name) || `${cell(row, at.first)} ${cell(row, at.last)}`.trim()).slice(0, 200);
    if (!name) { sheet.noName++; continue; }
    if (EXAMPLE.test(name)) continue;
    const phoneText = cell(row, at.phone), emailText = cell(row, at.email);
    const phone = firstPhone(phoneText), email = firstEmail(emailText);
    // Nothing is thrown away: a cell Sorted can't read, or one holding more than it used, goes into the notes as written.
    const unread: string[] = [];
    if (phoneText && !phone) sheet.unreadPhones++;
    if (emailText && !email) sheet.unreadEmails++;
    if (phoneText && (!phone || phone !== readPhone(phoneText))) unread.push(`Phone as written: ${phoneText}`);
    if (emailText && email !== emailText.toLowerCase()) unread.push(`Email as written: ${emailText}`);
    // Long notes give way to the unread details, never the other way round.
    const details = unread.join(" · ").slice(0, 2000);
    const notes = cell(row, at.notes).slice(0, Math.max(0, 2000 - details.length - (details ? 3 : 0)));
    sheet.rows.push({ name, phone, email, notes: [notes, details].filter(Boolean).join(" · ") || undefined });
  }
  return sheet;
}

const nameKey = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();
type Known = Pick<Client, "name" | "phone" | "email">;

/**
 * Decides which rows are new. A row is already there when its phone or email matches,
 * or its name matches and the phone numbers don't disagree (two Mary Murphys with different numbers are both kept).
 */
export function planClientImport(rows: ImportClientRow[], existing: Known[]) {
  const index = () => {
    const phones = new Set<string>(), emails = new Set<string>(), names = new Map<string, Array<string | null>>();
    return {
      add(client: { name: string; phone?: string | null; email?: string | null }) {
        // Older clients may have a number saved as typed, so compare the normalised form.
        const phone = client.phone ? normaliseClientPhone(client.phone) ?? client.phone : null;
        if (phone) phones.add(phone);
        if (client.email) emails.add(client.email.toLowerCase());
        const key = nameKey(client.name);
        names.set(key, [...(names.get(key) ?? []), phone]);
      },
      has: (row: ImportClientRow) =>
        Boolean(row.phone && phones.has(row.phone)) || Boolean(row.email && emails.has(row.email.toLowerCase()))
        || (names.get(nameKey(row.name)) ?? []).some((phone) => !phone || !row.phone || phone === row.phone),
    };
  };
  const inSorted = index(), inFile = index();
  existing.forEach(inSorted.add);
  const add: ImportClientRow[] = [];
  let alreadyThere = 0, repeated = 0;
  for (const row of rows) {
    if (inSorted.has(row)) alreadyThere++;
    else if (inFile.has(row)) repeated++;
    else { add.push(row); inFile.add(row); }
  }
  return { add, alreadyThere, repeated };
}

const XLSX_START = [0x50, 0x4b];
const OLD_XLS_START = [0xd0, 0xcf, 0x11, 0xe0];
const startsWith = (bytes: Uint8Array, start: number[]) => start.every((byte, index) => bytes[index] === byte);

/** Reads the first sheet of an Excel (.xlsx) file, or a CSV file, into rows of text. */
export async function readTable(file: Blob): Promise<string[][]> {
  if (file.size > IMPORT_MAX_BYTES) throw new Error("That file is over 5 MB. Split it into smaller files and add them one at a time.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (startsWith(bytes, OLD_XLS_START)) throw new Error("That's an older Excel file (.xls). Open it and save it as Excel Workbook (.xlsx) or CSV, then try again.");
  if (startsWith(bytes, XLSX_START)) {
    const { readSheet } = await import("read-excel-file/universal");
    let sheet: unknown[][];
    try { sheet = await readSheet(file); }
    catch { throw new Error("Sorted couldn't read that file. Save it as Excel Workbook (.xlsx) or CSV and try again."); }
    return sheet.map((row) => row.map((value) =>
      value === null || value === undefined ? "" : value instanceof Date ? value.toISOString().slice(0, 10) : String(value)));
  }
  if (bytes.subarray(0, 4096).includes(0)) throw new Error("Sorted can only read Excel (.xlsx) and CSV files.");
  let decoded: string;
  // Excel on Windows saves plain "CSV" in Windows-1252, which is not valid UTF-8 once a name has an accent.
  try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { decoded = new TextDecoder("windows-1252").decode(bytes); }
  return parseCsv(decoded);
}

/** The ready-made file a trader can fill in: the four headings and two example rows that are never imported. */
export async function clientTemplate(): Promise<Blob> {
  const { default: writeXlsxFile } = await import("write-excel-file/universal");
  const rows = [
    ["Example: Mary Murphy", "087 123 4567", "mary@example.com", "Delete this row or leave it. Rows starting with Example are skipped."],
    ["Example: Seán Byrne", "", "", ""],
  ];
  const blob = await writeXlsxFile([
    CLIENT_TEMPLATE_HEADER.map((value) => ({ value, type: String, fontWeight: "bold" as const })),
    ...rows.map((row) => row.map((value) => value ? { value, type: String } : null)),
  ], { sheet: "Clients", stickyRowsCount: 1, columns: [{ width: 28 }, { width: 18 }, { width: 28 }, { width: 44 }] }).toBlob();
  return new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
