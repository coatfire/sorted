import { Hono } from "hono";
import { PlaceSearchInput, type PlaceSearchResult } from "@sorted/core";
import { env } from "../lib/env";
import { searchPlaces } from "../lib/places";
import type { AppEnv } from "../app";

export const placeRoutes = new Hono<AppEnv>();

// Each search is a billable Google request, so one account can't run up a bill by hammering this.
// Per server instance, so it's a brake rather than an exact quota; the hard cap is the key's quota in Google Cloud.
const SEARCHES_PER_MINUTE = 40;
const recent = new Map<string, number[]>();

function allowed(userId: string, now = Date.now()) {
  const times = (recent.get(userId) ?? []).filter((time) => now - time < 60_000);
  if (times.length >= SEARCHES_PER_MINUTE) return false;
  recent.delete(userId);
  recent.set(userId, [...times, now]);
  if (recent.size > 500) recent.delete(recent.keys().next().value!);
  return true;
}

// POST, so what's typed (often a client's home address) never lands in a URL or a request log.
placeRoutes.post("/search", async (c) => {
  c.header("Cache-Control", "no-store");
  const key = env.googleMapsKey();
  if (!key) return c.json({ error: "Address search isn't switched on." }, 503);
  const parsed = PlaceSearchInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Type a little more of the address." }, 400);
  if (!allowed(c.get("userId"))) return c.json({ error: "Too many address searches. Try again in a minute." }, 429);
  try {
    return c.json<PlaceSearchResult>({ source: "google", suggestions: await searchPlaces(parsed.data.input, key) });
  } catch (error) {
    console.error("Address search failed:", error instanceof Error ? error.message : "unknown error");
    return c.json({ error: "Address search isn't available just now." }, 502);
  }
});
