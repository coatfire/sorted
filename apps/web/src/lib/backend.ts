import type { ExportFormat, ExportRange, PaymentMethod,
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
  EditPaymentInput,
  CalendarLinks,
  DriveBackup,
  Service,
  MessageSentInput,
  IssuedDocument,
  BusyResult,
  PlaceSearchResult,
  ExternalCalendar,
  ImportBatch,
  ImportClientRow,
  ImportClientsResult,
  ImportHistoryInput,
  ImportHistoryResult,
  UndoImportResult,
  Trip,
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
  /** Business trips that aren't bookings. */
  trips: Trip[];
  /** Issued invoices, receipts and quotes, newest first. */
  documents: IssuedDocument[];
}

export interface BookingDraft {
  status?: "confirmed" | "enquiry";
  /** Existing client, or… */
  clientId?: string;
  /** …a new one created inline. */
  client?: { name: string; phone?: string; email?: string };
  service: string;
  startAt: string | null;
  timeTbc?: boolean;
  followUpOn?: string | null;
  repeat?: { everyWeeks: 1 | 2 | 4; count: number };
  priceCents: number | null;
  depositCents: number;
  location: string | null;
  /** Km for the job, there and back, in metres. */
  travelMetres?: number | null;
  notes: string | null;
}

export interface TripDraft {
  tripDate: string;
  destination: string;
  purpose: string;
  travelMetres: number;
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
  health(): Promise<Health>;
  driveFiles(): Promise<DriveBackup>;
  driveBackedUp(): Promise<{ driveBackedUpAt: string }>;
  googleStart(): void;
  googleExchange(code: string): Promise<{ jwt: string; user: User }>;
  calendar(): Promise<CalendarLinks>;
  resetCalendar(): Promise<CalendarLinks>;
  /** The trader's own Google/Apple calendars that Sorted reads for Busy blocks. */
  externalCalendars(): Promise<ExternalCalendar[]>;
  addExternalCalendar(url: string): Promise<ExternalCalendar>;
  removeExternalCalendar(id: string): Promise<void>;
  /** Read-only entries from those calendars between two days (inclusive). */
  busy(from: string, to: string): Promise<BusyResult>;
  /** Addresses and venues matching what's typed. Only offered when `features.addressSearch` is on. */
  searchPlaces(input: string): Promise<PlaceSearchResult>;
  signup(email: string, password: string): Promise<{ ok: true; dev_link?: string }>;
  login(email: string, password: string): Promise<{ jwt: string; user: User }>;
  verify(token: string): Promise<{ jwt: string; user: User }>;
  forgot(email: string): Promise<{ ok: true; dev_link?: string }>;
  resetPassword(token: string, password: string): Promise<{ jwt: string; user: User }>;
  load(): Promise<Snapshot>;
  createBooking(draft: BookingDraft): Promise<{ id: string; seriesCount: number }>;
  updateBooking(id: string, draft: Omit<BookingDraft, "clientId" | "client" | "status">): Promise<void>;
  confirmBooking(id: string, details?: Partial<Pick<BookingDraft, "startAt" | "timeTbc" | "priceCents">>): Promise<void>;
  completeBooking(id: string): Promise<void>;
  cancelBooking(id: string): Promise<void>;
  followUp(id: string, date: string | null): Promise<void>;
  /** The km for a job, there and back. Works at any stage, since the distance is often added afterwards. */
  bookingTravel(id: string, travelMetres: number | null): Promise<void>;
  createTrip(draft: TripDraft): Promise<void>;
  updateTrip(id: string, draft: TripDraft): Promise<void>;
  deleteTrip(id: string): Promise<void>;
  paymentRequested(id: string): Promise<void>;
  messageSent(id: string, input: MessageSentInput): Promise<void>;
  messages(bookingId: string): Promise<MessageLogEntry[]>;
  document(bookingId: string, kind: DocumentKind, paymentId?: string): Promise<BookingDocument>;
  /** Creates (or returns the existing) payment link URL. */
  paymentLink(paymentId: string): Promise<string>;
  bookingPaymentLink(bookingId: string): Promise<string>;
  markPaid(paymentId: string, method: Exclude<PaymentMethod, "stripe">): Promise<void>;
  recordPayment(bookingId: string, input: RecordPaymentInput): Promise<void>;
  editPayment(paymentId: string, input: EditPaymentInput): Promise<void>;
  undoPayment(paymentId: string): Promise<void>;
  createExpense(draft: ExpenseDraft): Promise<void>;
  updateExpense(id: string, draft: ExpenseDraft): Promise<void>;
  deleteExpense(id: string): Promise<void>;
  /** A URL the browser can render for this expense's receipt photo. */
  receiptUrl(expense: Pick<Expense, "id" | "receiptKey">): Promise<string | null>;
  updateClient(id: string, patch: { name: string; phone: string | null; email: string | null; notes?: string | null }): Promise<void>;
  deleteClient(id: string): Promise<void>;
  createClient(input: ImportClientRow): Promise<{ id: string }>;
  /** Adds the rows that aren't already clients, as one import that can be undone. */
  importClients(fileName: string, rows: ImportClientRow[]): Promise<ImportClientsResult>;
  /** Adds past payments and expenses that aren't already in Sorted, as one import that can be undone. Sends nothing. */
  importHistory(fileName: string, rows: Pick<ImportHistoryInput, "income" | "expenses">): Promise<ImportHistoryResult>;
  imports(): Promise<ImportBatch[]>;
  /** Removes what an import added, except anything used since: a booked client, a payment with a receipt, an expense with a photo. */
  undoImport(id: string): Promise<UndoImportResult>;
  updateUser(patch: Partial<{
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
    revolutLink?: string | null;
    importOfferClosed?: true;
    services?: Service[];
    vatRegistered?: boolean;
    vatRateBp?: number | null;
    vatPeriodMonths?: number;
    incomeTaxRateBp?: number | null;
  }>): Promise<void>;
  /** Income, expenses and the mileage log between two dates, both included. */
  exportFile(range: ExportRange, format: ExportFormat): Promise<Blob>;
}
