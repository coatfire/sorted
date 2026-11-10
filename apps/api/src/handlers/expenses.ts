import { Hono } from "hono";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import {
  ConfirmExpenseInput,
  CreateExpenseInput,
  ExpenseCategory,
  ExpenseStatus,
  UploadReceiptInput,
} from "@sorted/core";
import { db, schema } from "../db";
import type { AppEnv } from "../app";

export const expenseRoutes = new Hono<AppEnv>();

/**
 * POST /api/expenses/receipts { content_type, data_base64 } → { receipt_key }
 * The web app downscales the photo before upload. Stored in Postgres for the
 * MVP (see schema.receipts); the key is opaque so S3 can replace it later.
 */
expenseRoutes.post("/receipts", async (c) => {
  const parsed = UploadReceiptInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "A JPEG, PNG or WebP photo under 1.5 MB is required" }, 400);
  const [receipt] = await db
    .insert(schema.receipts)
    .values({
      userId: c.get("userId"),
      contentType: parsed.data.content_type,
      dataBase64: parsed.data.data_base64,
    })
    .returning({ id: schema.receipts.id });
  return c.json({ receipt_key: receipt.id }, 201);
});

/**
 * POST /api/expenses — `confirmed: true` for an expense the person entered
 * themselves; otherwise it waits in needs_review (where OCR suggestions will
 * land — OCR guesses must never silently become tax records).
 */
expenseRoutes.post("/", async (c) => {
  const parsed = CreateExpenseInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const input = parsed.data;
  const userId = c.get("userId");
  if (input.receipt_key) {
    const [receipt] = await db
      .select({ id: schema.receipts.id })
      .from(schema.receipts)
      .where(
        and(
          eq(schema.receipts.id, input.receipt_key),
          eq(schema.receipts.userId, userId),
        ),
      );
    if (!receipt) return c.json({ error: "Receipt not found" }, 404);
  }
  const [expense] = await db
    .insert(schema.expenses)
    .values({
      userId,
      receiptKey: input.receipt_key,
      merchant: input.merchant,
      amountCents: input.amount_cents,
      category: input.category,
      expenseDate: input.expense_date,
      status: input.confirmed ? "confirmed" : "needs_review",
    })
    .returning();
  return c.json(expense, 201);
});

/** GET /api/expenses/:id/receipt → the image bytes */
expenseRoutes.get("/:id/receipt", async (c) => {
  const userId = c.get("userId");
  const [row] = await db
    .select({ receipt: schema.receipts })
    .from(schema.expenses)
    .innerJoin(
      schema.receipts,
      eq(sql`${schema.expenses.receiptKey}`, sql`${schema.receipts.id}::text`),
    )
    .where(
      and(
        eq(schema.expenses.id, c.req.param("id")),
        eq(schema.expenses.userId, userId),
        eq(schema.receipts.userId, userId),
      ),
    );
  if (!row) return c.json({ error: "Receipt not found" }, 404);
  return c.body(Buffer.from(row.receipt.dataBase64, "base64"), 200, {
    "Content-Type": row.receipt.contentType,
    "Cache-Control": "private, max-age=86400",
  });
});

/** GET /api/expenses?year=&category=&status= */
expenseRoutes.get("/", async (c) => {
  const { year, category, status } = c.req.query();
  const conditions = [eq(schema.expenses.userId, c.get("userId"))];
  if (year) {
    const parsedYear = Number(year);
    if (!Number.isInteger(parsedYear)) return c.json({ error: "Invalid year" }, 400);
    conditions.push(
      gte(schema.expenses.expenseDate, new Date(`${parsedYear}-01-01T00:00:00Z`)),
      lt(schema.expenses.expenseDate, new Date(`${parsedYear + 1}-01-01T00:00:00Z`)),
    );
  }
  if (category) {
    const parsedCategory = ExpenseCategory.safeParse(category);
    if (!parsedCategory.success) return c.json({ error: "Invalid category" }, 400);
    conditions.push(eq(schema.expenses.category, parsedCategory.data));
  }
  if (status) {
    const parsedStatus = ExpenseStatus.safeParse(status);
    if (!parsedStatus.success) return c.json({ error: "Invalid status" }, 400);
    conditions.push(eq(schema.expenses.status, parsedStatus.data));
  }
  const expenses = await db
    .select()
    .from(schema.expenses)
    .where(and(...conditions))
    .orderBy(desc(schema.expenses.expenseDate));
  return c.json(expenses);
});

/** PATCH /api/expenses/:id — user confirms/corrects OCR → status=confirmed */
expenseRoutes.patch("/:id", async (c) => {
  const parsed = ConfirmExpenseInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const input = parsed.data;
  const [expense] = await db
    .update(schema.expenses)
    .set({
      merchant: input.merchant,
      amountCents: input.amount_cents,
      category: input.category,
      expenseDate: input.expense_date,
      status: "confirmed",
    })
    .where(
      and(
        eq(schema.expenses.id, c.req.param("id")),
        eq(schema.expenses.userId, c.get("userId")),
      ),
    )
    .returning();
  if (!expense) return c.json({ error: "Expense not found" }, 404);
  return c.json(expense);
});

expenseRoutes.delete("/:id", async (c) => {
  const [expense] = await db
    .delete(schema.expenses)
    .where(
      and(
        eq(schema.expenses.id, c.req.param("id")),
        eq(schema.expenses.userId, c.get("userId")),
      ),
    )
    .returning();
  if (!expense) return c.json({ error: "Expense not found" }, 404);
  if (expense.receiptKey) {
    await db
      .delete(schema.receipts)
      .where(
        and(
          eq(sql`${schema.receipts.id}::text`, expense.receiptKey),
          eq(schema.receipts.userId, c.get("userId")),
        ),
      );
  }
  return c.body(null, 204);
});
