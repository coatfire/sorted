import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import Stripe from "stripe";
import { db, schema } from "../db";
import { emitBookingEvent } from "../lib/events";
import { env } from "../lib/env";

export const webhookRoutes = new Hono();

/**
 * POST /api/webhooks/stripe
 * Checkout completion flow:
 *   1. const sig = c.req.header("stripe-signature")
 *   2. stripe.webhooks.constructEvent(await c.req.text(), sig,
 *      env.stripeWebhookSecret()) — MUST use the raw text body
 *   3. On "checkout.session.completed" (payment links fire this):
 *      payment_id = event.data.object.metadata.payment_id
 *      → set status=paid, paidAt, method=stripe
 *      → emitEvent("payment.paid", …)
 *   4. Always return 200 fast; do nothing slow here.
 * Local testing: `stripe listen --forward-to localhost:3001/api/webhooks/stripe`
 */
webhookRoutes.post("/stripe", async (c) => {
  const key = env.stripeKey();
  const webhookSecret = env.stripeWebhookSecret();
  const signature = c.req.header("stripe-signature");
  if (!key || !webhookSecret) {
    return c.json({ error: "Stripe webhook is not configured" }, 503);
  }
  if (!signature) return c.json({ error: "Missing Stripe signature" }, 400);

  const stripe = new Stripe(key);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      await c.req.text(),
      signature,
      webhookSecret,
    );
  } catch {
    return c.json({ error: "Invalid Stripe signature" }, 400);
  }

  if (event.type !== "checkout.session.completed") {
    return c.json({ received: true });
  }
  const session = event.data.object;
  const paymentId = session.metadata?.payment_id;
  const userId = session.metadata?.user_id;
  if (!paymentId || !userId) {
    console.error(paymentId ?? "missing", session.id);
    return c.json({ received: true });
  }

  const [current] = await db
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.id, paymentId), eq(schema.payments.userId, userId)));
  if (current?.status === "cancelled") {
    console.error(current.id, session.id);
  }
  if (!current || current.status !== "pending") {
    return c.json({ received: true });
  }
  const [payment] = await db
    .update(schema.payments)
    .set({ status: "paid", method: "stripe", paidAt: new Date() })
    .where(and(
      eq(schema.payments.id, paymentId),
      eq(schema.payments.userId, userId),
      eq(schema.payments.status, "pending"),
    ))
    .returning();
  if (!payment) {
    console.error(paymentId, session.id);
    return c.json({ received: true });
  }
  await emitBookingEvent(
    payment.userId,
    payment.bookingId,
    "payment.paid",
    {
      id: payment.id,
      kind: payment.kind,
      amountCents: payment.amountCents,
      linkUrl: payment.linkUrl,
    },
  );
  return c.json({ received: true });
});
