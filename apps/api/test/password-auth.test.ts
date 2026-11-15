import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { env } from "../src/lib/env";
import { hashPassword, checkPassword } from "../src/lib/password";
import * as passwords from "../src/lib/password";
import { issueEmailToken, issueJwt } from "../src/lib/auth";
import { UpdateUserInput, normaliseIban, validIban, validBic } from "@sorted/core";

const password = "first-password";
const nextPassword = "second-password";
const email = () => `password-${crypto.randomUUID()}@example.com`;
const post = (path: string, body: object) => app.request(`/api/auth/${path}`, {
  method: "POST", body: JSON.stringify(body),
});
const signup = (address: string, value = password) => post("signup", { email: address, password: value });
const login = (address: string, value = password) => post("login", { email: address, password: value });

async function token(response: Response) {
  expect(response.status).toBe(200);
  const body = await response.json() as { ok: boolean; dev_link: string };
  expect(body.ok).toBe(true);
  const value = new URL(body.dev_link).searchParams.get("token");
  if (!value) throw new Error("Missing development token");
  return value;
}

type Session = { jwt: string; user: { id: string; email: string; emailVerifiedAt: string } };
async function session(response: Response) {
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toMatch(/passwordHash|password_hash|pendingPasswordHash|scrypt\$/);
  return JSON.parse(text) as Session;
}

afterEach(() => vi.restoreAllMocks());

describe("password auth", () => {
  it("signs up, applies the password only on verification, then logs in without leaking hashes", async () => {
    const address = email();
    const value = await token(await signup(address));
    const [pending] = await db.select().from(schema.users).where(eq(schema.users.email, address));
    expect(pending.passwordHash).toBeNull();
    expect(pending.emailVerifiedAt).toBeNull();
    expect((await login(address)).status).toBe(401);
    const verified = await session(await post("verify", { token: value }));
    expect(verified.user.emailVerifiedAt).toBeTruthy();
    expect((await session(await login(address.toUpperCase()))).user.id).toBe(verified.user.id);
    const headers = { Authorization: `Bearer ${verified.jwt}` };
    for (const method of ["GET", "PATCH"]) {
      const response = await app.request("/api/auth/me", {
        method, headers, ...(method === "PATCH" ? { body: JSON.stringify({ address: "Dublin" }) } : {}),
      });
      expect(response.status).toBe(200);
      expect(await response.text()).not.toMatch(/passwordHash|password_hash|scrypt\$/);
    }
    const [record] = await db.select().from(schema.loginTokens).where(eq(schema.loginTokens.email, address));
    expect(record.pendingPasswordHash).toBeNull();
  });

  it("keeps an existing password unchanged until a new signup is verified", async () => {
    const address = email();
    const [user] = await db.insert(schema.users).values({ email: address, passwordHash: await hashPassword(password) }).returning();
    await signup(address, nextPassword);
    const [unchanged] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(unchanged.passwordHash).toBe(user.passwordHash);
    expect(unchanged.emailVerifiedAt).toBeNull();
    expect((await login(address, nextPassword)).status).toBe(401);
  });

  it("invalidates other signup links when the first is verified", async () => {
    const address = email();
    const first = await token(await signup(address));
    const second = await token(await signup(address, nextPassword));
    await session(await post("verify", { token: first }));
    expect((await post("verify", { token: second })).status).toBe(401);
    await session(await login(address));
    expect((await login(address, nextPassword)).status).toBe(401);
    const records = await db.select().from(schema.loginTokens).where(eq(schema.loginTokens.email, address));
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.usedAt && record.pendingPasswordHash === null)).toBe(true);
  });

  it("invalidates pending signup links when resetting a password", async () => {
    const address = email();
    const pending = await token(await signup(address));
    const reset = await token(await post("forgot", { email: address }));
    await session(await post("reset", { token: reset, password: nextPassword }));
    expect((await post("verify", { token: pending })).status).toBe(401);
    await session(await login(address, nextPassword));
    expect((await login(address)).status).toBe(401);
  });

  it("rejects an unused verify token when the user already has a password", async () => {
    const address = email();
    const pending = await token(await signup(address, nextPassword));
    await db.update(schema.users).set({ passwordHash: await hashPassword(password), emailVerifiedAt: new Date() })
      .where(eq(schema.users.email, address));
    expect((await post("verify", { token: pending })).status).toBe(401);
    await session(await login(address));
    expect((await login(address, nextPassword)).status).toBe(401);
  });

  it("uses the same 401 for wrong passwords, unknown emails, missing hashes and unverified users", async () => {
    const address = email();
    await post("verify", { token: await token(await signup(address)) });
    const missingHash = email();
    await db.insert(schema.users).values({ email: missingHash, emailVerifiedAt: new Date() });
    const unverified = email();
    await signup(unverified);
    for (const target of [address, email(), missingHash, unverified]) {
      const response = await login(target, "incorrect");
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Email or password is incorrect." });
      expect(await db.select().from(schema.loginAttempts).where(eq(schema.loginAttempts.email, target))).toHaveLength(1);
    }
  });

  it("blocks before password checking after ten failures, and ignores old failures", async () => {
    const address = email();
    await post("verify", { token: await token(await signup(address)) });
    for (let n = 0; n < 10; n++) expect((await login(address, "wrong-password")).status).toBe(401);
    expect((await login(address)).status).toBe(429);
    expect(await db.select().from(schema.loginAttempts).where(eq(schema.loginAttempts.email, address))).toHaveLength(10);
    await db.update(schema.loginAttempts).set({ createdAt: new Date(Date.now() - 16 * 60 * 1000) })
      .where(eq(schema.loginAttempts.email, address));
    await session(await login(address));
  });

  it("resets a password once and logs in with the new password", async () => {
    const address = email();
    await post("verify", { token: await token(await signup(address)) });
    const reset = await token(await post("forgot", { email: address }));
    await session(await post("reset", { token: reset, password: nextPassword }));
    expect((await post("reset", { token: reset, password })).status).toBe(401);
    expect((await login(address)).status).toBe(401);
    await session(await login(address, nextPassword));
  });

  it("allows passwordless existing users to verify their email by resetting", async () => {
    const address = email();
    await db.insert(schema.users).values({ email: address });
    const reset = await token(await post("forgot", { email: address }));
    const result = await session(await post("reset", { token: reset, password }));
    expect(result.user.emailVerifiedAt).toBeTruthy();
    await session(await login(address));
  });

  it("consumes a reset token atomically under concurrent requests", async () => {
    const address = email();
    await db.insert(schema.users).values({ email: address });
    const reset = await token(await post("forgot", { email: address }));
    const responses = await Promise.all([post("reset", { token: reset, password }), post("reset", { token: reset, password: nextPassword })]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
  });

  it("revokes old sessions after reset and accepts only the new session version", async () => {
    const address = email();
    const first = await session(await post("verify", { token: await token(await signup(address)) }));
    const second = await session(await login(address));
    const me = (jwt: string) => app.request("/api/auth/me", { headers: { Authorization: `Bearer ${jwt}` } });
    expect((await me(first.jwt)).status).toBe(200);
    const reset = await token(await post("forgot", { email: address }));
    const fresh = await session(await post("reset", { token: reset, password: nextPassword }));
    expect((await me(first.jwt)).status).toBe(401);
    expect((await me(second.jwt)).status).toBe(401);
    expect((await me(fresh.jwt)).status).toBe(200);
    expect((await me((await session(await login(address, nextPassword))).jwt)).status).toBe(200);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, first.user.id));
    expect(user.sessionVersion).toBe(1);
  });

  it("rejects unversioned sessions and sessions for missing users", async () => {
    const [user] = await db.insert(schema.users).values({ email: email() }).returning();
    const legacy = await new SignJWT({ sub: user.id, purpose: "session" })
      .setProtectedHeader({ alg: "HS256" }).setExpirationTime("30d").sign(new TextEncoder().encode(env.jwtSecret()));
    for (const jwt of [legacy, await issueJwt(crypto.randomUUID(), 0), await issueJwt(user.id, 1)]) {
      expect((await app.request("/api/auth/me", { headers: { Authorization: `Bearer ${jwt}` } })).status).toBe(401);
    }
  });

  it("returns 500 on a session lookup failure and accepts the same session when the database recovers", async () => {
    const [user] = await db.insert(schema.users).values({ email: email() }).returning();
    const jwt = await issueJwt(user.id, user.sessionVersion);
    const me = () => app.request("/api/auth/me", { headers: { Authorization: `Bearer ${jwt}` } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const select = vi.spyOn(db, "select").mockImplementationOnce(() => {
      throw new Error("Database temporarily unavailable");
    });
    expect((await me()).status).toBe(500);
    expect(select).toHaveBeenCalledOnce();
    expect((await me()).status).toBe(200);
  });

  it("omits password hashes from internal reminder and review responses too", async () => {
    vi.spyOn(env, "internalSecret").mockReturnValue("test-internal-secret");
    const address = email();
    const verified = await session(await post("verify", { token: await token(await signup(address)) }));
    await db.update(schema.users).set({ reviewLink: "https://example.com/review" }).where(eq(schema.users.id, verified.user.id));
    const [client] = await db.insert(schema.clients).values({ userId: verified.user.id, name: "Client", phone: "+353871234567" }).returning();
    for (const status of ["confirmed", "completed"] as const) {
      await db.insert(schema.bookings).values({ userId: verified.user.id, clientId: client.id, service: "Test", priceCents: 1000, status,
        startAt: new Date(Date.now() + 60 * 60 * 1000), completedAt: status === "completed" ? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) : null });
    }
    for (const path of ["reminders", "reviews"]) {
      const response = await app.request(`/api/internal/${path}`, { headers: { "X-Internal-Secret": "test-internal-secret" } });
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain(address);
      expect(text).not.toMatch(/passwordHash|password_hash|scrypt\$/);
    }
  });

  it("does not reveal unknown accounts or send mail for a forgot request to an unknown email", async () => {
    const send = vi.spyOn(globalThis, "fetch");
    const address = email();
    for (let n = 0; n < 3; n++) {
      const response = await post("forgot", { email: address });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }
    expect((await post("forgot", { email: address })).status).toBe(429);
    expect(send).not.toHaveBeenCalled();
    expect(await db.select().from(schema.users).where(eq(schema.users.email, address))).toHaveLength(0);
  });

  it("rejects used, expired and wrong-purpose links without consuming the right-purpose link", async () => {
    const address = email();
    const verifyToken = await token(await signup(address));
    expect((await post("reset", { token: verifyToken, password })).status).toBe(401);
    await session(await post("verify", { token: verifyToken }));
    expect((await post("verify", { token: verifyToken })).status).toBe(401);
    const reset = await token(await post("forgot", { email: address }));
    expect((await post("verify", { token: reset })).status).toBe(401);
    await session(await post("reset", { token: reset, password }));
    const expired = await token(await post("forgot", { email: address }));
    await db.update(schema.loginTokens).set({ createdAt: new Date(Date.now() - 16 * 60 * 1000) })
      .where(and(eq(schema.loginTokens.email, address), eq(schema.loginTokens.purpose, "reset")));
    expect((await post("reset", { token: expired, password })).status).toBe(401);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, address));
    const [record] = await db.insert(schema.loginTokens).values({ email: address, purpose: "reset" }).returning();
    const expiredJwt = await new SignJWT({ sub: user.id, purpose: "email-link" }).setJti(record.id)
      .setProtectedHeader({ alg: "HS256" }).setExpirationTime("0s").sign(new TextEncoder().encode(env.jwtSecret()));
    expect((await post("reset", { token: expiredJwt, password })).status).toBe(401);
    expect((await post("verify", { token: await issueJwt(user.id, user.sessionVersion) })).status).toBe(401);
    expect((await post("reset", { token: await issueEmailToken(user.id, record.id), password })).status).toBe(200);
  });

  it("does not change an existing verified password on signup and emails the forgot link", async () => {
    const address = email();
    const verified = await session(await post("verify", { token: await token(await signup(address)) }));
    const [before] = await db.select().from(schema.users).where(eq(schema.users.id, verified.user.id));
    vi.spyOn(env, "isLocal").mockReturnValue(false);
    vi.spyOn(env, "resendKey").mockReturnValue("test-placeholder");
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const response = await signup(address, nextPassword);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const mail = JSON.parse(String(send.mock.calls[0][1]?.body)) as { subject: string; text: string };
    expect(mail.subject).toContain("already have");
    expect(mail.text).toContain(`${env.appUrl()}/forgot`);
    expect(mail.text).not.toContain("token=");
    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, verified.user.id));
    expect(after.passwordHash).toBe(before.passwordHash);
    await session(await login(address));
    expect((await login(address, nextPassword)).status).toBe(401);
  });

  it("rejects short passwords and removes the old magic-link endpoint", async () => {
    expect((await signup(email(), "short")).status).toBe(400);
    expect((await signup("not-an-email")).status).toBe(400);
    expect((await post("reset", { token: "invalid", password: "short" })).status).toBe(400);
    expect((await post("magic-link", { email: email() })).status).toBe(404);
  });

  it("does not hash throttled signups, existing-account reminders, or forgot requests", async () => {
    const address = email();
    await signup(address);
    await signup(address);
    await signup(address);
    const hash = vi.spyOn(passwords, "hashPassword");
    expect((await signup(address)).status).toBe(429);
    expect((await post("forgot", { email: address })).status).toBe(429);
    expect(hash).not.toHaveBeenCalled();
    const verifiedAddress = email();
    await post("verify", { token: await token(await signup(verifiedAddress)) });
    hash.mockClear();
    expect((await signup(verifiedAddress, nextPassword)).status).toBe(200);
    expect((await post("forgot", { email: verifiedAddress })).status).toBe(200);
    expect(hash).not.toHaveBeenCalled();
  });

  it("safely handles production forgot email failures and keeps local reset links usable", async () => {
    const address = email();
    await db.insert(schema.users).values({ email: address });
    vi.spyOn(env, "isLocal").mockReturnValue(false);
    vi.spyOn(env, "resendKey").mockReturnValue(undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect((await post("forgot", { email: address })).status).toBe(502);
    expect(log).not.toHaveBeenCalled();
    expect(await db.select().from(schema.loginTokens).where(eq(schema.loginTokens.email, address))).toHaveLength(0);
    vi.spyOn(env, "isLocal").mockReturnValue(true);
    const reset = await token(await post("forgot", { email: address }));
    expect(log).toHaveBeenCalled();
    await session(await post("reset", { token: reset, password }));
  });

  it("normalizes business account details, validates IBAN and BIC, and permits clearing optional fields", async () => {
    const address = email();
    const { jwt } = await session(await post("verify", { token: await token(await signup(address)) }));
    const update = (body: object) => app.request("/api/auth/me", {
      method: "PATCH", headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body),
    });
    const response = await update({ address: "Dublin", iban: "ie29 aibk 9311 5212 3456 78", bic: "aibkie2d" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ address: "Dublin", iban: "IE29AIBK93115212345678", bic: "AIBKIE2D" });
    const invalid = await update({ iban: "IE29AIBK93115212345679" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { fieldErrors: { iban: ["Enter a valid IBAN."] } } });
    expect((await update({ bic: "invalid" })).status).toBe(400);
    expect((await update({ address: null, iban: null, bic: null })).status).toBe(200);
    expect(normaliseIban("gb82 west 1234 5698 7654 32")).toBe("GB82WEST12345698765432");
    expect(validIban("GB82WEST12345698765432")).toBe(true);
    expect(validIban("")).toBe(false);
    expect(validIban("GB00WEST12345698765432")).toBe(false);
    expect(validBic("aibkie2dxxx")).toBe(true);
    expect(validBic("AIBK IE2D")).toBe(false);
    expect(UpdateUserInput.safeParse({ iban: "" }).success).toBe(false);
  });

  it("uses random salts, verifies passwords, and safely rejects malformed hashes", async () => {
    const first = await hashPassword(password);
    expect(first).toMatch(/^scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
    expect(await hashPassword(password)).not.toBe(first);
    expect(await checkPassword(password, first)).toBe(true);
    expect(await checkPassword("incorrect", first)).toBe(false);
    expect(await checkPassword(password, "")).toBe(false);
    expect(await checkPassword(password, "scrypt$9999999999$8$1$salt$hash")).toBe(false);
  });
});
