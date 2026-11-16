import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { EditPaymentInput, MarkPaidInput } from "@sorted/core";
import Stripe from "stripe";
import { db, schema } from "../db";
import { emitBookingEvent } from "../lib/events";
import { env } from "../lib/env";
import { deactivatePaymentLink } from "../lib/stripe";
import { effectivePaymentVatRate } from "../lib/tax";
import type { AppEnv } from "../app";
import { lockBookingWithClient, userTransaction } from "../lib/transaction";

export const paymentRoutes = new Hono<AppEnv>();

async function correctPayment(userId: string, id: string, input: EditPaymentInput | null) {
  const result = await userTransaction(userId, async tx => {
    const [owner] = await tx.select({ bookingId: schema.payments.bookingId }).from(schema.payments).where(and(eq(schema.payments.id, id), eq(schema.payments.userId, userId)));
    if (!owner) return { error: "Payment not found", status: 404 as const };
    const row = await lockBookingWithClient(tx, userId, owner.bookingId);
    if (!row) return { error: "Payment not found", status: 404 as const };
    if (input && row.booking.priceCents === null) return { error: "Add a price first", status: 409 as const };
    const payments = await tx.select().from(schema.payments).where(and(eq(schema.payments.bookingId, row.booking.id), eq(schema.payments.userId, userId))).orderBy(schema.payments.id).for("update");
    const current = payments.find(payment => payment.id === id);
    if (!current) return { error: "Payment not found", status: 404 as const };
    if (current.method === "stripe") return { error: "Paid by card — refund it in Stripe", status: 409 as const };
    if (current.status !== "paid") return { error: "Only paid payments can be corrected.", status: 409 as const };
    const receipts = await tx.select().from(schema.invoices).where(and(eq(schema.invoices.userId, userId), eq(schema.invoices.paymentId, id), eq(schema.invoices.kind, "receipt"))).orderBy(schema.invoices.id).for("update");
    if (input && receipts.length) return { error: "A receipt was issued for this payment. Undo it and record it again.", status: 409 as const };
    const total = payments.filter(payment => payment.status === "paid" && payment.id !== id).reduce((sum, payment) => sum + payment.amountCents, 0) + (input ? input.amount_cents ?? current.amountCents : 0);
    if (input && total > row.booking.priceCents!) return { error: "The total paid cannot exceed the booking price.", status: 409 as const };
    const [payment] = await tx.update(schema.payments).set(input ? { amountCents: input.amount_cents, method: input.method, paidAt: input.paid_at ? new Date(input.paid_at) : undefined } : { status: "cancelled" }).where(and(eq(schema.payments.id, id), eq(schema.payments.userId, userId))).returning();
    if (!input && receipts.length) await tx.update(schema.invoices).set({ voidedAt: new Date() }).where(and(eq(schema.invoices.userId, userId), eq(schema.invoices.paymentId, id), eq(schema.invoices.kind, "receipt")));
    const pending = payments.filter(payment => payment.status === "pending");
    const keep = pending.length === 1 && row.booking.priceCents !== null && pending[0].amountCents === row.booking.priceCents - total;
    const cancelled = !keep && pending.length ? await tx.update(schema.payments).set({ status: "cancelled" }).where(and(eq(schema.payments.userId, userId), eq(schema.payments.bookingId, row.booking.id), eq(schema.payments.status, "pending"))).returning({ linkId: schema.payments.stripePaymentLinkId }) : [];
    return { payment, cancelled };
  });
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
  for (const { linkId } of result.cancelled) if (linkId) await deactivatePaymentLink(linkId);
  await emitBookingEvent(userId, result.payment.bookingId, input ? "payment.corrected" : "payment.undone", { id: result.payment.id, kind: result.payment.kind, amountCents: result.payment.amountCents, linkUrl: result.payment.linkUrl });
  return Response.json(result.payment);
}

paymentRoutes.patch("/:id", async c => {
  const parsed = EditPaymentInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  return correctPayment(c.get("userId"), c.req.param("id"), parsed.data);
});

paymentRoutes.post("/:id/undo", c => correctPayment(c.get("userId"), c.req.param("id"), null));

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
      receiptVoidedAt: schema.invoices.voidedAt,
    })
    .from(schema.payments)
    .innerJoin(schema.bookings, eq(schema.payments.bookingId, schema.bookings.id))
    .innerJoin(schema.clients, eq(schema.bookings.clientId, schema.clients.id))
    .leftJoin(schema.invoices, and(eq(schema.invoices.paymentId, schema.payments.id), eq(schema.invoices.userId, userId), eq(schema.invoices.kind, "receipt")))
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
  return createPaymentLink(c.get("userId"), c.req.param("id"));
});

export async function createPaymentLink(userId: string, id: string) {
  const [row] = await db
    .select({
      payment: schema.payments,
      booking: schema.bookings,
    })
    .from(schema.payments)
    .innerJoin(schema.bookings, eq(schema.payments.bookingId, schema.bookings.id))
    .where(
      and(eq(schema.payments.id, id), eq(schema.payments.userId, userId), eq(schema.bookings.userId, userId)),
    );
  if (!row) return Response.json({ error: "Payment not found" }, { status: 404 });
  if (row.booking.priceCents === null) return Response.json({ error: "Add a price first" }, { status: 409 });
  if (row.payment.status !== "pending") {
    return Response.json({ error: "Only pending payments can have a link" }, { status: 409 });
  }
  if (row.payment.linkUrl) return Response.json(row.payment);

  const key = env.stripeKey();
  if (!key) return Response.json({ error: "Stripe is not configured" }, { status: 503 });
  const stripe = new Stripe(key);
  let link: Stripe.PaymentLink;
  try {
    const price = await stripe.prices.create({
      currency: "eur",
      unit_amount: row.payment.amountCents,
      product_data: {
        name: `${row.booking.service} — ${row.payment.kind}`,
      },
    }, { idempotencyKey: `payment-price-${row.payment.id}` });
    link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      restrictions: { completed_sessions: { limit: 1 } },
      metadata: { payment_id: row.payment.id, user_id: userId },
      payment_intent_data: {
        metadata: { payment_id: row.payment.id, user_id: userId },
      },
    }, { idempotencyKey: `payment-link-${row.payment.id}` });
  } catch {
    console.error("[payments] Stripe link creation failed");
    return Response.json({ error: "Stripe couldn't create the payment link" }, { status: 502 });
  }
  const [payment] = await db
    .update(schema.payments)
    .set({
      method: "stripe",
      stripePaymentLinkId: link.id,
      linkUrl: link.url,
    })
    .where(and(
      eq(schema.payments.id, row.payment.id),
      eq(schema.payments.userId, userId),
      eq(schema.payments.status, "pending"),
    ))
    .returning();
  if (!payment) {
    await deactivatePaymentLink(link.id);
    return Response.json({ error: "Only pending payments can have a link" }, { status: 409 });
  }
  await emitBookingEvent(userId, payment.bookingId, "payment.link_created", {
    id: payment.id,
    kind: payment.kind,
    amountCents: payment.amountCents,
    linkUrl: payment.linkUrl,
  });
  return Response.json(payment);
}

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
  const [booking] = await db.select().from(schema.bookings).where(and(eq(schema.bookings.id, current.bookingId), eq(schema.bookings.userId, userId)));
  if (!booking) return c.json({ error: "Booking not found" }, 404);
  if (booking.priceCents === null) return c.json({ error: "Add a price first" }, 409);
  if (current.status !== "pending") {
    return c.json({ error: "Payment is not pending" }, 409);
  }
  const [payment] = await db
    .update(schema.payments)
    .set({
      status: "paid",
      vatRateBp: effectivePaymentVatRate(userId),
      method: parsed.data.method,
      paidAt: new Date(),
    })
    .where(and(eq(schema.payments.id, current.id), eq(schema.payments.userId, userId), eq(schema.payments.status, "pending")))
    .returning();
  if (!payment) return c.json({ error: "Payment is not pending" }, 409);
  if (payment.stripePaymentLinkId) {
    await deactivatePaymentLink(payment.stripePaymentLinkId);
  }
  await emitBookingEvent(userId, payment.bookingId, "payment.paid", {
    id: payment.id,
    kind: payment.kind,
    amountCents: payment.amountCents,
    linkUrl: payment.linkUrl,
  });
  return c.json(payment);
});
