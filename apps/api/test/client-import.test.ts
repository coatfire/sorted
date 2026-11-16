import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { clientSheet, clientTemplate, parseCsv, planClientImport, readTable, toCsv, type Client, type ImportBatch, type ImportClientsResult } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import { demoBackend, resetDemo } from "../../web/src/lib/demoBackend";
import { searchClients } from "../../web/src/lib/clientSearch";

afterEach(() => { vi.unstubAllGlobals(); });

async function trader() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const token = await issueJwt(user.id, user.sessionVersion);
  const request = (path: string, body?: object, method = body ? "POST" : "GET") => app.request(`/api${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const clients = async () => (await request("/clients")).json() as Promise<Client[]>;
  const imports = async () => (await request("/imports")).json() as Promise<ImportBatch[]>;
  return { user, request, clients, imports };
}

describe("reading a client list", () => {
  it("splits CSV with quotes, semicolons, a BOM and Windows line endings", () => {
    expect(parseCsv('\uFEFFName,Phone\r\n"Murphy, Mary","087 ""work"""\r\nSeán,\r\n')).toEqual([["Name", "Phone"], ["Murphy, Mary", '087 "work"'], ["Seán", ""]]);
    expect(parseCsv("Name;Phone\nAoife;0871234567")).toEqual([["Name", "Phone"], ["Aoife", "0871234567"]]);
    expect(clientSheet(parseCsv("\r\n\r\nName;Phone\r\nAoife;0871234567")).rows).toEqual([{ name: "Aoife", phone: "353871234567", email: undefined, notes: undefined }]);
    expect(parseCsv('Name\tNotes\n"two\nlines"\tx')).toEqual([["Name", "Notes"], ["two\nlines", "x"]]);
  });

  it("recognises common headings, joins first and last names and keeps what it can't use", () => {
    const sheet = clientSheet([
      ["My clients 2025"],
      ["First Name", "Last Name", "Telephone", "Mobile Number", "E-mail Address", "Comments"],
      ["Gráinne", "Flynn", "01 234 5678", "087 123 4567", "Grainne@Example.com", "Bridal trial"],
      ["Méabh", "", "", "871234568", "not-an-email", ""],
      ["Róisín", "Daly", "", "ask her sister", "", "'=SUM(1,2)"],
      ["", "", "", "0871111111", "", ""],
      ["", "", "", "", "", ""],
      ["Example:", "Mary Murphy", "", "", "", ""],
    ]);
    expect(sheet.columns).toEqual({ name: "First Name + Last Name", phone: "Mobile Number", email: "E-mail Address", notes: "Comments" });
    expect(sheet.rows).toEqual([
      { name: "Gráinne Flynn", phone: "353871234567", email: "grainne@example.com", notes: "Bridal trial" },
      { name: "Méabh", phone: "353871234568", email: undefined, notes: "Email as written: not-an-email" },
      { name: "Róisín Daly", phone: undefined, email: undefined, notes: "=SUM(1,2) · Phone as written: ask her sister" },
    ]);
    expect(sheet).toMatchObject({ noName: 1, unreadPhones: 1, unreadEmails: 1 });
    expect(clientSheet([["Name", "Phone 1 - Value"], ["Aoife", "087 123 4567 ::: 01 234 5678"]]).rows).toEqual([{ name: "Aoife", phone: "353871234567", email: undefined, notes: undefined }]);
    expect(clientSheet([["Name", "Email"], ["Mary", "mary@or.ie"], ["Orla", "or@example.com or orla@example.com"], ["Una", "una@example.com; other@example.com"], ["Ita", "Ita@Example.com/orla@example.com"], ["Eve", "work: eve@example.com"]]).rows.map((row) => row.email)).toEqual(["mary@or.ie", "or@example.com", "una@example.com", "ita@example.com", "eve@example.com"]);
    expect(clientSheet([["Name", "Phone"], ["A", "087/1234567"], ["B", "01 234 5678 / 086 111 2222"], ["C", "ask her sister or 085 111 2222"], ["D", "landline only, ask Mary"]]).rows.map((row) => [row.phone, row.notes])).toEqual([
      ["353871234567", undefined], ["35312345678", undefined], ["353851112222", undefined], [undefined, "Phone as written: landline only, ask Mary"]]);
    expect(clientSheet([["Name", "Email"], ["Mary", "Ask Mary for address"]]).rows[0]).toMatchObject({ email: undefined, notes: "Email as written: Ask Mary for address" });
    const long = clientSheet([["Name", "Phone", "Notes"], ["Mary", "ask her sister", "x".repeat(2500)]]).rows[0]!.notes!;
    expect(long).toHaveLength(2000);
    expect(long.endsWith(" · Phone as written: ask her sister")).toBe(true);
    expect(() => clientSheet([["Gráinne Flynn", "0871234567"]])).toThrow(/column of names/);
  });

  it("leaves out clients already in Sorted and rows repeated in the file", () => {
    const existing = [{ name: "Mary Murphy", phone: "+353 87 123 4567", email: null }, { name: "Aoife Byrne", phone: null, email: "aoife@example.com" }];
    const plan = planClientImport([
      { name: "M. Murphy", phone: "353871234567" },          // same phone
      { name: "Aoife B", email: "AOIFE@example.com" },      // same email
      { name: "mary  murphy" },                             // same name, no number to disagree
      { name: "Mary Murphy", phone: "353861111111" },       // a different Mary Murphy
      { name: "Niamh Kelly", phone: "353851111111" },
      { name: "Niamh Kelly" },                              // repeated in the file
      { name: "Someone Else", phone: "353851111111" },      // repeated phone in the file
    ], existing);
    expect(plan.add.map((row) => row.name)).toEqual(["Mary Murphy", "Niamh Kelly"]);
    expect(plan).toMatchObject({ alreadyThere: 3, repeated: 2 });
  });

  it("reads Excel and CSV files, including the template and Windows-1252 CSV", async () => {
    const template = await readTable(await clientTemplate());
    expect(template[0]).toEqual(["Name", "Phone", "Email", "Notes"]);
    expect(clientSheet(template).rows).toEqual([]);
    const csv = new Blob([toCsv([["Name", "Phone"], ["Gráinne Flynn – bride", "087 123 4567"]])]);
    expect(clientSheet(await readTable(csv)).rows[0]).toMatchObject({ name: "Gráinne Flynn – bride", phone: "353871234567" });
    const windows = new Blob([new Uint8Array([...Buffer.from("Name\r\nGr"), 0xe1, ...Buffer.from("inne\r\n")])]);
    expect((await readTable(windows))[1]).toEqual(["Gráinne"]);
    await expect(readTable(new Blob([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0])]))).rejects.toThrow(/\.xls/);
    await expect(readTable(new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 1])]))).rejects.toThrow(/Excel \(\.xlsx\) and CSV/);
    await expect(readTable(new Blob([new Uint8Array([0x50, 0x4b, 3, 4, 9, 9])]))).rejects.toThrow(/couldn't read/);
  });
});

describe("importing clients", () => {
  const file = { file_name: "clients.xlsx", clients: [{ name: "Gráinne Flynn", phone: "087 123 4567", email: "grainne@example.com", notes: "Bridal" }, { name: "Méabh Kavanagh" }, { name: "Gráinne F", phone: "+353 87 123 4567" }] };

  it("adds new clients once, however often the file is sent", async () => {
    const { request, clients, imports } = await trader();
    await request("/clients", { name: "Méabh Kavanagh", phone: "0861111111" });
    const first = await request("/imports/clients", file);
    expect(first.status).toBe(201);
    const result = await first.json() as ImportClientsResult;
    expect(result).toMatchObject({ added: 1, alreadyThere: 2 });
    expect((await clients()).map((client) => [client.name, client.phone, client.email]).sort()).toEqual([["Gráinne Flynn", "353871234567", "grainne@example.com"], ["Méabh Kavanagh", "353861111111", null]]);
    const again = await request("/imports/clients", file);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ importId: null, added: 0, alreadyThere: 3 });
    expect(await clients()).toHaveLength(2);
    expect(await imports()).toMatchObject([{ id: result.importId, kind: "clients", fileName: "clients.xlsx", clients: 1 }]);
    const both = await Promise.all([request("/imports/clients", { clients: [{ name: "Twice" }] }), request("/imports/clients", { clients: [{ name: "Twice" }] })]);
    expect(both.map((response) => response.status).sort()).toEqual([200, 201]);
  });

  it("rejects an empty, oversized or invalid list without saving anything", async () => {
    const { request, clients } = await trader();
    expect((await request("/imports/clients", { clients: [] })).status).toBe(400);
    expect((await request("/imports/clients", { clients: Array.from({ length: 2001 }, (_, i) => ({ name: `Client ${i}` })) })).status).toBe(400);
    expect((await request("/imports/clients", { clients: [{ name: "Fine" }, { name: "Bad", email: "nope" }] })).status).toBe(400);
    expect(await clients()).toEqual([]);
  });

  it("undoes an import, keeping clients who have since been booked and everyone else's data", async () => {
    const mine = await trader(), other = await trader();
    await mine.request("/clients", { name: "Here before" });
    const { importId } = await (await mine.request("/imports/clients", { clients: [{ name: "Booked Since" }, { name: "Never Booked" }, { name: "Also Unused" }] })).json() as ImportClientsResult;
    const theirs = await (await other.request("/imports/clients", { clients: [{ name: "Their Client" }] })).json() as ImportClientsResult;
    const booked = (await mine.clients()).find((client) => client.name === "Booked Since")!;
    expect((await mine.request("/bookings", { status: "confirmed", client_id: booked.id, service: "Cut", price_cents: 5000, deposit_cents: 0, start_at: new Date(Date.now() + 86400000).toISOString() })).status).toBe(201);

    expect((await mine.request(`/imports/${importId}`, undefined, "DELETE")).status).toBe(400);
    expect((await mine.request(`/imports/${theirs.importId}`, { confirm: true }, "DELETE")).status).toBe(404);
    expect((await mine.request("/imports/not-an-id", { confirm: true }, "DELETE")).status).toBe(404);
    const undone = await mine.request(`/imports/${importId}`, { confirm: true }, "DELETE");
    expect(await undone.json()).toEqual({ removed: 2, kept: 1 });
    expect((await mine.clients()).map((client) => client.name).sort()).toEqual(["Booked Since", "Here before"]);
    expect(await mine.imports()).toEqual([]);
    expect(await other.clients()).toHaveLength(1);
    expect(await other.imports()).toHaveLength(1);
    const [kept] = await db.select().from(schema.clients).where(eq(schema.clients.id, booked.id));
    expect(kept.importId).toBeNull();
    expect((await mine.request(`/imports/${importId}`, { confirm: true }, "DELETE")).status).toBe(404);
  });
});

describe("importing clients in the demo", () => {
  it("adds, skips repeats, and undoes all but booked clients", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    resetDemo();
    const before = (await demoBackend.load()).clients;
    const rows = [{ name: before[0]!.name }, { name: "Gráinne Flynn", phone: "353875551234" }, { name: "Méabh Kavanagh" }];
    const result = await demoBackend.importClients("clients.csv", rows);
    expect(result).toMatchObject({ added: 2, alreadyThere: 1 });
    expect(await demoBackend.importClients("clients.csv", rows)).toEqual({ importId: null, added: 0, alreadyThere: 3 });
    const meabh = (await demoBackend.load()).clients.find((client) => client.name === "Méabh Kavanagh")!;
    await demoBackend.createBooking({ status: "enquiry", clientId: meabh.id, service: "Cut", startAt: null, priceCents: null, depositCents: 0, location: null, notes: null });
    expect(await demoBackend.imports()).toMatchObject([{ id: result.importId, fileName: "clients.csv", clients: 2 }]);
    expect(await demoBackend.undoImport(result.importId!)).toEqual({ removed: 1, kept: 1 });
    expect((await demoBackend.load()).clients.map((client) => client.name).sort()).toEqual([...before.map((client) => client.name), "Méabh Kavanagh"].sort());
    expect(await demoBackend.imports()).toEqual([]);
    const added = await demoBackend.createClient({ name: "Hand Added", phone: "085 222 3333" });
    expect((await demoBackend.load()).clients.find((client) => client.id === added.id)).toMatchObject({ name: "Hand Added", phone: "353852223333" });
  });
});

describe("searching clients", () => {
  const clients = [{ name: "Gráinne Flynn", phone: "353871234567", email: "grainne@example.com" }, { name: "Seán Byrne", phone: null, email: null }];
  it("finds by name without accents, by email, and by a number however it is typed", () => {
    const found = (query: string) => searchClients(clients, query).map((client) => client.name);
    expect(found(" grainne ")).toEqual(["Gráinne Flynn"]);
    expect(found("SEAN")).toEqual(["Seán Byrne"]);
    expect(found("example.com")).toEqual(["Gráinne Flynn"]);
    for (const query of ["087 123", "0871234567", "00353 87 123 4567", "+353 87 123 4567", "353871234567"]) expect(found(query)).toEqual(["Gráinne Flynn"]);
    expect(found("zzz")).toEqual([]);
    expect(found("")).toHaveLength(2);
  });
});
