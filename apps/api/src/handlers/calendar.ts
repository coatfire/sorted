import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { AddExternalCalendarInput, buildCalendar, BusyRange, EXTERNAL_CALENDAR_LIMIT, externalCalendarProvider, type BusyResult, type CalendarLinks, type ExternalCalendar } from "@sorted/core";
import { db, schema } from "../db";
import { requireAuth } from "../lib/auth";
import { env } from "../lib/env";
import { busyBlocks, fetchCalendarText } from "../lib/externalCalendar";
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
  return c.json(links(env.apiUrl(), await tokenFor(c.get("userId"))));
});

calendarRoutes.post("/reset", requireAuth, async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(links(env.apiUrl(), await tokenFor(c.get("userId"), true)));
});

const external = (row: typeof schema.externalCalendars.$inferSelect): ExternalCalendar =>
  ({ id: row.id, provider: externalCalendarProvider(row.url) ?? "google", createdAt: row.createdAt.toISOString() });

/** Downloaded calendars, kept briefly so moving between months doesn't download them again. */
const CACHE_MS = 5 * 60_000;
const downloads = new Map<string, { url: string; at: number; text: string }>();
async function calendarText(row: { id: string; url: string }) {
  const cached = downloads.get(row.id);
  if (cached && cached.url === row.url && Date.now() - cached.at < CACHE_MS) return cached.text;
  const text = await fetchCalendarText(row.url);
  if (downloads.size >= 10) downloads.clear();
  downloads.set(row.id, { url: row.url, at: Date.now(), text });
  return text;
}

calendarRoutes.get("/external", requireAuth, async (c) => {
  c.header("Cache-Control", "no-store");
  const rows = await db.select().from(schema.externalCalendars).where(eq(schema.externalCalendars.userId, c.get("userId"))).orderBy(asc(schema.externalCalendars.createdAt));
  return c.json(rows.map(external));
});

calendarRoutes.post("/external", requireAuth, async (c) => {
  c.header("Cache-Control", "no-store");
  const parsed = AddExternalCalendarInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Paste a calendar link." }, 400);
  const userId = c.get("userId");
  const { url } = parsed.data;
  const mine = await db.select().from(schema.externalCalendars).where(eq(schema.externalCalendars.userId, userId));
  const existing = mine.find((row) => row.url === url);
  if (existing) return c.json(external(existing));
  if (mine.length >= EXTERNAL_CALENDAR_LIMIT) return c.json({ error: `You can add up to ${EXTERNAL_CALENDAR_LIMIT} calendars. Remove one first.` }, 409);
  let text: string;
  try {
    text = await fetchCalendarText(url);
    busyBlocks(text, { from: "2000-01-01", to: "2000-01-01", calendarId: "check", provider: "google", appUrl: env.appUrl() });
  } catch {
    return c.json({ error: "Sorted couldn't read that link. Check you copied the whole private calendar address." }, 422);
  }
  const [row] = await db.insert(schema.externalCalendars).values({ userId, url }).onConflictDoNothing().returning();
  const saved = row ?? (await db.select().from(schema.externalCalendars).where(and(eq(schema.externalCalendars.userId, userId), eq(schema.externalCalendars.url, url))))[0];
  downloads.set(saved.id, { url, at: Date.now(), text });
  return c.json(external(saved), 201);
});

calendarRoutes.delete("/external/:id", requireAuth, async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.json({ error: "Not found" }, 404);
  const [row] = await db.delete(schema.externalCalendars).where(and(eq(schema.externalCalendars.id, id), eq(schema.externalCalendars.userId, c.get("userId")))).returning({ id: schema.externalCalendars.id });
  if (!row) return c.json({ error: "Not found" }, 404);
  downloads.delete(row.id);
  return c.json({ ok: true });
});

/** Entries from the trader's outside calendars. Read-only: nothing here touches a booking. */
calendarRoutes.get("/busy", requireAuth, async (c) => {
  c.header("Cache-Control", "no-store");
  const range = BusyRange.safeParse({ from: c.req.query("from"), to: c.req.query("to") });
  if (!range.success) return c.json({ error: "Choose a valid range." }, 400);
  const rows = await db.select().from(schema.externalCalendars).where(eq(schema.externalCalendars.userId, c.get("userId"))).orderBy(asc(schema.externalCalendars.createdAt));
  const result: BusyResult = { blocks: [], failed: [] };
  await Promise.all(rows.map(async (row) => {
    const provider = externalCalendarProvider(row.url) ?? "google";
    try {
      result.blocks.push(...busyBlocks(await calendarText(row), { ...range.data, calendarId: row.id, provider, appUrl: env.appUrl() }));
    } catch {
      if (!result.failed.includes(provider)) result.failed.push(provider);
    }
  }));
  result.blocks.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  return c.json(result);
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
    bookings: rows.map(({ booking, client }) => ({ ...booking, client, startAt: booking.startAt?.toISOString() ?? null, endAt: booking.endAt?.toISOString() ?? null })),
    name: feed === "confirmed.ics" ? "Sorted – Confirmed" : "Sorted – Enquiries", appUrl: env.appUrl(),
  });
  return c.body(content, 200, { "Content-Type": "text/calendar; charset=utf-8" });
});
