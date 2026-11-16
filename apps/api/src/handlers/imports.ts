import { Hono } from "hono";
import { and, count, desc, eq, inArray, isNotNull, notExists } from "drizzle-orm";
import { ImportClientsInput, planClientImport, type ImportBatch, type ImportClientsResult, type UndoImportResult } from "@sorted/core";
import { db, schema } from "../db";
import type { AppEnv } from "../app";

export const importRoutes = new Hono<AppEnv>();

// One import at a time per trader: a double tap or two tabs can't add the same file twice.
const lockUser = (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userId: string) =>
  tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).for("update");

importRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const rows = await db.select({ batch: schema.imports, clients: count(schema.clients.id) }).from(schema.imports)
    .leftJoin(schema.clients, and(eq(schema.clients.importId, schema.imports.id), eq(schema.clients.userId, userId)))
    .where(eq(schema.imports.userId, userId)).groupBy(schema.imports.id).orderBy(desc(schema.imports.createdAt));
  const batches: ImportBatch[] = rows.map(({ batch, clients }) => ({
    id: batch.id, kind: "clients", fileName: batch.fileName, createdAt: batch.createdAt.toISOString(), clients: Number(clients),
  }));
  return c.json(batches);
});

importRoutes.post("/clients", async (c) => {
  const parsed = ImportClientsInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const userId = c.get("userId");
  const rows = parsed.data.clients.map(({ name, phone, email, notes }) => ({ name: name.trim(), phone, email: email?.toLowerCase(), notes }));
  const result = await db.transaction(async (tx): Promise<ImportClientsResult> => {
    await lockUser(tx, userId);
    const existing = await tx.select({ name: schema.clients.name, phone: schema.clients.phone, email: schema.clients.email })
      .from(schema.clients).where(eq(schema.clients.userId, userId));
    // Decided again here, against what is in the database now, so the same file sent twice adds nothing.
    const plan = planClientImport(rows, existing);
    const alreadyThere = plan.alreadyThere + plan.repeated;
    if (!plan.add.length) return { importId: null, added: 0, alreadyThere };
    const [batch] = await tx.insert(schema.imports).values({ userId, kind: "clients", fileName: parsed.data.file_name ?? null }).returning();
    await tx.insert(schema.clients).values(plan.add.map((row) => ({ userId, importId: batch!.id, ...row })));
    return { importId: batch!.id, added: plan.add.length, alreadyThere };
  });
  return c.json(result, result.added ? 201 : 200);
});

importRoutes.delete("/:id", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("confirm" in body) || body.confirm !== true) {
    return c.json({ error: "Confirm undoing the import with confirm: true." }, 400);
  }
  const userId = c.get("userId"), id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "Import not found" }, 404);
  const result = await db.transaction(async (tx): Promise<UndoImportResult | null> => {
    await lockUser(tx, userId);
    const [batch] = await tx.select().from(schema.imports).where(and(eq(schema.imports.id, id), eq(schema.imports.userId, userId)));
    if (!batch) return null;
    const mine = and(eq(schema.clients.userId, userId), eq(schema.clients.importId, id));
    // A client who has been given a booking since is real work, so they stay.
    const unused = and(mine, notExists(tx.select({ id: schema.bookings.id }).from(schema.bookings).where(eq(schema.bookings.clientId, schema.clients.id))));
    const ids = (await tx.select({ id: schema.clients.id }).from(schema.clients).where(unused).orderBy(schema.clients.id).for("update")).map((row) => row.id);
    if (ids.length) {
      await tx.delete(schema.messageLog).where(and(eq(schema.messageLog.userId, userId), isNotNull(schema.messageLog.clientId), inArray(schema.messageLog.clientId, ids)));
      await tx.delete(schema.clients).where(and(eq(schema.clients.userId, userId), inArray(schema.clients.id, ids)));
    }
    const [{ kept } = { kept: 0 }] = await tx.select({ kept: count() }).from(schema.clients).where(mine);
    await tx.delete(schema.imports).where(and(eq(schema.imports.id, id), eq(schema.imports.userId, userId)));
    return { removed: ids.length, kept: Number(kept) };
  });
  return result ? c.json(result) : c.json({ error: "Import not found" }, 404);
});
