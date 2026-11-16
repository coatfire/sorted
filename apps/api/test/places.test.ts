import { afterEach, describe, expect, it, vi } from "vitest";
import { knownPlaces, PlaceSearchInput } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";

const KEY = "test-maps-key";
const used = (location: string | null, createdAt: string) => ({ location, createdAt });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function account() {
  const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
  const jwt = await issueJwt(user.id, user.sessionVersion);
  return (body: unknown) => app.request("https://api.sorted.example/api/places/search", {
    method: "POST", headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
const google = (reply: () => Response | Promise<Response>) => vi.spyOn(globalThis, "fetch").mockImplementation(async () => reply());
const prediction = (text: string, main?: string, secondary?: string) => ({
  placePrediction: { text: { text }, ...(main ? { structuredFormat: { mainText: { text: main }, ...(secondary ? { secondaryText: { text: secondary } } : {}) } } : {}) },
});

describe("places used before", () => {
  const bookings = [
    used("The K Club, Kildare", "2026-01-01T10:00:00.000Z"),
    used(" Studio ", "2026-03-01T10:00:00.000Z"),
    used("studio", "2026-02-01T10:00:00.000Z"),
    used(null, "2026-04-01T10:00:00.000Z"),
    used("Kilkea Castle, Kildare", "2026-05-01T10:00:00.000Z"),
  ];

  it("lists each place once, most recently used first, before anything is typed", () => {
    expect(knownPlaces(bookings, "")).toEqual(["Kilkea Castle, Kildare", "Studio", "The K Club, Kildare"]);
    expect(knownPlaces(bookings, "", 2)).toEqual(["Kilkea Castle, Kildare", "Studio"]);
    expect(knownPlaces([], "kil")).toEqual([]);
  });

  it("matches every typed word in any order, and leaves out what's already in the field", () => {
    expect(knownPlaces(bookings, "kil")).toEqual(["Kilkea Castle, Kildare", "The K Club, Kildare"]);
    expect(knownPlaces(bookings, "KILDARE club")).toEqual(["The K Club, Kildare"]);
    expect(knownPlaces(bookings, "galway")).toEqual([]);
    expect(knownPlaces(bookings, " STUDIO ")).toEqual([]);
  });

  it("only searches once there's enough to go on", () => {
    expect(PlaceSearchInput.safeParse({ input: " ab " }).success).toBe(false);
    expect(PlaceSearchInput.parse({ input: " 12 Main St " })).toEqual({ input: "12 Main St" });
    expect(PlaceSearchInput.safeParse({ input: "x".repeat(201) }).success).toBe(false);
  });
});

describe("address search", () => {
  it("requires a session", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", KEY);
    const fetched = google(() => Response.json({}));
    const response = await app.request("/api/places/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: "Main Street" }) });
    expect(response.status).toBe(401);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("is off, and asks Google nothing, until a key is set", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    const fetched = google(() => Response.json({}));
    const health = await (await app.request("/api/health")).json() as { features: { addressSearch: boolean } };
    expect(health.features.addressSearch).toBe(false);
    expect((await (await account())({ input: "Main Street" })).status).toBe(503);
    expect(fetched).not.toHaveBeenCalled();

    vi.stubEnv("GOOGLE_MAPS_API_KEY", KEY);
    const on = await (await app.request("/api/health")).text();
    expect(JSON.parse(on).features.addressSearch).toBe(true);
    expect(on).not.toContain(KEY);
  });

  it("asks Google for Irish places and returns only what fills the field", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", KEY);
    const fetched = google(() => Response.json({ suggestions: [
      prediction("The K Club, Straffan, County Kildare, Ireland", "The K Club", "Straffan, County Kildare, Ireland"),
      { queryPrediction: { text: { text: "k club hotels" } } },
      prediction("Kilkea, County Kildare, Ireland"),
      prediction("K Club Road, Straffan", "K Club Road"),
      ...[1, 2, 3, 4].map((n) => prediction(`${n} K Street, Dublin`, `${n} K Street`, "Dublin")),
    ] }));
    const response = await (await account())({ input: "  k club " });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toEqual({ source: "google", suggestions: [
      { text: "The K Club, Straffan, County Kildare, Ireland", main: "The K Club", secondary: "Straffan, County Kildare, Ireland" },
      { text: "Kilkea, County Kildare, Ireland", main: "Kilkea, County Kildare, Ireland", secondary: "" },
      { text: "K Club Road, Straffan", main: "K Club Road", secondary: "" },
      { text: "1 K Street, Dublin", main: "1 K Street", secondary: "Dublin" },
      { text: "2 K Street, Dublin", main: "2 K Street", secondary: "Dublin" },
    ] });

    expect(fetched).toHaveBeenCalledTimes(1);
    const [url, init] = fetched.mock.calls[0];
    expect(String(url)).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(init).toMatchObject({ method: "POST", headers: { "X-Goog-Api-Key": KEY } });
    expect(JSON.parse(String(init!.body))).toMatchObject({ input: "k club", regionCode: "ie", languageCode: "en-IE", locationRestriction: { rectangle: expect.any(Object) } });
  });

  it("turns away input that's too short or malformed without asking Google", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", KEY);
    const fetched = google(() => Response.json({}));
    const search = await account();
    for (const body of [{ input: "ab" }, { input: "x".repeat(201) }, { input: 5 }, {}, null, "Main Street"]) {
      expect((await search(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(fetched).not.toHaveBeenCalled();
  });

  it("answers plainly when Google fails, without logging what was typed or the key", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", KEY);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const search = await account();
    const replies: (() => Response | Promise<Response>)[] = [
      () => Response.json({ error: { message: `API key ${KEY} is invalid` } }, { status: 403 }),
      () => new Response("<html>", { status: 200 }),
      () => Response.json({ suggestions: "nope" }),
      () => Promise.reject(new Error("socket hang up")),
    ];
    for (const reply of replies) {
      google(reply);
      const response = await search({ input: "14 Secret Lane" });
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "Address search isn't available just now." });
    }
    expect(logged).toHaveBeenCalledTimes(replies.length);
    const lines = JSON.stringify(logged.mock.calls);
    expect(lines).not.toContain("Secret Lane");
    expect(lines).not.toContain(KEY);

    google(() => Response.json({}));
    expect(await (await search({ input: "nowhere at all" })).json()).toEqual({ source: "google", suggestions: [] });
  });

  it("stops one trader's runaway searching without slowing anyone else", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", KEY);
    const fetched = google(() => Response.json({ suggestions: [] }));
    const busy = await account(), other = await account();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (let i = 0; i < 40; i++) expect((await busy({ input: "Main Street" })).status).toBe(200);
      expect((await busy({ input: "Main Street" })).status).toBe(429);
      expect(fetched).toHaveBeenCalledTimes(40);
      expect((await other({ input: "Main Street" })).status).toBe(200);
      vi.advanceTimersByTime(61_000);
      expect((await busy({ input: "Main Street" })).status).toBe(200);
    } finally { vi.useRealTimers(); }
  });
});
