import { z } from "zod";
import { RevolutLink } from "./revolut";
import { ServicesInput, type Service } from "./services";
import { CalendarDate } from "./dates";
import { InvoiceLogo, InvoiceAccent, IrishVatNumber } from "./documents";
import { VatRateBp, IncomeTaxRateBp, VatPeriodMonths } from "./tax";
import { normaliseIban, normaliseBic, validIban, validBic } from "./bank";

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

/** "stripe" is a card charged through one of Sorted's payment links. "card" is any other card payment, such as a terminal. */
export const PaymentMethod = z.enum([
  "stripe",
  "revolut",
  "cash",
  "bank_transfer",
  "card",
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
  "document",
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

export function normaliseClientPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const e164 = input.trim().startsWith("+") || digits.startsWith("0") || /^8\d{8}$/.test(digits)
    ? normalisePhone(input) : `+${digits}`;
  return e164 && Phone.safeParse(e164).success ? e164.slice(1) : null;
}

export function formatPhone(input: string | null | undefined): string {
  if (!input) return "";
  const digits = normaliseClientPhone(input);
  if (!digits) return input.trim();
  const irishMobile = /^353(8\d)(\d{3})(\d{4})$/.exec(digits);
  if (irishMobile) return `0${irishMobile[1]} ${irishMobile[2]} ${irishMobile[3]}`;
  return `+${digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;
}

const ClientPhone = z.string().transform(value => normaliseClientPhone(value) ?? "")
  .refine(value => /^\d{7,15}$/.test(value), "Enter a valid mobile number.");

// ─── Request schemas (validate at the edge, trust internally) ─────────────

export const CreateClientInput = z.object({
  name: z.string().min(1).max(200),
  phone: ClientPhone.optional(),
  email: z.string().email().optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateClientInput = z.infer<typeof CreateClientInput>;

export const UpdateClientInput = z.object({
  name: z.string().min(1).max(200).optional(),
  // null clears the field
  phone: ClientPhone.nullable().optional(),
  email: z.string().email().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/** A distance driven for the business, there and back, in metres. 5,000 km is further than any day's work. */
export const TravelMetres = z.number().int().positive().max(5_000_000);

export const RepeatInput = z.object({ every_weeks: z.union([z.literal(1), z.literal(2), z.literal(4)]), count: z.number().int().min(2).max(12) });
export type RepeatInput = z.infer<typeof RepeatInput>;

export const CreateBookingInput = z
  .object({
    // Either an existing client…
    client_id: z.string().uuid().optional(),
    // …or inline creation (the 10-second flow)
    client: CreateClientInput.optional(),
    service: z.string().min(1).max(200),
    status: z.enum(["confirmed", "enquiry"]).default("enquiry"),
    start_at: z.coerce.date().nullable().default(null),
    time_tbc: z.boolean().default(false),
    follow_up_on: CalendarDate.nullable().optional(),
    repeat: RepeatInput.optional(),
    end_at: z.coerce.date().optional(),
    price_cents: z.number().int().nonnegative().nullable().default(null),
    deposit_cents: z.number().int().nonnegative().default(0),
    location: z.string().max(500).optional(),
    /** Km driven for this job, there and back, in metres. */
    travel_metres: TravelMetres.nullable().optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((v) => !!v.client_id !== !!v.client, {
    message: "Provide exactly one of client_id or client",
  })
  .refine((v) => v.price_cents === null ? v.deposit_cents === 0 : v.deposit_cents <= v.price_cents, {
    message: "Deposit cannot exceed price",
  })
  .refine(v => v.status === "enquiry" || (v.start_at !== null && !v.time_tbc && v.price_cents !== null), { message: "A booking needs a date, time and price. You can leave these blank for an enquiry." })
  .refine(v => !v.repeat || v.start_at !== null, { message: "Repeating enquiries need a date." });
export type CreateBookingInput = z.infer<typeof CreateBookingInput>;

export const UpdateBookingInput = z.object({
  follow_up_on: CalendarDate.nullable().optional(),
  service: z.string().min(1).max(200).optional(),
  start_at: z.coerce.date().nullable().optional(),
  time_tbc: z.boolean().optional(),
  end_at: z.coerce.date().nullable().optional(),
  price_cents: z.number().int().nonnegative().nullable().optional(),
  deposit_cents: z.number().int().nonnegative().optional(),
  // null clears the field
  location: z.string().max(500).nullable().optional(),
  travel_metres: TravelMetres.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type UpdateBookingInput = z.infer<typeof UpdateBookingInput>;

export const UpdateUserInput = z.object({
  services: ServicesInput.optional(),
  revolut_link: z.union([z.string().trim().length(0).transform(() => null), RevolutLink]).nullable().optional(),
  /** Stop offering import on Today. It cannot be switched back on; Import stays in Settings. */
  import_offer_closed: z.literal(true).optional(),
  vat_registered: z.boolean().optional(),
  vat_rate_bp: VatRateBp.nullable().optional(),
  vat_period_months: VatPeriodMonths.optional(),
  income_tax_rate_bp: IncomeTaxRateBp.nullable().optional(),
  invoice_logo: InvoiceLogo.nullable().optional(),
  invoice_accent: InvoiceAccent.nullable().optional(),
  invoice_footer: z.string().max(1000).nullable().optional(),
  vat_number: IrishVatNumber.nullable().optional(),
  booking_confirmation_template: z.string().max(4000).nullable().optional(),
  payment_request_template: z.string().max(4000).nullable().optional(),
  name: z.string().max(200).nullable().optional(),
  business_name: z.string().max(200).nullable().optional(),
  phone: Phone.nullable().optional(),
  review_link: z.string().url().max(500).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  iban: z.string().transform(normaliseIban).refine(validIban, "Enter a valid IBAN.").nullable().optional(),
  bic: z.string().transform(normaliseBic).refine(validBic, "Enter a valid BIC.").nullable().optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserInput>;

export const MarkPaidInput = z.object({
  method: PaymentMethod.exclude(["stripe"]), // stripe paid only via webhook
});

/** A receipt photo, downscaled client-side. ~1.5 MB of base64 is plenty. */
/** Raw size limits: photos are downscaled first; PDFs are stored as uploaded. */
export const RECEIPT_PDF_MAX_BYTES = 3_000_000;
export const UploadReceiptInput = z.object({
  content_type: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  data_base64: z
    .string()
    .min(1)
    .max(4_000_000)
    .regex(/^[A-Za-z0-9+/]+=*$/, "Must be base64"),
}).refine((v) => v.content_type === "application/pdf"
  // "%PDF-" in base64
  ? v.data_base64.startsWith("JVBERi0")
  : v.data_base64.length <= 2_000_000, { message: "Unsupported receipt file" });

const expenseFields = {
  merchant: z.string().min(1).max(200),
  amount_cents: z.number().int().positive(),
  category: ExpenseCategory,
  expense_date: z.coerce.date(),
  vat_cents: z.number().int().nonnegative().nullable().optional(),
};

const expenseVatWithinAmount = (value: { vat_cents?: number | null; amount_cents?: number }) =>
  value.vat_cents == null || (value.amount_cents !== undefined && value.vat_cents <= value.amount_cents);
const expenseVatError = { message: "VAT paid cannot exceed the expense amount.", path: ["vat_cents"] };

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
    vat_cents: expenseFields.vat_cents,
  })
  .refine(
    (v) =>
      !v.confirmed ||
      (v.merchant && v.amount_cents && v.category && v.expense_date),
    { message: "A confirmed expense needs merchant, amount, category and date" },
  ).refine(expenseVatWithinAmount, expenseVatError);

export const ConfirmExpenseInput = z.object(expenseFields).refine(expenseVatWithinAmount, expenseVatError);

// ─── Response types ───────────────────────────────────────────────────────
// What the API actually returns: DB rows serialised as JSON (camelCase keys,
// ISO timestamp strings). Request bodies above are snake_case.

export interface User {
  services?: Service[];
  revolutLink?: string | null;
  importOfferClosedAt?: string | null;
  driveBackedUpAt: string | null;
  vatRegistered: boolean;
  vatRateBp: number | null;
  vatPeriodMonths: number;
  incomeTaxRateBp: number | null;
  invoiceLogo: string | null;
  invoiceAccent: string | null;
  invoiceFooter: string | null;
  vatNumber: string | null;
  bookingConfirmationTemplate: string | null;
  paymentRequestTemplate: string | null;
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  address: string | null;
  iban: string | null;
  bic: string | null;
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
  followUpOn: string | null;
  paymentRequestedAt: string | null;
  id: string;
  clientId: string;
  service: string;
  startAt: string | null;
  timeTbc?: boolean;
  endAt: string | null;
  priceCents: number | null;
  depositCents: number;
  status: BookingStatus;
  location: string | null;
  /** Km driven for this job, there and back, in metres. */
  travelMetres?: number | null;
  notes: string | null;
  gcalEventId: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Payment {
  receiptVoidedAt?: string | null;
  vatRateBp: number | null;
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
  vatCents: number | null;
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
  meta?: { userConfirmed?: boolean; kind?: string; acknowledgementId?: string; documentId?: string; documentNumber?: string; reviewIncluded?: boolean } | null;
}

/** GET /api/health — lets the UI be honest about what is wired up. */
export interface Health {
  ok: true;
  googleClientId: string | null;
  features: {
    googleDrive: boolean;
    googleSignIn: boolean;
    /** n8n webhook configured → confirmations/reminders actually send */
    automation: boolean;
    /** Stripe key configured → payment links can be created */
    paymentLinks: boolean;
    /** Google Maps key configured → the Location field can search for addresses */
    addressSearch: boolean;
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
