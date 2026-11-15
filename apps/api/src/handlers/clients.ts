import { Hono } from "hono";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { CreateClientInput, UpdateClientInput } from "@sorted/core";
import { db, schema } from "../db";
import type { AppEnv } from "../app";

export const clientRoutes = new Hono<AppEnv>();

clientRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const query = c.req.query("q")?.trim();
  const conditions = [eq(schema.clients.userId, userId)];
  if (query) conditions.push(ilike(schema.clients.name, `%${query}%`));
  const clients = await db
    .select()
    .from(schema.clients)
    .where(and(...conditions))
    .orderBy(desc(schema.clients.createdAt));
  return c.json(clients);
});

clientRoutes.post("/", async (c) => {
  const parsed = CreateClientInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const [client] = await db
    .insert(schema.clients)
    .values({ userId: c.get("userId"), ...parsed.data })
    .returning();
  return c.json(client, 201);
});

clientRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const [client] = await db
    .select()
    .from(schema.clients)
    .where(and(eq(schema.clients.id, id), eq(schema.clients.userId, userId)));
  if (!client) return c.json({ error: "Client not found" }, 404);

  const bookings = await db
    .select()
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.clientId, id),
        eq(schema.bookings.userId, userId),
      ),
    )
    .orderBy(desc(schema.bookings.startAt));

  const [lifetime] = await db
    .select({
      value: sql<number>`coalesce(sum(${schema.payments.amountCents}), 0)`,
    })
    .from(schema.payments)
    .innerJoin(
      schema.bookings,
      eq(schema.payments.bookingId, schema.bookings.id),
    )
    .where(
      and(
        eq(schema.bookings.clientId, id),
        eq(schema.payments.userId, userId),
        eq(schema.payments.status, "paid"),
      ),
    );

  return c.json({
    client,
    bookings,
    lifetimeValueCents: Number(lifetime?.value ?? 0),
  });
});

clientRoutes.patch("/:id", async (c) => {
  const parsed = UpdateClientInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const [client] = await db
    .update(schema.clients)
    .set(parsed.data)
    .where(
      and(
        eq(schema.clients.id, c.req.param("id")),
        eq(schema.clients.userId, c.get("userId")),
      ),
    )
    .returning();
  if (!client) return c.json({ error: "Client not found" }, 404);
  return c.json(client);
});

clientRoutes.delete("/:id", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("confirm" in body) || body.confirm !== true) {
    return c.json({ error: "Confirm client deletion with confirm: true." }, 400);
  }
  const userId = c.get("userId");
  const id = c.req.param("id");
  return db.transaction(async (tx) => {
    const clientScope = and(eq(schema.clients.id, id), eq(schema.clients.userId, userId));
    const [client] = await tx.select().from(schema.clients).where(clientScope).for("update");
    if (!client) return c.json({ error: "Client not found" }, 404);
    const bookingScope = and(eq(schema.bookings.clientId, id), eq(schema.bookings.userId, userId));
    const bookings = await tx.select().from(schema.bookings).where(bookingScope).for("update");
    if (bookings.some((booking) => booking.status === "enquiry" || booking.status === "confirmed")) {
      return c.json({ error: "Cancel or complete their open bookings first." }, 409);
    }
    const ids = bookings.map((booking) => booking.id);
    const paymentScope = and(eq(schema.payments.userId, userId), inArray(schema.payments.bookingId, ids));
    const payments = await tx.select().from(schema.payments).where(paymentScope).for("update");
    await tx.delete(schema.messageLog).where(and(
      eq(schema.messageLog.userId, userId),
      or(eq(schema.messageLog.clientId, id), inArray(schema.messageLog.bookingId, ids)),
    ));
    if (payments.some((payment) => payment.status === "paid")) {
      await tx.update(schema.clients)
        .set({ name: "Deleted client", phone: null, email: null, notes: null }).where(clientScope);
      await tx.update(schema.bookings).set({ notes: null, location: null }).where(bookingScope);
      return c.json({ outcome: "anonymised" });
    }
    await tx.delete(schema.payments).where(paymentScope);
    await tx.delete(schema.bookings).where(bookingScope);
    await tx.delete(schema.clients).where(clientScope);
    return c.json({ outcome: "deleted" });
  });
});
