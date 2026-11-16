import { expect, it } from "vitest";
import { exportBounds, exportFileName, ExportRange, paidOn, yearRange } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import { demoBackend, resetDemo } from "../../web/src/lib/demoBackend";

async function fixture() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com`, businessName: "Studio" }).returning();
  const [client] = await db.insert(schema.clients).values({ userId: user.id, name: "Client" }).returning();
  const [booking] = await db.insert(schema.bookings).values({ userId: user.id, clientId: client.id, status: "completed", service: "Bridal hair", startAt: new Date("2025-06-01"), priceCents: 900000 }).returning();
  const pay = (amountCents: number, paidAt: string, status: "paid" | "pending" = "paid") =>
    db.insert(schema.payments).values({ userId: user.id, bookingId: booking.id, kind: "custom", status, method: "cash", amountCents, paidAt: new Date(paidAt), vatRateBp: 0 });
  const spend = (amountCents: number, date: string, status: "confirmed" | "needs_review" = "confirmed") =>
    db.insert(schema.expenses).values({ userId: user.id, merchant: `Shop ${amountCents}`, category: "materials", amountCents, expenseDate: new Date(date), status });
  const headers = { Authorization: `Bearer ${await issueJwt(user.id, user.sessionVersion)}` };
  const exported = (query: string) => app.request(`/api/reports/export${query}`, { headers });
  return { user, pay, spend, exported };
}
const amounts = (csv: string) => [...csv.matchAll(/"(\d+\.\d{2})"/g)].map((match) => match[1]);

it("validates a range and names the file", () => {
  expect(ExportRange.safeParse({ from: "2025-01-01", to: "2025-01-01" }).success).toBe(true);
  for (const range of [{ from: "2025-02-01", to: "2025-01-31" }, { from: "2025-02-30", to: "2025-03-01" }, { from: "", to: "2025-03-01" }, { from: "2025-01-01" }])
    expect(ExportRange.safeParse(range).success).toBe(false);
  expect(exportFileName(yearRange(2025))).toBe("sorted-2025.csv");
  expect(exportFileName({ from: "2025-04-06", to: "2026-04-05" })).toBe("sorted-2025-04-06-to-2026-04-05.csv");
  expect(exportFileName(yearRange(2025), "xlsx")).toBe("sorted-2025.xlsx");
  expect(exportFileName({ from: "2025-04-06", to: "2026-04-05" }, "xlsx")).toBe("sorted-2025-04-06-to-2026-04-05.xlsx");
  expect(exportBounds({ from: "2025-07-01", to: "2025-07-31" })).toEqual({
    paidFrom: new Date("2025-06-30T23:00:00Z"), paidBefore: new Date("2025-07-31T23:00:00Z"),
    expenseFrom: new Date("2025-07-01T00:00:00Z"), expenseBefore: new Date("2025-08-01T00:00:00Z"),
  });
});

it("exports only what falls inside the dates, both days included, oldest first", async () => {
  const f = await fixture();
  await f.pay(1100, "2025-03-10T12:00:00Z");
  await f.pay(1000, "2025-02-28T23:59:00Z");
  await f.pay(1200, "2025-03-01T00:00:00Z");
  await f.pay(1300, "2025-03-31T22:59:00Z");
  await f.pay(1400, "2025-03-31T23:00:00Z");
  await f.pay(1500, "2025-03-15T12:00:00Z", "pending");
  await f.spend(2100, "2025-03-31");
  await f.spend(2000, "2025-02-28");
  await f.spend(2200, "2025-03-01");
  await f.spend(2300, "2025-04-01");
  await f.spend(2400, "2025-03-15", "needs_review");
  const response = await f.exported("?from=2025-03-01&to=2025-03-31");
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Disposition")).toBe("attachment; filename=sorted-2025-03-01-to-2025-03-31.csv");
  const csv = await response.text();
  expect(amounts(csv)).toEqual(["12.00", "11.00", "13.00", "22.00", "21.00"]);
  expect(csv).toContain('"2025-03-01","Client","Bridal hair"');
  expect(amounts(await (await f.exported("?from=2025-03-10&to=2025-03-10")).text())).toEqual(["11.00"]);
});

it("counts a payment on the day it was received in Ireland", async () => {
  const f = await fixture();
  await f.pay(3000, "2025-06-30T23:30:00Z");
  expect(amounts(await (await f.exported("?from=2025-06-01&to=2025-06-30")).text())).toEqual([]);
  const july = await (await f.exported("?from=2025-07-01&to=2025-07-31")).text();
  expect(july).toContain('"2025-07-01","Client"');
  expect(amounts(july)).toEqual(["30.00"]);
});

it("still exports a whole year, and last year's export leaves this year out", async () => {
  const f = await fixture();
  await f.pay(4000, "2025-12-31T23:59:00Z");
  await f.pay(4100, "2026-01-01T00:00:00Z");
  await f.spend(4200, "2025-12-31");
  await f.spend(4300, "2026-01-01");
  const year = await f.exported("?year=2025");
  expect(year.headers.get("Content-Disposition")).toBe("attachment; filename=sorted-2025.csv");
  expect(amounts(await year.text())).toEqual(["40.00", "42.00"]);
  const range = await f.exported("?from=2025-01-01&to=2025-12-31");
  expect(range.headers.get("Content-Disposition")).toBe("attachment; filename=sorted-2025.csv");
  expect(amounts(await range.text())).toEqual(["40.00", "42.00"]);
  expect(amounts(await (await f.exported("?from=2025-12-31&to=2026-01-01")).text())).toEqual(["40.00", "41.00", "42.00", "43.00"]);
});

it.each(["?from=2025-03-01", "?to=2025-03-01", "?from=2025-03-02&to=2025-03-01", "?from=1%20Mar&to=2025-03-01", "?from=2025-02-30&to=2025-03-01", "?year=abc", "?year=99999"])("rejects %s", async (query) => {
  const f = await fixture();
  const response = await f.exported(query);
  expect(response.status).toBe(400);
  expect(await response.json()).toHaveProperty("error");
});

it("never includes another trader's money, and needs a login", async () => {
  const [mine, theirs] = [await fixture(), await fixture()];
  await theirs.pay(5000, "2025-03-10T12:00:00Z");
  await theirs.spend(5100, "2025-03-10");
  expect(amounts(await (await mine.exported("?from=2025-01-01&to=2025-12-31")).text())).toEqual([]);
  expect((await app.request("/api/reports/export?from=2025-01-01&to=2025-12-31")).status).toBe(401);
});

it("the demo exports the same range, oldest first", async () => {
  resetDemo();
  const { payments, expenses } = await demoBackend.load();
  const paid = payments.filter((payment) => payment.status === "paid" && payment.paidAt).map((payment) => paidOn(payment.paidAt!)).sort();
  expect(paid.length).toBeGreaterThan(1);
  const [first, last] = [paid[0], paid[paid.length - 1]];
  const rows = async (from: string, to: string) => (await (await demoBackend.exportFile({ from, to }, "csv")).text()).split("\n");
  const all = await rows("2000-01-01", "2099-12-31");
  const income = all.slice(2, all.indexOf(""));
  expect(income).toHaveLength(paid.length);
  expect(income.map((row) => row.slice(1, 11))).toEqual(paid);
  // The demo has trips, so a MILEAGE table follows the expenses.
  const mileage = all.indexOf("", all.indexOf("") + 1);
  expect(all[mileage + 1]).toBe('"MILEAGE"');
  expect(all.slice(all.indexOf("") + 3, mileage)).toHaveLength(expenses.filter((expense) => expense.expenseDate).length);
  const onlyFirst = await rows(first, first);
  expect(onlyFirst.slice(2, onlyFirst.indexOf(""))).toHaveLength(paid.filter((date) => date === first).length);
  const none = await rows("1999-01-01", "1999-12-31");
  expect(none).toHaveLength(5);
  const untilLast = await rows(first, last);
  expect(untilLast.slice(2, untilLast.indexOf(""))).toHaveLength(paid.length);
});
