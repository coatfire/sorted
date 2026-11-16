import { expect, it, vi } from "vitest";
import { exportCsvText, exportSections, historySheet, kmInput, kmLabel, lastTravelTo, mileageLog, mileageMetres, mileageSection, parseKm, type Trip } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import { demoBackend, resetDemo } from "../../web/src/lib/demoBackend";

async function account() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com`, businessName: "Studio", address: "1 Main Street\nBallincollig" }).returning();
  const headers = { Authorization: `Bearer ${await issueJwt(user.id, user.sessionVersion)}`, "Content-Type": "application/json" };
  const call = (method: string, path: string, body?: unknown) => app.request(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { user, call };
}
const booking = (start: string, km: number | null, extra: Record<string, unknown> = {}) => ({
  client: { name: "Aoife Murphy" }, service: "Bridal hair", status: "confirmed", start_at: start, price_cents: 5000,
  location: "7 West Village, Ballincollig", ...(km === null ? {} : { travel_metres: km * 1000 }), ...extra,
});

it("reads and shows km", () => {
  expect(parseKm("")).toBeNull();
  expect(parseKm("24")).toBe(24000);
  expect(parseKm(" 24,5 km ")).toBe(24500);
  expect(parseKm("24.56")).toBe(24600);
  for (const bad of ["abc", "-5", "0", "1e3", "6000", "12 34"]) expect(parseKm(bad)).toBeUndefined();
  expect(kmInput(24500)).toBe("24.5");
  expect(kmInput(null)).toBe("");
  expect(kmLabel(1240000)).toBe("1,240 km");
  expect(kmLabel(24500)).toBe("24.5 km");
});

it("offers the km from the last job at the same address", () => {
  const visits = [
    { location: "7 West Village, Ballincollig", travelMetres: 24000, startAt: "2026-01-10T10:00:00Z", createdAt: "2026-01-01T09:00:00Z" },
    { location: "7 west village  ballincollig", travelMetres: 26000, startAt: "2026-02-10T10:00:00Z", createdAt: "2026-02-01T09:00:00Z" },
    { location: "7 West Village, Ballincollig", travelMetres: null, startAt: "2026-03-10T10:00:00Z", createdAt: "2026-03-01T09:00:00Z" },
    { location: "Elsewhere", travelMetres: 90000, startAt: "2026-04-10T10:00:00Z", createdAt: "2026-04-01T09:00:00Z" },
  ];
  expect(lastTravelTo(visits, "7 West Village, Ballincollig")).toBe(26000);
  // An older job typed in afterwards doesn't become the "last" one.
  const backfilled = { location: "7 West Village, Ballincollig", travelMetres: 20000, startAt: "2025-06-01T10:00:00Z", createdAt: "2026-05-01T09:00:00Z" };
  expect(lastTravelTo([...visits, backfilled], "7 West Village, Ballincollig")).toBe(26000);
  // A job with no date yet goes by when it was added.
  const undated = { location: "7 West Village, Ballincollig", travelMetres: 28000, startAt: null, createdAt: "2026-05-02T09:00:00Z" };
  expect(lastTravelTo([...visits, backfilled, undated], "7 West Village, Ballincollig")).toBe(28000);
  expect(lastTravelTo(visits, "7 West Village")).toBeNull();
  expect(lastTravelTo(visits, " ")).toBeNull();
});

it("counts jobs that went ahead and trips, up to today, inside the dates", () => {
  const job = (id: string, status: "enquiry" | "confirmed" | "completed" | "cancelled", startAt: string | null, travelMetres: number | null) =>
    ({ id, status, startAt, travelMetres, location: "Venue", service: "Makeup", client: { name: "Ann" } });
  const trip = (tripDate: string, travelMetres: number): Trip => ({ id: tripDate, tripDate, destination: "Wholesaler", purpose: "Stock", travelMetres, createdAt: tripDate });
  const rows = mileageLog([
    job("done", "completed", "2026-03-10T10:00:00Z", 20000),
    job("past", "confirmed", "2026-06-30T23:30:00Z", 30000), // 1 July in Ireland
    job("future", "confirmed", "2026-12-01T10:00:00Z", 40000),
    job("cancelled", "cancelled", "2026-03-11T10:00:00Z", 50000),
    job("enquiry", "enquiry", "2026-03-12T10:00:00Z", 60000),
    job("none", "completed", "2026-03-13T10:00:00Z", null),
    job("old", "completed", "2025-12-31T10:00:00Z", 70000),
  ], [trip("2026-02-01", 5000), trip("2025-06-01", 9000)], { from: "2026-01-01", to: "2026-12-31" }, "2026-11-16");
  expect(rows.map((row) => [row.date, row.metres])).toEqual([["2026-02-01", 5000], ["2026-03-10", 20000], ["2026-07-01", 30000]]);
  expect(rows[1]).toMatchObject({ to: "Venue", purpose: "Makeup for Ann", bookingId: "done" });
  expect(mileageMetres(rows)).toBe(55000);
});

it("adds a Mileage table to the export only when there are trips, and the file still imports", () => {
  const income = [{ paidOn: "2026-03-10", client: "Ann", service: "Makeup", kind: "full", method: "cash", amountCents: 5000 }];
  expect(exportSections(income, [], mileageSection([], "Home")).map((section) => section.title)).toEqual(["Income", "Expenses"]);
  const sections = exportSections(income, [], mileageSection([{ date: "2026-03-10", to: "Venue", purpose: "Makeup for Ann", metres: 24500 }], "1 Main Street\nBallincollig"));
  const csv = exportCsvText(sections);
  expect(csv).toContain('"MILEAGE"');
  expect(csv).toContain('"date","from","to","purpose","km_there_and_back"');
  expect(csv).toContain('"2026-03-10","1 Main Street, Ballincollig","Venue","Makeup for Ann","24.5"');
  expect(csv).toContain('"50.00"');
  const rows = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/).map((line) => line ? line.slice(1, -1).split('","') : []);
  const sheet = historySheet([{ name: "sorted-2026", rows }], "2026-11-16");
  expect(sheet).toMatchObject({ noDate: 0, noAmount: 0, future: 0 });
  expect(sheet.income).toHaveLength(1);
  expect(sheet.expenses).toHaveLength(0);
});

it("saves km on a booking, copies it to repeats, and lets it be set after the job is done", async () => {
  const { call } = await account();
  const created = await (await call("POST", "/bookings", booking("2026-03-10T10:00:00Z", 24.5, { repeat: { every_weeks: 1, count: 2 } }))).json();
  expect(created.travelMetres).toBe(24500);
  const all = await (await call("GET", "/bookings")).json();
  expect(all.map((row: { booking: { travelMetres: number } }) => row.booking.travelMetres)).toEqual([24500, 24500]);
  expect((await call("PATCH", `/bookings/${created.id}`, { travel_metres: 30000 })).status).toBe(200);
  expect((await call("POST", `/bookings/${created.id}/complete`)).status).toBe(200);
  expect((await call("PATCH", `/bookings/${created.id}`, { travel_metres: 31000 })).status).toBe(409);
  expect((await (await call("PUT", `/bookings/${created.id}/travel`, { travel_metres: 31000 })).json()).travelMetres).toBe(31000);
  expect((await (await call("PUT", `/bookings/${created.id}/travel`, { travel_metres: null })).json()).travelMetres).toBeNull();
  for (const bad of [0, -1, 1.5, 6_000_000, "24"]) expect((await call("PUT", `/bookings/${created.id}/travel`, { travel_metres: bad })).status).toBe(400);
  expect((await call("POST", "/bookings", booking("2026-03-10T10:00:00Z", -3))).status).toBe(400);
});

it("keeps trips to their owner and refuses a future or incomplete trip", async () => {
  const mine = await account(), other = await account();
  const trip = { trip_date: "2026-02-01", destination: "Wholesaler", purpose: "Stock", travel_metres: 27000 };
  const saved = await (await mine.call("POST", "/trips", trip)).json();
  expect(saved).toMatchObject({ tripDate: "2026-02-01", destination: "Wholesaler", purpose: "Stock", travelMetres: 27000 });
  for (const bad of [{ ...trip, trip_date: "2999-01-01" }, { ...trip, destination: " " }, { ...trip, purpose: "" }, { ...trip, travel_metres: 0 }, { ...trip, trip_date: "01/02/2026" }])
    expect((await mine.call("POST", "/trips", bad)).status).toBe(400);
  expect(await (await other.call("GET", "/trips")).json()).toEqual([]);
  expect((await other.call("PATCH", `/trips/${saved.id}`, trip)).status).toBe(404);
  expect((await other.call("DELETE", `/trips/${saved.id}`)).status).toBe(404);
  expect((await (await mine.call("PATCH", `/trips/${saved.id}`, { ...trip, travel_metres: 30000 })).json()).travelMetres).toBe(30000);
  expect(await (await mine.call("GET", "/trips")).json()).toHaveLength(1);
  expect((await mine.call("DELETE", `/trips/${saved.id}`)).status).toBe(204);
  expect(await (await mine.call("GET", "/trips")).json()).toEqual([]);
  expect((await app.request("/api/trips")).status).toBe(401);
});

it("exports the mileage log for the dates asked for, from the business address", async () => {
  const mine = await account(), other = await account();
  await mine.call("POST", "/bookings", booking("2025-03-10T10:00:00Z", 24));
  await mine.call("POST", "/bookings", booking("2025-03-11T10:00:00Z", null));
  await mine.call("POST", "/bookings", booking("2024-03-10T10:00:00Z", 99));
  await mine.call("POST", "/bookings", booking("2025-03-12T10:00:00Z", 50, { status: "enquiry" }));
  await mine.call("POST", "/trips", { trip_date: "2025-02-01", destination: "Wholesaler", purpose: "Stock", travel_metres: 27500 });
  await mine.call("POST", "/trips", { trip_date: "2024-02-01", destination: "Wholesaler", purpose: "Stock", travel_metres: 88000 });
  await other.call("POST", "/trips", { trip_date: "2025-02-02", destination: "Not mine", purpose: "Stock", travel_metres: 77000 });
  const csv = await (await mine.call("GET", "/reports/export?year=2025")).text();
  const mileage = csv.slice(csv.indexOf('"MILEAGE"'));
  expect(mileage.trim().split(/\r?\n/)).toEqual([
    '"MILEAGE"',
    '"date","from","to","purpose","km_there_and_back"',
    '"2025-02-01","1 Main Street, Ballincollig","Wholesaler","Stock","27.5"',
    '"2025-03-10","1 Main Street, Ballincollig","7 West Village, Ballincollig","Bridal hair for Aoife Murphy","24.0"',
  ]);
  expect(await (await other.call("GET", "/reports/export?year=2024")).text()).not.toContain("MILEAGE");
  expect((await mine.call("GET", "/reports/export?year=2025&format=xlsx")).status).toBe(200);
});

it("works the same in the demo", async () => {
  await resetDemo();
  const before = await demoBackend.load();
  expect(before.trips).toHaveLength(1);
  const done = before.bookings.find((item) => item.status === "completed" && !item.travelMetres)!;
  await demoBackend.bookingTravel(done.id, 12000);
  await demoBackend.createTrip({ tripDate: "2020-01-05", destination: "Course", purpose: "Training day", travelMetres: 40000 });
  await expect(demoBackend.createTrip({ tripDate: "2999-01-05", destination: "Course", purpose: "Training day", travelMetres: 40000 })).rejects.toThrow();
  await expect(demoBackend.bookingTravel(done.id, -1)).rejects.toThrow();
  const after = await demoBackend.load();
  expect(after.bookings.find((item) => item.id === done.id)!.travelMetres).toBe(12000);
  const trip = after.trips.find((item) => item.destination === "Course")!;
  await demoBackend.updateTrip(trip.id, { tripDate: "2020-01-05", destination: "Course", purpose: "Training day", travelMetres: 41000 });
  const csv = await (await demoBackend.exportFile({ from: "2020-01-01", to: "2020-12-31" }, "csv")).text();
  expect(csv).toContain('"2020-01-05","","Course","Training day","41.0"');
  await demoBackend.deleteTrip(trip.id);
  expect((await demoBackend.load()).trips).toHaveLength(1);
});

it("backs up a year to Drive when its only records are mileage", async () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "drive-test-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
  try {
    const { call } = await account();
    await call("POST", "/trips", { trip_date: "2023-02-01", destination: "Wholesaler", purpose: "Stock", travel_metres: 27500 });
    await call("POST", "/bookings", booking("2024-03-10T10:00:00Z", 24));
    await call("POST", "/bookings", booking("2022-03-10T10:00:00Z", 24, { status: "enquiry" }));
    await call("POST", "/bookings", booking("2999-03-10T10:00:00Z", 24));
    expect((await (await call("GET", "/drive/files")).json()).years).toEqual([2023, 2024]);
  } finally { vi.unstubAllEnvs(); }
});
