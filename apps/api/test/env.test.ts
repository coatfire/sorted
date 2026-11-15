import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Vercel production detection", () => {
  it("disables local auth defaults even without NODE_ENV=production", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("JWT_SECRET", "");
    const { env, assertEnv } = await import("../src/lib/env");
    expect(env.isLocal()).toBe(false);
    expect(env.jwtSecret()).toBe("");
    expect(assertEnv).toThrow("Missing env vars: DATABASE_URL, JWT_SECRET");
  });

  it("refuses to fall back to PGlite when deployed without DATABASE_URL", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "");
    await expect(import("../src/db")).rejects.toThrow("DATABASE_URL is required in production");
  });
});
