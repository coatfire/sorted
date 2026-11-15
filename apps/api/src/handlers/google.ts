import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createLocalJWKSet, jwtVerify, SignJWT } from "jose";
import { and, count, eq, gt, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db";
import { env } from "../lib/env";
import { issueJwt } from "../lib/auth";
import { publicUser } from "../lib/user";
import type { AppEnv } from "../app";

export const googleRoutes = new Hono<AppEnv>();
const cookieName = "sorted_google_oauth";
const cookieOptions = { path: "/api/auth/google", httpOnly: true, secure: true, sameSite: "Lax" as const };
const secret = () => new TextEncoder().encode(env.jwtSecret());
const random = () => randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const redirectUri = () => `${env.apiUrl()}/api/auth/google/callback`;
const errorUrl = () => `${env.appUrl()}/login?error=google`;
const OAuthCookie = z.object({ purpose: z.literal("google-oauth"), state: z.string().min(1), nonce: z.string().min(1), verifier: z.string().min(43).max(128) });
const GoogleIdentity = z.object({ sub: z.string().min(1), email: z.string().email().transform((email) => email.toLowerCase()), email_verified: z.literal(true), nonce: z.string() });

async function limited(scope: string, ip: string) {
  return db.transaction(async (tx) => {
    const key = `google-${scope}:${ip}`;
    const [attempts] = await tx.select({ count: count() }).from(schema.loginAttempts).where(and(
      eq(schema.loginAttempts.email, key), gte(schema.loginAttempts.createdAt, new Date(Date.now() - 15 * 60 * 1000)),
    ));
    if (attempts.count >= 10) return true;
    await tx.insert(schema.loginAttempts).values({ email: key });
    return false;
  });
}

googleRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  await next();
});

googleRoutes.get("/start", async (c) => {
  if (!env.googleSignIn()) return c.json({ error: "Not found" }, 404);
  try {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    if (await limited("start", ip)) return c.redirect(errorUrl());
    const state = random(), nonce = random(), verifier = random();
    const cookie = await new SignJWT({ purpose: "google-oauth", state, nonce, verifier })
      .setProtectedHeader({ alg: "HS256" }).setAudience("sorted-google-oauth").setIssuedAt().setExpirationTime("10m").sign(secret());
    setCookie(c, cookieName, cookie, { ...cookieOptions, maxAge: 600 });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: env.googleClientId()!, redirect_uri: redirectUri(), response_type: "code",
      scope: "openid email profile", prompt: "select_account", state, nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
    return c.redirect(url.toString());
  } catch { return c.redirect(errorUrl()); }
});

googleRoutes.get("/callback", async (c) => {
  const cookie = getCookie(c, cookieName);
  deleteCookie(c, cookieName, cookieOptions);
  try {
    if (!env.googleSignIn() || !cookie || c.req.query("error")) throw new Error("Invalid Google sign-in");
    const { payload } = await jwtVerify(cookie, secret(), { algorithms: ["HS256"], audience: "sorted-google-oauth" });
    const flow = OAuthCookie.parse(payload);
    const state = c.req.query("state"), code = c.req.query("code");
    if (!state || !code || Buffer.byteLength(state) !== Buffer.byteLength(flow.state) || !timingSafeEqual(Buffer.from(state), Buffer.from(flow.state))) throw new Error("Invalid state");
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: env.googleClientId()!, client_secret: env.googleClientSecret()!, redirect_uri: redirectUri(), grant_type: "authorization_code", code_verifier: flow.verifier }),
    });
    if (!response.ok) throw new Error("Google exchange failed");
    const tokens = z.object({ id_token: z.string().min(1) }).parse(await response.json());
    const keysResponse = await fetch("https://www.googleapis.com/oauth2/v3/certs", { signal: AbortSignal.timeout(5000) });
    if (!keysResponse.ok) throw new Error("Google keys unavailable");
    const keys = z.object({ keys: z.array(z.object({ kty: z.string() }).passthrough()).min(1) }).parse(await keysResponse.json());
    const verified = await jwtVerify(tokens.id_token, createLocalJWKSet(keys), {
      algorithms: ["RS256"], issuer: ["accounts.google.com", "https://accounts.google.com"], audience: env.googleClientId(), requiredClaims: ["exp", "sub", "nonce", "email"],
    });
    const identity = GoogleIdentity.parse(verified.payload);
    if (identity.nonce !== flow.nonce) throw new Error("Invalid nonce");
    const exchangeCode = random();
    await db.transaction(async (tx) => {
      let [user] = await tx.select().from(schema.users).where(eq(schema.users.googleSub, identity.sub)).for("update");
      if (!user) {
        [user] = await tx.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${identity.email}`).for("update");
        if (!user) {
          [user] = await tx.insert(schema.users).values({ email: identity.email, googleSub: identity.sub, emailVerifiedAt: new Date() }).onConflictDoNothing().returning();
          if (!user) [user] = await tx.select().from(schema.users).where(eq(schema.users.googleSub, identity.sub)).for("update");
          if (!user) [user] = await tx.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${identity.email}`).for("update");
        }
        if (!user || (user.googleSub && user.googleSub !== identity.sub)) throw new Error("Account already linked");
        [user] = await tx.update(schema.users).set({ googleSub: identity.sub, emailVerifiedAt: user.emailVerifiedAt ?? new Date() })
          .where(eq(schema.users.id, user.id)).returning();
      }
      await tx.insert(schema.loginCodes).values({ codeHash: hash(exchangeCode), userId: user.id, sessionVersion: user.sessionVersion, expiresAt: new Date(Date.now() + 2 * 60000) });
    });
    return c.redirect(`${env.appUrl()}/login/google?code=${encodeURIComponent(exchangeCode)}`);
  } catch { return c.redirect(errorUrl()); }
});

googleRoutes.post("/exchange", async (c) => {
  if (!env.googleSignIn()) return c.json({ error: "Not found" }, 404);
  try {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    if (await limited("exchange", ip)) return c.json({ error: "Too many login attempts. Try again in 15 minutes." }, 429);
    const input = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).parse(await c.req.json());
    const user = await db.transaction(async (tx) => {
      const [code] = await tx.delete(schema.loginCodes).where(and(eq(schema.loginCodes.codeHash, hash(input.code)), gt(schema.loginCodes.expiresAt, new Date()))).returning();
      if (!code) return null;
      const [owner] = await tx.select().from(schema.users).where(eq(schema.users.id, code.userId)).for("update");
      return owner?.sessionVersion === code.sessionVersion ? owner : null;
    });
    if (!user) return c.json({ error: "Couldn't sign in with Google. Try again or use your email." }, 401);
    return c.json({ jwt: await issueJwt(user.id, user.sessionVersion), user: publicUser(user) });
  } catch { return c.json({ error: "Couldn't sign in with Google. Try again or use your email." }, 401); }
});
