import { expect, it } from "vitest";
import { toCsv } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import { demoBackend, resetDemo } from "../../web/src/lib/demoBackend";

const BOM = [0xef, 0xbb, 0xbf];
const firstBytes = (buffer: ArrayBuffer) => [...new Uint8Array(buffer).slice(0, 3)];

it("quotes cells and keeps text from running as a formula", () => {
  expect(toCsv([["a", 'say "hi"', null, 0], [], ["x,y", "line\nbreak"]])).toBe('\uFEFF"a","say ""hi""","","0"\n\n"x,y","line\nbreak"');
  expect(toCsv([["=SUM(A1)", "+353 87", "-cmd", "@home", "\tx"]])).toBe(`\uFEFF"'=SUM(A1)","'+353 87","'-cmd","'@home","'\tx"`);
  expect(toCsv([["-12.50", -3, "2025-01-02", "O'Brien – cut"]])).toBe(`\uFEFF"-12.50","-3","2025-01-02","O'Brien – cut"`);
});

it("exports accented names so Excel and Sheets read them as UTF-8", async () => {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com`, businessName: "Studio" }).returning();
  const [client] = await db.insert(schema.clients).values({ userId: user.id, name: "Gráinne Ní Bhriain" }).returning();
  const [booking] = await db.insert(schema.bookings).values({ userId: user.id, clientId: client.id, status: "completed", service: "Bridal hair – bride", startAt: new Date("2025-06-01"), priceCents: 5000 }).returning();
  await db.insert(schema.payments).values({ userId: user.id, bookingId: booking.id, kind: "full", status: "paid", method: "cash", amountCents: 5000, paidAt: new Date("2025-06-01T12:00:00Z"), vatRateBp: 0 });
  await db.insert(schema.expenses).values({ userId: user.id, merchant: "=HYPERLINK(\"http://x\")", category: "materials", amountCents: 1000, expenseDate: new Date("2025-06-02"), status: "confirmed" });
  const response = await app.request("/api/reports/export?year=2025", { headers: { Authorization: `Bearer ${await issueJwt(user.id, user.sessionVersion)}` } });
  expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
  const bytes = await response.arrayBuffer();
  expect(firstBytes(bytes)).toEqual(BOM);
  const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  expect(csv.startsWith('\uFEFF"INCOME"\n')).toBe(true);
  expect(csv).toContain('"2025-06-01","Gráinne Ní Bhriain","Bridal hair – bride","full","cash","50.00"');
  expect(csv).toContain(`"2025-06-02","'=HYPERLINK(""http://x"")","materials","10.00","no",""`);
});

it("the demo export opens the same way", async () => {
  resetDemo();
  const blob = await demoBackend.exportFile({ from: "2000-01-01", to: "2099-12-31" }, "csv");
  expect(firstBytes(await blob.arrayBuffer())).toEqual(BOM);
  expect(blob.type).toBe("text/csv;charset=utf-8");
});
