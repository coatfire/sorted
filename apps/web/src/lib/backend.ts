import type {
  Booking,
  Client,
  Expense,
  ExpenseCategory,
  Health,
  MessageLogEntry,
  Payment,
  User,
  BookingDocument,
  DocumentKind,
  RecordPaymentInput,
  CalendarLinks,
} from "@sorted/core";

export type BookingRow = Booking & { client: Client };

/** Everything the app shows. Small enough per trader to load in one go. */
export interface Snapshot {
  user: User;
  features: Health["features"];
  clients: Client[];
  bookings: BookingRow[];
  payments: Payment[];
  expenses: Expense[];
}

export interface BookingDraft {
  /** Existing client, or… */
  clientId?: string;
  /** …a new one created inline. */
  client?: { name: string; phone?: string; email?: string };
  service: string;
  startAt: string;
  followUpOn?: string | null;
  repeat?: { everyWeeks: 1 | 2 | 4; count: number };
  priceCents: number;
  depositCents: number;
  location: string | null;
  notes: string | null;
}

export interface ExpenseDraft {
  vatCents: number | null;
  merchant: string;
  amountCents: number;
  category: ExpenseCategory;
  expenseDate: string;
  /** New receipt photo (already downscaled). Only on create. */
  receipt?: Blob;
}

/**
 * The seam between the UI and where data lives. Two implementations:
 * `apiBackend` (the real API) and `demoBackend` (localStorage, for the
 * try-before-you-sign-up demo). Pages never know which one they have.
 */
export interface Backend {
  calendar(): Promise<CalendarLinks>;
  resetCalendar(): Promise<CalendarLinks>;
  signup(email: string, password: string): Promise<{ ok: true; dev_link?: string }>;
  login(email: string, password: string): Promise<{ jwt: string; user: User }>;
  verify(token: string): Promise<{ jwt: string; user: User }>;
  forgot(email: string): Promise<{ ok: true; dev_link?: string }>;
  resetPassword(token: string, password: string): Promise<{ jwt: string; user: User }>;
  load(): Promise<Snapshot>;
  createBooking(draft: BookingDraft): Promise<{ id: string; seriesCount: number }>;
  updateBooking(id: string, draft: Omit<BookingDraft, "clientId" | "client">): Promise<void>;
  confirmBooking(id: string): Promise<void>;
  completeBooking(id: string): Promise<void>;
  cancelBooking(id: string): Promise<void>;
  followUp(id: string, date: string | null): Promise<void>;
  paymentRequested(id: string): Promise<void>;
  messages(bookingId: string): Promise<MessageLogEntry[]>;
  document(bookingId: string, kind: DocumentKind, paymentId?: string): Promise<BookingDocument>;
  /** Creates (or returns the existing) payment link URL. */
  paymentLink(paymentId: string): Promise<string>;
  markPaid(paymentId: string, method: "cash" | "bank_transfer"): Promise<void>;
  recordPayment(bookingId: string, input: RecordPaymentInput): Promise<void>;
  createExpense(draft: ExpenseDraft): Promise<void>;
  updateExpense(id: string, draft: ExpenseDraft): Promise<void>;
  deleteExpense(id: string): Promise<void>;
  /** A URL the browser can render for this expense's receipt photo. */
  receiptUrl(expense: Expense): Promise<string | null>;
  updateClient(id: string, patch: { name: string; phone: string | null; email: string | null }): Promise<void>;
  deleteClient(id: string): Promise<void>;
  updateUser(patch: {
    name: string | null;
    businessName: string | null;
    phone: string | null;
    reviewLink: string | null;
    address: string | null;
    iban: string | null;
    bic: string | null;
    bookingConfirmationTemplate?: string | null;
    paymentRequestTemplate?: string | null;
    invoiceLogo?: string | null;
    invoiceAccent?: string | null;
    invoiceFooter?: string | null;
    vatNumber?: string | null;
    vatRegistered?: boolean;
    vatRateBp?: number | null;
    vatPeriodMonths?: number;
    incomeTaxRateBp?: number | null;
  }): Promise<void>;
  exportCsv(year: number): Promise<Blob>;
}
