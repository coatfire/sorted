import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { MarkPaidInput } from "@sorted/core";
import Stripe from "stripe";
import { db, schema } from "../db";
import { emitBookingEvent } from "../lib/events";
import { env } from "../lib/env";
import type { AppEnv } from "../app";

export const paymentRoutes = new Hono<AppEnv>();

/** GET /api/payments?status=pending — the "who owes me" view */
paymentRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const status = c.req.query("status");
  if (status && status !== "pending" && status !== "paid" && status !== "cancelled") {
    return c.json({ error: "Invalid status" }, 400);
  }
  const conditions = [eq(schema.payments.userId, userId)];
  if (status) {
    conditions.push(
      eq(schema.payments.status, status as "pending" | "paid" | "cancelled"),
    );
  }
  const payments = await db
    .select({
      payment: schema.payments,
      booking: schema.bookings,
      client: schema.clients,
    })
    .from(schema.payments)
    .innerJoin(schema.bookings, eq(schema.payments.bookingId, schema.bookings.id))
    .innerJoin(schema.clients, eq(schema.bookings.clientId, schema.clients.id))
    .where(and(...conditions))
    .orderBy(desc(schema.payments.createdAt));
  return c.json(payments);
});

/**
 * POST /api/payments/:id/link — create Stripe Payment Link.
 * Ad-hoc Stripe prices keep each booking amount self-contained, while metadata
 * lets the webhook resolve the corresponding payment.
 */
paymentRoutes.post("/:id/link", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const [row] = await db
    .select({
      payment: schema.payments,
      booking: schema.bookings,
    })
    .from(schema.payments)
    .innerJoin(schema.bookings, eq(schema.payments.bookingId, schema.bookings.id))
    .where(
      and(eq(schema.payments.id, id), eq(schema.payments.userId, userId)),
    );
  if (!row) return c.json({ error: "Payment not found" }, 404);
  if (row.payment.status !== "pending") {
    return c.json({ error: "Only pending payments can have a link" }, 409);
  }
  if (row.payment.linkUrl) return c.json(row.payment);

  const key = env.stripeKey();
  if (!key) return c.json({ error: "Stripe is not configured" }, 503);
  const stripe = new Stripe(key);
  let link: Stripe.PaymentLink;
  try {
    const price = await stripe.prices.create({
      currency: "eur",
      unit_amount: row.payment.amountCents,
      product_data: {
        name: `${row.booking.service} — ${row.payment.kind}`,
      },
    });
    link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { payment_id: row.payment.id },
      payment_intent_data: { metadata: { payment_id: row.payment.id } },
    });
  } catch (err) {
    console.error("[payments] Stripe link creation failed", err);
    return c.json({ error: "Stripe couldn't create the payment link" }, 502);
  }
  const [payment] = await db
    .update(schema.payments)
    .set({
      method: "stripe",
      stripePaymentLinkId: link.id,
      linkUrl: link.url,
    })
    .where(eq(schema.payments.id, row.payment.id))
    .returning();
  await emitBookingEvent(userId, payment.bookingId, "payment.link_created", {
    id: payment.id,
    kind: payment.kind,
    amountCents: payment.amountCents,
    linkUrl: payment.linkUrl,
  });
  return c.json(payment);
});

/** POST /api/payments/:id/mark-paid — cash / bank transfer */
paymentRoutes.post("/:id/mark-paid", async (c) => {
  const parsed = MarkPaidInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const userId = c.get("userId");
  const [current] = await db
    .select()
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.id, c.req.param("id")),
        eq(schema.payments.userId, userId),
      ),
    );
  if (!current) return c.json({ error: "Payment not found" }, 404);
  if (current.status !== "pending") {
    return c.json({ error: "Payment is not pending" }, 409);
  }
  const [payment] = await db
    .update(schema.payments)
    .set({
      status: "paid",
      method: parsed.data.method,
      paidAt: new Date(),
    })
    .where(eq(schema.payments.id, current.id))
    .returning();
  await emitBookingEvent(userId, payment.bookingId, "payment.paid", {
    id: payment.id,
    kind: payment.kind,
    amountCents: payment.amountCents,
    linkUrl: payment.linkUrl,
  });
  return c.json(payment);
});
