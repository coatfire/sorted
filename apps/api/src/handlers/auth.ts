import { Hono } from "hono";
import { eq } from "drizzle-orm";
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
  }).catch((err) => {
    console.error("[auth] email send failed", err);
    return null;
  });
  if (res && !res.ok) console.error("[auth] email send failed", res.status, await res.text());
  return Boolean(res?.ok);
}

/**
 * POST /api/auth/magic-link  { email }
 * Creates the user if new, then delivers a 15-minute login link:
 *  - RESEND_API_KEY set → emailed
 *  - local dev          → returned as `dev_link` so the login screen can open it
 *  - otherwise          → logged (so a deploy without email is still usable)
 */
authRoutes.post("/magic-link", async (c) => {
  const parsed = z
    .object({ email: z.string().email().transform((value) => value.toLowerCase()) })
    .safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Valid email required" }, 400);
  const { email } = parsed.data;

  let [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email));
  if (!user) {
    [user] = await db
      .insert(schema.users)
      .values({ email })
      .returning();
  }

  const token = await issueMagicLinkToken(user.id);
  const link = `${env.appUrl()}/login?token=${token}`;
  const emailed = await sendLoginEmail(email, link);
  if (!emailed) console.log(`\n🔑 Login link for ${email}: ${link}\n`);

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
    const userId = await verifyMagicLinkToken(token);
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user) return c.json({ error: "User not found" }, 404);
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
