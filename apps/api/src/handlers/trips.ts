import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { TripInput } from "@sorted/core";
import { db, schema } from "../db";
import type { AppEnv } from "../app";

/** Business trips that aren't bookings. Km only: nothing here is an expense or an amount of money. */
export const tripRoutes = new Hono<AppEnv>();

const fields = (input: TripInput) => ({
  tripDate: input.trip_date, destination: input.destination, purpose: input.purpose, travelMetres: input.travel_metres,
});

tripRoutes.get("/", async (c) =>
  c.json(await db.select().from(schema.trips).where(eq(schema.trips.userId, c.get("userId")))
    .orderBy(desc(schema.trips.tripDate), desc(schema.trips.createdAt))));

tripRoutes.post("/", async (c) => {
  const parsed = TripInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const [trip] = await db.insert(schema.trips).values({ userId: c.get("userId"), ...fields(parsed.data) }).returning();
  return c.json(trip, 201);
});

tripRoutes.patch("/:id", async (c) => {
  const parsed = TripInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const [trip] = await db.update(schema.trips).set(fields(parsed.data))
    .where(and(eq(schema.trips.id, c.req.param("id")), eq(schema.trips.userId, c.get("userId")))).returning();
  return trip ? c.json(trip) : c.json({ error: "Trip not found" }, 404);
});

tripRoutes.delete("/:id", async (c) => {
  const [trip] = await db.delete(schema.trips)
    .where(and(eq(schema.trips.id, c.req.param("id")), eq(schema.trips.userId, c.get("userId")))).returning({ id: schema.trips.id });
  return trip ? c.body(null, 204) : c.json({ error: "Trip not found" }, 404);
});
