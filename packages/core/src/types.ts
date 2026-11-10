import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────

export const BookingStatus = z.enum([
  "enquiry",
  "confirmed",
  "completed",
  "cancelled",
]);
export type BookingStatus = z.infer<typeof BookingStatus>;

export const PaymentKind = z.enum(["deposit", "balance", "full", "custom"]);
export type PaymentKind = z.infer<typeof PaymentKind>;

export const PaymentMethod = z.enum([
  "stripe",
  "revolut",
  "cash",
  "bank_transfer",
]);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

export const PaymentStatus = z.enum(["pending", "paid", "cancelled"]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

export const ExpenseCategory = z.enum([
  "materials",
  "travel",
  "equipment",
  "software",
  "phone_internet",
  "insurance",
  "training",
  "marketing",
  "other",
]);
export type ExpenseCategory = z.infer<typeof ExpenseCategory>;

export const ExpenseStatus = z.enum(["needs_review", "confirmed"]);
export type ExpenseStatus = z.infer<typeof ExpenseStatus>;

export const MessageTemplate = z.enum([
  "confirmation",
  "reminder",
  "payment_request",
  "review_request",
]);
export type MessageTemplate = z.infer<typeof MessageTemplate>;

// E.164, e.g. +353871234567
export const Phone = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164, e.g. +353871234567");

/**
 * Turn what a person types ("087 123 4567", "00353 87…", "+44 7700 900123")
 * into E.164. Bare national numbers are assumed Irish — the beta market.
 * Returns null if the result isn't a plausible E.164 number.
 */
export function normalisePhone(input: string, defaultCountry = "353"): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  let e164: string;
  if (raw.startsWith("+")) e164 = `+${digits}`;
  else if (digits.startsWith("00")) e164 = `+${digits.slice(2)}`;
  else if (digits.startsWith(defaultCountry) && digits.length > 10) e164 = `+${digits}`;
  else e164 = `+${defaultCountry}${digits.replace(/^0/, "")}`;
  return Phone.safeParse(e164).success ? e164 : null;
}

// ─── Request schemas (validate at the edge, trust internally) ─────────────

export const CreateClientInput = z.object({
  name: z.string().min(1).max(200),
  phone: Phone.optional(),
  email: z.string().email().optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateClientInput = z.infer<typeof CreateClientInput>;

export const UpdateClientInput = z.object({
  name: z.string().min(1).max(200).optional(),
  // null clears the field
  phone: Phone.nullable().optional(),
  email: z.string().email().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const CreateBookingInput = z
  .object({
    // Either an existing client…
    client_id: z.string().uuid().optional(),
    // …or inline creation (the 10-second flow)
    client: CreateClientInput.optional(),
    service: z.string().min(1).max(200),
    start_at: z.coerce.date(),
    end_at: z.coerce.date().optional(),
    price_cents: z.number().int().nonnegative(),
    deposit_cents: z.number().int().nonnegative().default(0),
    location: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => !!v.client_id !== !!v.client, {
    message: "Provide exactly one of client_id or client",
  })
  .refine((v) => v.deposit_cents <= v.price_cents, {
    message: "Deposit cannot exceed price",
  });
export type CreateBookingInput = z.infer<typeof CreateBookingInput>;

export const UpdateBookingInput = z.object({
  service: z.string().min(1).max(200).optional(),
  start_at: z.coerce.date().optional(),
  end_at: z.coerce.date().nullable().optional(),
  price_cents: z.number().int().nonnegative().optional(),
  deposit_cents: z.number().int().nonnegative().optional(),
  // null clears the field
  location: z.string().max(500).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type UpdateBookingInput = z.infer<typeof UpdateBookingInput>;

export const UpdateUserInput = z.object({
  name: z.string().max(200).nullable().optional(),
  business_name: z.string().max(200).nullable().optional(),
  phone: Phone.nullable().optional(),
  review_link: z.string().url().max(500).nullable().optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserInput>;

export const MarkPaidInput = z.object({
  method: PaymentMethod.exclude(["stripe"]), // stripe paid only via webhook
});

/** A receipt photo, downscaled client-side. ~1.5 MB of base64 is plenty. */
export const UploadReceiptInput = z.object({
  content_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  data_base64: z
    .string()
    .min(1)
    .max(2_000_000)
    .regex(/^[A-Za-z0-9+/]+=*$/, "Must be base64"),
});

const expenseFields = {
  merchant: z.string().min(1).max(200),
  amount_cents: z.number().int().positive(),
  category: ExpenseCategory,
  expense_date: z.coerce.date(),
};

/**
 * Create an expense. With `confirmed: true` (the person typed/checked every
 * field themselves) all four fields are required and it becomes a tax record
 * immediately. Otherwise it lands in `needs_review` — that is where OCR
 * suggestions go, and they must never confirm themselves.
 */
export const CreateExpenseInput = z
  .object({
    receipt_key: z.string().max(200).optional(),
    merchant: expenseFields.merchant.optional(),
    amount_cents: expenseFields.amount_cents.optional(),
    category: expenseFields.category.optional(),
    expense_date: expenseFields.expense_date.optional(),
    confirmed: z.boolean().default(false),
  })
  .refine(
    (v) =>
      !v.confirmed ||
      (v.merchant && v.amount_cents && v.category && v.expense_date),
    { message: "A confirmed expense needs merchant, amount, category and date" },
  );

export const ConfirmExpenseInput = z.object(expenseFields);

// ─── Response types ───────────────────────────────────────────────────────
// What the API actually returns: DB rows serialised as JSON (camelCase keys,
// ISO timestamp strings). Request bodies above are snake_case.

export interface User {
  id: string;
  email: string;
  name: string | null;
  businessName: string | null;
  phone: string | null;
  reviewLink: string | null;
  currency: string;
  createdAt: string;
}

export interface Client {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
}

export interface Booking {
  id: string;
  clientId: string;
  service: string;
  startAt: string;
  endAt: string | null;
  priceCents: number;
  depositCents: number;
  status: BookingStatus;
  location: string | null;
  notes: string | null;
  gcalEventId: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Payment {
  id: string;
  bookingId: string;
  kind: PaymentKind;
  amountCents: number;
  method: PaymentMethod | null;
  status: PaymentStatus;
  linkUrl: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface Expense {
  id: string;
  merchant: string | null;
  amountCents: number | null;
  category: ExpenseCategory | null;
  expenseDate: string | null;
  receiptKey: string | null;
  status: ExpenseStatus;
  createdAt: string;
}

export interface MessageLogEntry {
  id: string;
  bookingId: string | null;
  template: MessageTemplate;
  status: "sent" | "delivered" | "failed";
  sentAt: string;
}

/** GET /api/health — lets the UI be honest about what is wired up. */
export interface Health {
  ok: true;
  features: {
    /** n8n webhook configured → confirmations/reminders actually send */
    automation: boolean;
    /** Stripe key configured → payment links can be created */
    paymentLinks: boolean;
  };
}

export interface ReportSummary {
  year: number;
  income_cents: number;
  expenses_cents: number;
  profit_cents: number;
  by_month: Array<{
    month: number; // 1–12
    income_cents: number;
    expenses_cents: number;
  }>;
  expenses_by_category: Array<{
    category: ExpenseCategory;
    total_cents: number;
  }>;
}
