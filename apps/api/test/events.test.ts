import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";
import { emitBookingEvent, emitEvent } from "../src/lib/events";
import { env } from "../src/lib/env";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("best-effort post-commit events", () => {
  it("skips the booking lookup entirely when automation is disabled", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "");
    const select = vi.spyOn(db, "select").mockImplementation(() => { throw new Error("Unexpected lookup"); });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(emitBookingEvent("owner", "booking", "booking.confirmed")).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["booking.confirmed", "booking.completed", "booking.cancelled", "payment.paid", "payment.link_created"] as const)("contains lookup failures for %s without logging PII", async event => {
    vi.stubEnv("N8N_WEBHOOK_URL", "https://automation.example.com");
    vi.spyOn(db, "select").mockImplementation(() => { throw new Error("Private Client private@example.com"); });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(emitBookingEvent("owner", "booking", event)).resolves.toBeUndefined();
    expect(log.mock.calls).toEqual([["[events] emit failed", event]]);
  });

  it("contains configuration failures even for direct emitEvent callers", async () => {
    vi.spyOn(env, "n8nWebhookUrl").mockImplementation(() => { throw new Error("Private configuration"); });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(emitEvent({ event: "booking.confirmed" } as Parameters<typeof emitEvent>[0])).resolves.toBeUndefined();
    expect(log.mock.calls).toEqual([["[events] emit failed", "booking.confirmed"]]);
  });

  it("contains transport failures without logging their potentially private message", async () => {
    vi.stubEnv("N8N_WEBHOOK_URL", "https://automation.example.com");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("private@example.com secret webhook URL"); }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(emitEvent({ event: "booking.confirmed" } as Parameters<typeof emitEvent>[0])).resolves.toBeUndefined();
    expect(log.mock.calls).toEqual([["[events] emit failed", "booking.confirmed"]]);
  });

  it.each(["create", "confirm"] as const)("returns success for %s when the post-commit lookup throws, leaving exactly one booking", async action => {
    vi.stubEnv("N8N_WEBHOOK_URL", "https://automation.example.com");
    const [user] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com` }).returning();
    const headers = { Authorization: `Bearer ${await issueJwt(user.id, user.sessionVersion)}` };
    const body = { client: { name: "Private client" }, service: "Nails", start_at: "2026-11-18T10:00:00Z", price_cents: 6000, deposit_cents: 2000, status: action === "create" ? "confirmed" : "enquiry" };
    const enquiry = action === "confirm" ? await (await app.request("/api/bookings", { method: "POST", headers, body: JSON.stringify(body) })).json() as { id: string } : null;
    const select = vi.spyOn(db, "select");
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementation(async (work, config) => {
      const result = await transaction(work, config);
      select.mockImplementation(() => { throw new Error("Private Client private@example.com"); });
      return result;
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await app.request(enquiry ? `/api/bookings/${enquiry.id}/confirm` : "/api/bookings", { method: "POST", headers, body: JSON.stringify(body) });
    select.mockRestore();
    expect(response.status).toBe(action === "create" ? 201 : 200);
    expect(await response.json()).toMatchObject({ status: "confirmed", followUpOn: null });
    expect(await db.select().from(schema.bookings).where(eq(schema.bookings.userId, user.id))).toHaveLength(1);
    expect(await db.select().from(schema.payments).where(eq(schema.payments.userId, user.id))).toHaveLength(1);
    expect(log.mock.calls).toEqual([["[events] emit failed", "booking.confirmed"]]);
  });
});
