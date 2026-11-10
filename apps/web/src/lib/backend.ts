import type {
  Booking,
  Client,
  Expense,
  ExpenseCategory,
  Health,
  MessageLogEntry,
  Payment,
  User,
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
  client?: { name: string; phone?: string };
  service: string;
  startAt: string;
  priceCents: number;
  depositCents: number;
  location: string | null;
  notes: string | null;
}

export interface ExpenseDraft {
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
  load(): Promise<Snapshot>;
  createBooking(draft: BookingDraft): Promise<{ id: string }>;
  updateBooking(id: string, draft: Omit<BookingDraft, "clientId" | "client">): Promise<void>;
  confirmBooking(id: string): Promise<void>;
  completeBooking(id: string): Promise<void>;
  cancelBooking(id: string): Promise<void>;
  messages(bookingId: string): Promise<MessageLogEntry[]>;
  /** Creates (or returns the existing) payment link URL. */
  paymentLink(paymentId: string): Promise<string>;
  markPaid(paymentId: string, method: "cash" | "bank_transfer"): Promise<void>;
  createExpense(draft: ExpenseDraft): Promise<void>;
  updateExpense(id: string, draft: ExpenseDraft): Promise<void>;
  deleteExpense(id: string): Promise<void>;
  /** A URL the browser can render for this expense's receipt photo. */
  receiptUrl(expense: Expense): Promise<string | null>;
  updateClient(id: string, patch: { name: string; phone: string | null }): Promise<void>;
  updateUser(patch: {
    name: string | null;
    businessName: string | null;
    phone: string | null;
    reviewLink: string | null;
  }): Promise<void>;
  exportCsv(year: number): Promise<Blob>;
}
