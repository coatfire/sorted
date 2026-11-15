import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { eq } from "drizzle-orm";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { env } from "../src/lib/env";

let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => { keys = await generateKeyPair("RS256"); });
beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
  vi.stubEnv("APP_URL", "https://app.example");
  vi.stubEnv("API_URL", "https://api.example");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function flow(overrides: JWTPayload = {}) {
  const ip = crypto.randomUUID();
  const start = await app.request("/api/auth/google/start", { headers: { "x-forwarded-for": ip } });
  expect(start.status).toBe(302);
  const auth = new URL(start.headers.get("Location")!);
  const cookie = start.headers.get("Set-Cookie")!.split(";")[0];
  const { payload } = await jwtVerify(cookie.slice(cookie.indexOf("=") + 1), new TextEncoder().encode(env.jwtSecret()));
  const sub = crypto.randomUUID(), email = `${crypto.randomUUID()}@example.com`;
  const token = await new SignJWT({ sub, email, email_verified: true, nonce: auth.searchParams.get("nonce"),
    iss: "https://accounts.google.com", aud: "google-client-id", exp: Math.floor(Date.now() / 1000) + 300, ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "google-test" }).sign(keys.privateKey);
  const jwk = { ...await exportJWK(keys.publicKey), kid: "google-test", alg: "RS256", use: "sig" };
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      expect(init?.method).toBe("POST");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("code_verifier")).toBe(payload.verifier);
      expect(body.get("redirect_uri")).toBe("https://api.example/api/auth/google/callback");
      expect(body.get("client_secret")).toBe("google-client-secret");
      expect(body.get("grant_type")).toBe("authorization_code");
      return Response.json({ id_token: token, access_token: "unused-google-access-token" });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] });
    throw new Error("Unexpected fetch");
  });
  vi.stubGlobal("fetch", fetchMock);
  const callback = (state = auth.searchParams.get("state")!, withCookie = true) => app.request(`/api/auth/google/callback?code=google-authorization-code&state=${state}`, { headers: withCookie ? { Cookie: cookie } : {} });
  const exchange = (code: string) => app.request("/api/auth/google/exchange", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ code }) });
  const code = async () => {
    const response = await callback();
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe("https://app.example/login/google");
    const value = location.searchParams.get("code")!;
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    return value;
  };
  return { start, auth, cookie, payload, sub, email, fetchMock, callback, exchange, code };
}

describe("Google sign-in", () => {
  it("uses a signed secure ten-minute state/nonce/PKCE cookie and reports the feature", async () => {
    const f = await flow();
    expect(f.auth.origin + f.auth.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(f.auth.searchParams.get("scope")).toBe("openid email profile");
    expect(f.auth.searchParams.get("prompt")).toBe("select_account");
    expect(f.auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(f.auth.searchParams.get("code_challenge")).toBe(createHash("sha256").update(String(f.payload.verifier)).digest("base64url"));
    expect(f.payload.state).toBe(f.auth.searchParams.get("state"));
    expect(f.payload.nonce).toBe(f.auth.searchParams.get("nonce"));
    expect(Number(f.payload.exp) - Number(f.payload.iat)).toBe(600);
    for (const value of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/api/auth/google", "Max-Age=600"]) expect(f.start.headers.get("Set-Cookie")).toContain(value);
    expect((await (await app.request("/api/health")).json()).features.googleSignIn).toBe(true);
  });
  it("creates a verified passwordless user, stores only a code hash and exchanges it for a normal session", async () => {
    const f = await flow();
    const code = await f.code();
    const [record] = await db.select().from(schema.loginCodes).where(eq(schema.loginCodes.codeHash, createHash("sha256").update(code).digest("hex")));
    expect(record.expiresAt.getTime() - Date.now()).toBeGreaterThan(110000);
    expect(record.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(120000);
    const response = await f.exchange(code);
    expect(response.status).toBe(200);
    const session = await response.json();
    expect(session.user).toMatchObject({ email: f.email, name: null, businessName: null });
    expect(session.user.emailVerifiedAt).toBeTruthy();
    expect(session.user).not.toHaveProperty("googleSub");
    expect(session.user).not.toHaveProperty("passwordHash");
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.user.id));
    expect(user.googleSub).toBe(f.sub);
    expect(user.passwordHash).toBeNull();
    expect((await app.request("/api/auth/me", { headers: { Authorization: `Bearer ${session.jwt}` } })).status).toBe(200);
    expect((await f.exchange(code)).status).toBe(401);
  });
  it("links an existing email case-insensitively without replacing its password or creating a duplicate", async () => {
    const email = `${crypto.randomUUID()}@Example.COM`;
    const [existing] = await db.insert(schema.users).values({ email, passwordHash: "existing-password-hash" }).returning();
    const f = await flow({ email: email.toUpperCase() });
    const result = await (await f.exchange(await f.code())).json();
    expect(result.user.id).toBe(existing.id);
    const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, existing.id));
    expect(updated).toMatchObject({ googleSub: f.sub, passwordHash: existing.passwordHash, email });
    expect(updated.emailVerifiedAt).toBeTruthy();
    expect(await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase()))).toHaveLength(0);
  });
  it("resolves by Google subject first even when the Google email changes", async () => {
    const sub = crypto.randomUUID();
    const [existing] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com`, googleSub: sub, emailVerifiedAt: new Date() }).returning();
    const f = await flow({ sub, iss: "accounts.google.com" });
    const response = await f.exchange(await f.code());
    expect(response.status).toBe(200);
    expect((await response.json()).user).toMatchObject({ id: existing.id, email: existing.email });
    expect(await db.select().from(schema.users).where(eq(schema.users.email, f.email))).toHaveLength(0);
  });
  it.each([{ email_verified: false }, { aud: "wrong-client" }, { nonce: "wrong-nonce" }, { iss: "https://attacker.example" }, { exp: 1 }])("rejects untrusted claims without creating an account: %j", async (overrides) => {
    const f = await flow(overrides);
    const response = await f.callback();
    expect(response.headers.get("Location")).toBe("https://app.example/login?error=google");
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect(await db.select().from(schema.users).where(eq(schema.users.email, f.email))).toHaveLength(0);
  });
  it("rejects bad state or a missing cookie before calling Google", async () => {
    const f = await flow();
    expect((await f.callback("bad-state")).headers.get("Location")).toBe("https://app.example/login?error=google");
    expect((await f.callback(undefined, false)).headers.get("Location")).toBe("https://app.example/login?error=google");
    expect(f.fetchMock).not.toHaveBeenCalled();
  });
  it("handles Google denial and provider outages without logging sensitive responses", async () => {
    const f = await flow();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    f.fetchMock.mockRejectedValue(new Error("Sensitive provider error"));
    expect((await f.callback()).headers.get("Location")).toBe("https://app.example/login?error=google");
    expect((await app.request("/api/auth/google/callback?error=access_denied", { headers: { Cookie: f.cookie } })).headers.get("Location")).toBe("https://app.example/login?error=google");
    expect(log).not.toHaveBeenCalled();
  });
  it("allows only one concurrent exchange and rejects expired or revoked codes", async () => {
    const f = await flow();
    const code = await f.code();
    const responses = await Promise.all([f.exchange(code), f.exchange(code)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    const expired = await f.code();
    await db.update(schema.loginCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.loginCodes.codeHash, createHash("sha256").update(expired).digest("hex")));
    expect((await f.exchange(expired)).status).toBe(401);
    const revoked = await f.code();
    await db.update(schema.users).set({ sessionVersion: 1 }).where(eq(schema.users.googleSub, f.sub));
    expect((await f.exchange(revoked)).status).toBe(401);
  });
  it("rate limits invalid exchange attempts", async () => {
    const f = await flow();
    for (let attempt = 0; attempt < 10; attempt++) expect((await f.exchange("x".repeat(43))).status).toBe(401);
    expect((await f.exchange("x".repeat(43))).status).toBe(429);
  });
  it.each(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"])("is off without %s", async (key) => {
    vi.stubEnv(key, "");
    expect((await app.request("/api/auth/google/start")).status).toBe(404);
    expect((await app.request("/api/auth/google/exchange", { method: "POST", body: "{}" })).status).toBe(404);
    expect((await (await app.request("/api/health")).json()).features.googleSignIn).toBe(false);
  });
  it("falls back to APP_URL for the redirect URI", async () => {
    vi.stubEnv("API_URL", "");
    const response = await app.request("/api/auth/google/start", { headers: { "x-forwarded-for": crypto.randomUUID() } });
    expect(new URL(response.headers.get("Location")!).searchParams.get("redirect_uri")).toBe("https://app.example/api/auth/google/callback");
  });
});
