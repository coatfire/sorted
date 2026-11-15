import { Hono } from "hono";
import { and, count, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { UpdateUserInput } from "@sorted/core";
import { env } from "../lib/env";
import { db, schema } from "../db";
import {
  issueJwt,
  issueMagicLinkToken,
  requireAuth,
  verifyMagicLinkToken,
} from "../lib/auth";
import type { AppEnv } from "../app";

export const authRoutes = new Hono<AppEnv>();

async function sendLoginEmail(email: string, link: string): Promise<boolean> {
  const key = env.resendKey();
  if (!key) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.emailFrom(),
      to: email,
      subject: "Your Sorted login link",
      text: `Tap to log in to Sorted:\n\n${link}\n\nThis link works for 15 minutes. If you didn't ask for it, ignore this email.`,
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    console.error("[auth] email send failed");
    return null;
  });
  if (res && !res.ok) console.error("[auth] email send failed", res.status);
  return Boolean(res?.ok);
}

/**
 * POST /api/auth/magic-link  { email }
 * Creates the user if new, then delivers a 15-minute login link:
 *  - RESEND_API_KEY set → emailed
 *  - local dev          → returned as `dev_link` so the login screen can open it
 *  - otherwise          → 502; discard the undelivered login token
 */
authRoutes.post("/magic-link", async (c) => {
  const parsed = z
    .object({ email: z.string().email().transform((value) => value.toLowerCase()) })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Valid email required" }, 400);
  const { email } = parsed.data;

  const result = await db.transaction(async (tx) => {
    await tx.insert(schema.users).values({ email }).onConflictDoNothing();
    const [user] = await tx.select().from(schema.users)
      .where(eq(schema.users.email, email)).for("update");
    const [recent] = await tx
    .select({ count: count() })
    .from(schema.loginTokens)
    .where(and(
      eq(schema.loginTokens.email, email),
      gte(schema.loginTokens.createdAt, new Date(Date.now() - 15 * 60 * 1000)),
    ));
    if (recent.count >= 3) return null;
    const [loginToken] = await tx.insert(schema.loginTokens).values({ email }).returning();
    return { user, loginToken };
  });
  if (!result) {
    return c.json({ error: "Too many login links requested. Check your email, or try again in 15 minutes." }, 429);
  }
  const { user, loginToken } = result;

  const token = await issueMagicLinkToken(user.id, loginToken.id);
  const link = `${env.appUrl()}/login?token=${token}`;
  const emailed = await sendLoginEmail(email, link);
  if (!emailed) {
    if (env.isLocal()) {
      console.log(`\n🔑 Login link for ${email}: ${link}\n`);
    } else {
      await db.delete(schema.loginTokens).where(and(
        eq(schema.loginTokens.id, loginToken.id), eq(schema.loginTokens.email, user.email),
      ));
      return c.json({ error: "We couldn't send your login email. Try again in a minute." }, 502);
    }
  }

  return c.json({
    ok: true,
    ...(env.isLocal() && !emailed ? { dev_link: link } : {}),
  });
});

/** POST /api/auth/verify  { token } → { jwt, user } */
authRoutes.post("/verify", async (c) => {
  const { token } = await c.req.json<{ token?: string }>();
  if (!token || typeof token !== "string") return c.json({ error: "token required" }, 400);
  try {
    const { userId, tokenId } = await verifyMagicLinkToken(token);
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user) return c.json({ error: "User not found" }, 404);
    const [consumed] = await db
      .update(schema.loginTokens)
      .set({ usedAt: new Date() })
      .where(and(
        eq(schema.loginTokens.id, tokenId),
        eq(schema.loginTokens.email, user.email),
        isNull(schema.loginTokens.usedAt),
      ))
      .returning({ id: schema.loginTokens.id });
    if (!consumed) return c.json({ error: "Invalid or expired login link" }, 401);
    return c.json({ jwt: await issueJwt(userId), user });
  } catch {
    return c.json({ error: "Invalid or expired login link" }, 401);
  }
});

/** GET /api/auth/me */
authRoutes.get("/me", requireAuth, async (c) => {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, c.get("userId")));
  if (!user) return c.json({ error: "Not found" }, 404);
  return c.json(user);
});

/** PATCH /api/auth/me — business settings */
authRoutes.patch("/me", requireAuth, async (c) => {
  const parsed = UpdateUserInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const input = parsed.data;
  const [user] = await db
    .update(schema.users)
    .set({
      name: input.name,
      businessName: input.business_name,
      phone: input.phone,
      reviewLink: input.review_link,
    })
    .where(eq(schema.users.id, c.get("userId")))
    .returning();
  if (!user) return c.json({ error: "Not found" }, 404);
  return c.json(user);
});
