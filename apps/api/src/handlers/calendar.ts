import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { buildCalendar, type CalendarLinks } from "@sorted/core";
import { db, schema } from "../db";
import { requireAuth } from "../lib/auth";
import { env } from "../lib/env";
import type { AppEnv } from "../app";

export const calendarRoutes = new Hono<AppEnv>();

async function tokenFor(userId: string, reset = false) {
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ token: schema.users.calendarToken }).from(schema.users).where(eq(schema.users.id, userId)).for("update");
    if (user.token && !reset) return user.token;
    const token = randomBytes(32).toString("base64url");
    await tx.update(schema.users).set({ calendarToken: token }).where(eq(schema.users.id, userId));
    return token;
  });
}

function links(origin: string, token: string): CalendarLinks {
  const feed = (kind: string) => {
    const https = `${origin}/api/calendar/${token}/${kind}.ics`;
    const webcal = https.replace(/^https?:/, "webcal:");
    return { https, webcal, google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}` };
  };
  return { confirmed: feed("confirmed"), enquiries: feed("enquiries") };
}

calendarRoutes.get("/", requireAuth, async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(links(env.appUrl(), await tokenFor(c.get("userId"))));
});

calendarRoutes.post("/reset", requireAuth, async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(links(env.appUrl(), await tokenFor(c.get("userId"), true)));
});

calendarRoutes.get("/:token/:feed", async (c) => {
  c.header("Cache-Control", "no-store");
  const feed = c.req.param("feed");
  if (feed !== "confirmed.ics" && feed !== "enquiries.ics") return c.json({ error: "Not found" }, 404);
  const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.calendarToken, c.req.param("token")));
  if (!user) return c.json({ error: "Not found" }, 404);
  const since = new Date(Date.now() - 180 * 86400000);
  const rows = await db.select({ booking: schema.bookings, client: schema.clients }).from(schema.bookings)
    .innerJoin(schema.clients, and(eq(schema.bookings.clientId, schema.clients.id), eq(schema.clients.userId, user.id)))
    .where(and(eq(schema.bookings.userId, user.id), gte(schema.bookings.startAt, since),
      inArray(schema.bookings.status, feed === "confirmed.ics" ? ["confirmed", "completed"] : ["enquiry"])))
    .orderBy(asc(schema.bookings.startAt));
  const content = buildCalendar({
    bookings: rows.map(({ booking, client }) => ({ ...booking, client, startAt: booking.startAt.toISOString(), endAt: booking.endAt?.toISOString() ?? null })),
    name: feed === "confirmed.ics" ? "Sorted – Confirmed" : "Sorted – Enquiries", appUrl: env.appUrl(),
  });
  return c.body(content, 200, { "Content-Type": "text/calendar; charset=utf-8" });
});
