import { unzipSync, strFromU8 } from "fflate";
import { expect, it } from "vitest";
import { exportSections, exportXlsx, XLSX_TYPE } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import { demoBackend, resetDemo } from "../../web/src/lib/demoBackend";

const unescape = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Every sheet of an .xlsx as rows of cells: text as a string, a number as a number. */
async function readXlsx(file: Blob | ArrayBuffer) {
  const bytes = new Uint8Array(file instanceof Blob ? await file.arrayBuffer() : file);
  expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
  const files = unzipSync(bytes);
  const xml = (path: string) => strFromU8(files[path]);
  const strings = [...xml("xl/sharedStrings.xml").matchAll(/<si><t[^>]*>([\s\S]*?)<\/t><\/si>/g)].map((match) => unescape(match[1]));
  const names = [...xml("xl/workbook.xml").matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((match) => unescape(match[1]));
  return Object.fromEntries(names.map((name, index) => {
    const sheet = xml(`xl/worksheets/sheet${index + 1}.xml`);
    expect(sheet).not.toContain("<f>");
    const rows = [...sheet.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
      [...row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(?:<v>([\s\S]*?)<\/v>)?<\/c>)/g)].reduce<(string | number | null)[]>((cells, [, column, attributes, value]) => {
        cells[column.charCodeAt(0) - 65] = value === undefined ? null : /t="s"/.test(attributes) ? strings[Number(value)] : Number(value);
        return cells;
      }, []))
      .map((cells) => Array.from(cells, (cell) => cell ?? null));
    return [name, rows];
  }));
}

it("writes income and expenses as two sheets, with names as typed and amounts as numbers", async () => {
  const blob = await exportXlsx(exportSections(
    [
      { paidOn: "2025-01-02", client: "Gráinne Ní Bhriain", service: "Bridal hair – bride & 2 <bridesmaids>", kind: "full", method: "cash", amountCents: 5505 },
      { paidOn: "2025-01-03", client: "=HYPERLINK(\"http://x\")", service: "+353 87", kind: "deposit", method: null, amountCents: 2000 },
    ],
    [{ date: "2025-01-20", merchant: "Méabh's – “salon” supplies", category: "materials", amountCents: 1210, hasReceipt: true, vatCents: null }],
  ));
  expect(blob.type).toBe(XLSX_TYPE);
  expect(await readXlsx(blob)).toEqual({
    Income: [
      ["date_paid", "client", "service", "kind", "method", "amount_eur"],
      ["2025-01-02", "Gráinne Ní Bhriain", "Bridal hair – bride & 2 <bridesmaids>", "full", "cash", 55.05],
      ["2025-01-03", "=HYPERLINK(\"http://x\")", "+353 87", "deposit", null, 20],
    ],
    Expenses: [
      ["date", "merchant", "category", "amount_eur", "has_receipt", "vat_eur"],
      ["2025-01-20", "Méabh's – “salon” supplies", "materials", 12.1, "yes"],
    ],
  });
});

it("an empty period still has both sheets and their headings", async () => {
  expect(await readXlsx(await exportXlsx(exportSections([], [])))).toEqual({
    Income: [["date_paid", "client", "service", "kind", "method", "amount_eur"]],
    Expenses: [["date", "merchant", "category", "amount_eur", "has_receipt", "vat_eur"]],
  });
});

it("the API sends the Excel file for format=xlsx and keeps CSV otherwise", async () => {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com`, businessName: "Studio" }).returning();
  const [other] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com`, businessName: "Other" }).returning();
  for (const [owner, name] of [[user, "Róisín Daly"], [other, "Someone Else"]] as const) {
    const [client] = await db.insert(schema.clients).values({ userId: owner.id, name }).returning();
    const [booking] = await db.insert(schema.bookings).values({ userId: owner.id, clientId: client.id, status: "completed", service: "Bridal hair – bride", startAt: new Date("2025-06-01"), priceCents: 5000 }).returning();
    await db.insert(schema.payments).values({ userId: owner.id, bookingId: booking.id, kind: "full", status: "paid", method: "cash", amountCents: 5000, paidAt: new Date("2025-06-01T12:00:00Z"), vatRateBp: 0 });
  }
  await db.insert(schema.expenses).values({ userId: user.id, merchant: "=HYPERLINK(\"http://x\")", category: "materials", amountCents: 1000, vatCents: 187, expenseDate: new Date("2025-06-02"), status: "confirmed" });
  const get = async (query: string) => app.request(`/api/reports/export?${query}`, { headers: { Authorization: `Bearer ${await issueJwt(user.id, user.sessionVersion)}` } });

  const response = await get("from=2025-06-01&to=2025-06-30&format=xlsx");
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe(XLSX_TYPE);
  expect(response.headers.get("Content-Disposition")).toBe("attachment; filename=sorted-2025-06-01-to-2025-06-30.xlsx");
  expect(await readXlsx(await response.arrayBuffer())).toEqual({
    Income: [
      ["date_paid", "client", "service", "kind", "method", "amount_eur"],
      ["2025-06-01", "Róisín Daly", "Bridal hair – bride", "full", "cash", 50],
    ],
    Expenses: [
      ["date", "merchant", "category", "amount_eur", "has_receipt", "vat_eur"],
      ["2025-06-02", "=HYPERLINK(\"http://x\")", "materials", 10, "no", 1.87],
    ],
  });

  const year = await get("year=2025&format=xlsx");
  expect(year.headers.get("Content-Disposition")).toBe("attachment; filename=sorted-2025.xlsx");
  expect((await readXlsx(await year.arrayBuffer())).Income).toHaveLength(2);
  expect((await readXlsx(await (await get("year=2024&format=xlsx")).arrayBuffer())).Income).toHaveLength(1);

  const csv = await get("year=2025");
  expect(csv.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
  expect(await csv.text()).toContain('"2025-06-01","Róisín Daly","Bridal hair – bride","full","cash","50.00"');
  expect((await get("year=2025&format=pdf")).status).toBe(400);
});

it("the demo's Excel file holds the same rows as its CSV", async () => {
  resetDemo();
  const range = { from: "2000-01-01", to: "2099-12-31" };
  const sheets = await readXlsx(await demoBackend.exportFile(range, "xlsx"));
  const csv = (await (await demoBackend.exportFile(range, "csv")).text()).split("\n");
  const blank = csv.indexOf("");
  expect(sheets.Income).toHaveLength(blank - 1);
  const mileage = csv.indexOf("", blank + 1);
  expect(sheets.Expenses).toHaveLength(mileage - blank - 2);
  expect(sheets.Mileage).toHaveLength(csv.length - mileage - 2);
  expect(sheets.Mileage[0]).toEqual(["date", "from", "to", "purpose", "km_there_and_back"]);
  expect(sheets.Mileage.slice(1).every((row) => typeof row[4] === "number" && row[4] > 0)).toBe(true);
  expect(sheets.Income.length).toBeGreaterThan(2);
  const text = (row: (string | number | null)[]) => `"${row.slice(0, 5).map((cell) => cell ?? "").join('","')}","${(row[5] as number).toFixed(2)}"`;
  expect(sheets.Income.slice(1).map(text)).toEqual(csv.slice(2, blank));
});
