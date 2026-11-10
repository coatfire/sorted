import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  pgEnum,
} from "drizzle-orm/pg-core";

// Enums mirror packages/core/src/types.ts — keep in sync.
export const bookingStatus = pgEnum("booking_status", [
  "enquiry",
  "confirmed",
  "completed",
  "cancelled",
]);
export const paymentKind = pgEnum("payment_kind", [
  "deposit",
  "balance",
  "full",
  "custom",
]);
export const paymentMethod = pgEnum("payment_method", [
  "stripe",
  "revolut",
  "cash",
  "bank_transfer",
]);
export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "paid",
  "cancelled",
]);
export const expenseCategory = pgEnum("expense_category", [
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
export const expenseStatus = pgEnum("expense_status", [
  "needs_review",
  "confirmed",
]);
export const messageTemplate = pgEnum("message_template", [
  "confirmation",
  "reminder",
  "payment_request",
  "review_request",
]);
export const messageStatus = pgEnum("message_status", [
  "sent",
  "delivered",
  "failed",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  businessName: text("business_name"),
  phone: text("phone"), // E.164
  reviewLink: text("review_link"), // Google review URL (M7)
  currency: text("currency").notNull().default("EUR"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    phone: text("phone"), // E.164; null = no WhatsApp automation
    email: text("email"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("clients_user_idx").on(t.userId)],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    service: text("service").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }),
    priceCents: integer("price_cents").notNull(),
    depositCents: integer("deposit_cents").notNull().default(0),
    status: bookingStatus("status").notNull().default("enquiry"),
    location: text("location"),
    notes: text("notes"),
    gcalEventId: text("gcal_event_id"),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    reviewRequestedAt: timestamp("review_requested_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("bookings_user_start_idx").on(t.userId, t.startAt)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    kind: paymentKind("kind").notNull(),
    amountCents: integer("amount_cents").notNull(),
    method: paymentMethod("method"),
    status: paymentStatus("status").notNull().default("pending"),
    stripePaymentLinkId: text("stripe_payment_link_id"),
    linkUrl: text("link_url"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("payments_user_status_idx").on(t.userId, t.status)],
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    merchant: text("merchant"),
    amountCents: integer("amount_cents"),
    category: expenseCategory("category"),
    expenseDate: timestamp("expense_date", { withTimezone: true }),
    receiptKey: text("receipt_key"), // receipts.id today; S3 object key later
    ocrRaw: jsonb("ocr_raw"), // full OCR response for audit/debug
    status: expenseStatus("status").notNull().default("needs_review"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("expenses_user_date_idx").on(t.userId, t.expenseDate)],
);

/**
 * Receipt photos. MVP stores the (client-downscaled) image in Postgres so
 * there is no bucket to provision; swap for S3 when volume justifies it —
 * expenses.receipt_key is the only pointer.
 */
export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    contentType: text("content_type").notNull(),
    dataBase64: text("data_base64").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("receipts_user_idx").on(t.userId)],
);

export const messageLog = pgTable(
  "message_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    bookingId: uuid("booking_id").references(() => bookings.id),
    clientId: uuid("client_id").references(() => clients.id),
    channel: text("channel").notNull().default("whatsapp"),
    template: messageTemplate("template").notNull(),
    status: messageStatus("status").notNull().default("sent"),
    meta: jsonb("meta"), // provider message id, error details, etc.
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("message_log_booking_idx").on(t.bookingId)],
);
