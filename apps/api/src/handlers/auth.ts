import { Hono } from "hono";
import { and, count, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { UpdateUserInput, TaxSettings } from "@sorted/core";
import { env } from "../lib/env";
import { db, schema } from "../db";
import { issueJwt, issueEmailToken, requireAuth, verifyEmailToken } from "../lib/auth";
import { checkPassword, hashPassword } from "../lib/password";
import { publicUser } from "../lib/user";
import type { AppEnv } from "../app";
import { googleRoutes } from "./google";

export const authRoutes = new Hono<AppEnv>();
authRoutes.route("/google", googleRoutes);
const Email = z.string().email().transform((value) => value.toLowerCase());
const Password = z.string().min(8, "Use at least 8 characters.").max(1024);
const Credentials = z.object({ email: Email, password: Password });
const recent = () => new Date(Date.now() - 15 * 60 * 1000);
const invalidLink = "Invalid or expired login link";

async function sendEmail(email: string, link: string, kind: "verify" | "reset" | "existing") {
  const key = env.resendKey();
  if (!key) return false;
  const subject = kind === "verify" ? "Verify your Sorted account"
    : kind === "reset" ? "Reset your Sorted password" : "You already have a Sorted account";
  const intro = kind === "verify" ? "Tap to verify your email and create your Sorted account:"
    : kind === "reset" ? "Tap to reset your Sorted password:"
      : "You already have a Sorted account. If you've forgotten your password, request a reset here:";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.emailFrom(), to: email, subject,
      text: `${intro}\n\n${link}\n\n${kind === "existing" ? "" : "This link works for 15 minutes. "}If you didn't ask for it, ignore this email.` }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    console.error("[auth] email send failed");
    return null;
  });
  if (res && !res.ok) console.error("[auth] email send failed", res.status);
  return Boolean(res?.ok);
}

for (const purpose of ["verify", "reset"] as const) {
  authRoutes.post(purpose === "verify" ? "/signup" : "/forgot", async (c) => {
    const parsed = (purpose === "verify" ? Credentials : z.object({ email: Email }))
      .safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const { email } = parsed.data;
    const password = "password" in parsed.data ? parsed.data.password : undefined;
    const result = await db.transaction(async (tx) => {
      if (purpose === "verify") await tx.insert(schema.users).values({ email }).onConflictDoNothing();
      const [user] = await tx.select().from(schema.users).where(eq(schema.users.email, email)).for("update");
      const [requests] = await tx.select({ count: count() }).from(schema.loginTokens).where(and(
        eq(schema.loginTokens.email, email), gte(schema.loginTokens.createdAt, recent()),
      ));
      if (requests.count >= 3) return null;
      const existing = purpose === "verify" && Boolean(user?.emailVerifiedAt && user.passwordHash);
      const pendingHash = !existing && typeof password === "string" ? await hashPassword(password) : null;
      const [record] = await tx.insert(schema.loginTokens).values({
        email, purpose, pendingPasswordHash: existing ? null : pendingHash,
      }).returning();
      return { user, record, existing };
    });
    if (!result) return c.json({ error: "Too many login links requested. Check your email, or try again in 15 minutes." }, 429);
    const { user, record, existing } = result;
    if (!user) return c.json({ ok: true });
    const link = existing ? `${env.appUrl()}/forgot`
      : `${env.appUrl()}/${purpose === "verify" ? "verify" : "reset"}?token=${await issueEmailToken(user.id, record.id)}`;
    const emailed = await sendEmail(email, link, existing ? "existing" : purpose);
    if (!emailed) {
      if (env.isLocal()) console.log(`\n🔑 Login link for ${email}: ${link}\n`);
      else {
        await db.delete(schema.loginTokens).where(and(
          eq(schema.loginTokens.id, record.id), eq(schema.loginTokens.email, email),
        ));
        return c.json({ error: "We couldn't send your login email. Try again in a minute." }, 502);
      }
    }
    return c.json({ ok: true, ...(env.isLocal() && !emailed ? { dev_link: link } : {}) });
  });
}

authRoutes.post("/login", async (c) => {
  const parsed = z.object({ email: Email, password: z.string().max(1024) }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Email or password is incorrect." }, 401);
  const { email, password } = parsed.data;
  const result = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.email, email)).for("update");
    const [attempts] = await tx.select({ count: count() }).from(schema.loginAttempts).where(and(
      eq(schema.loginAttempts.email, email), gte(schema.loginAttempts.createdAt, recent()),
    ));
    if (attempts.count >= 10) return "limited";
    if (user?.emailVerifiedAt && user.passwordHash && await checkPassword(password, user.passwordHash)) return user;
    await tx.insert(schema.loginAttempts).values({ email });
    return null;
  });
  if (result === "limited") return c.json({ error: "Too many login attempts. Try again in 15 minutes." }, 429);
  if (!result) return c.json({ error: "Email or password is incorrect." }, 401);
  return c.json({ jwt: await issueJwt(result.id, result.sessionVersion), user: publicUser(result) });
});

for (const purpose of ["verify", "reset"] as const) {
  authRoutes.post(`/${purpose}`, async (c) => {
    const parsed = (purpose === "verify" ? z.object({ token: z.string().min(1) })
      : z.object({ token: z.string().min(1), password: Password })).safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    let identity: { userId: string; tokenId: string };
    try { identity = await verifyEmailToken(parsed.data.token); }
    catch { return c.json({ error: invalidLink }, 401); }
    const resetHash = "password" in parsed.data && typeof parsed.data.password === "string"
      ? await hashPassword(parsed.data.password) : null;
    const result = await db.transaction(async (tx) => {
      const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, identity.userId)).for("update");
      if (!user) return null;
      if (purpose === "verify" && user.passwordHash) return null;
      const [record] = await tx.select().from(schema.loginTokens).where(and(
        eq(schema.loginTokens.id, identity.tokenId), eq(schema.loginTokens.email, user.email),
        eq(schema.loginTokens.purpose, purpose), isNull(schema.loginTokens.usedAt),
        gte(schema.loginTokens.createdAt, recent()),
      )).for("update");
      const passwordHash = purpose === "verify" ? record?.pendingPasswordHash : resetHash;
      if (!record || !passwordHash) return null;
      await tx.update(schema.loginTokens).set({ usedAt: new Date(), pendingPasswordHash: null }).where(and(
        eq(schema.loginTokens.email, user.email), isNull(schema.loginTokens.usedAt),
      ));
      const [updated] = await tx.update(schema.users).set({
        passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        sessionVersion: purpose === "reset" ? user.sessionVersion + 1 : user.sessionVersion,
      }).where(eq(schema.users.id, user.id)).returning();
      return updated;
    });
    if (!result) return c.json({ error: invalidLink }, 401);
    return c.json({ jwt: await issueJwt(result.id, result.sessionVersion), user: publicUser(result) });
  });
}

authRoutes.get("/me", requireAuth, async (c) => {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, c.get("userId")));
  if (!user) return c.json({ error: "Not found" }, 404);
  return c.json(publicUser(user));
});

authRoutes.patch("/me", requireAuth, async (c) => {
  const parsed = UpdateUserInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(schema.users).where(eq(schema.users.id, c.get("userId"))).for("update");
    if (!current) return c.json({ error: "Not found" }, 404);
    const tax = TaxSettings.safeParse({
      vatRegistered: input.vat_registered ?? current.vatRegistered,
      vatRateBp: input.vat_rate_bp === undefined ? current.vatRateBp : input.vat_rate_bp,
      vatPeriodMonths: input.vat_period_months ?? current.vatPeriodMonths,
      incomeTaxRateBp: input.income_tax_rate_bp === undefined ? current.incomeTaxRateBp : input.income_tax_rate_bp,
    });
    if (!tax.success) return c.json({ error: tax.error.flatten() }, 400);
    const [user] = await tx.update(schema.users).set({
      ...tax.data,
      name: input.name, businessName: input.business_name, phone: input.phone, reviewLink: input.review_link,
      address: input.address, iban: input.iban, bic: input.bic,
      bookingConfirmationTemplate: input.booking_confirmation_template,
      paymentRequestTemplate: input.payment_request_template,
      invoiceLogo: input.invoice_logo, invoiceAccent: input.invoice_accent,
      invoiceFooter: input.invoice_footer, vatNumber: input.vat_number,
      revolutLink: input.revolut_link,
      importOfferClosedAt: input.import_offer_closed ? current.importOfferClosedAt ?? new Date() : undefined,
      services: input.services,
    }).where(eq(schema.users.id, c.get("userId"))).returning();
    if (!user) return c.json({ error: "Not found" }, 404);
    return c.json(publicUser(user));
  });
});
