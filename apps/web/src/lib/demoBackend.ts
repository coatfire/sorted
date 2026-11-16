/**
 * The demo: the same app, backed by localStorage and a believable seeded
 * business. It mirrors the API's rules (state machine, payment rows) so what
 * someone tries here is what they get after signing up. "Messages" and
 * payment links are simulated — nothing leaves the browser.
 */
import type { Client, Expense, MessageLogEntry, Payment, BookingDocument } from "@sorted/core";
import { snapshotReceipt, snapshotDocument, documentNumber, TaxSettings, ConfirmExpenseInput, RecordPaymentInput, EditPaymentInput, paymentPaidAt, irelandToday, addCalendarDays, CalendarDate, shiftDublinWeeks, RepeatInput, Services, bookingStage, CreateClientInput, UpdateClientInput, MessageSentInput, CreateBookingInput, agreedBookingStart, missingBookingDetails } from "@sorted/core";
import type { Backend, BookingRow, Snapshot } from "./backend";
import { blobToDataUrl } from "./image";
import { settingsAutosaveRegistry } from "./settingsAutosaveSession";

const KEY = "sorted_demo_v3";

interface DemoData extends Omit<Snapshot, "documents"> {
  documents: BookingDocument[];
  messages: MessageLogEntry[];
  receipts: Record<string, string>; // expense id → data URL
}

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function at(daysFromNow: number, hour: number, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

function seed(): DemoData {
  const client = (name: string, phone: string | null): Client => ({
    id: id(), name, phone, email: null, notes: null, createdAt: at(-60, 9),
  });
  const sarah = client("Sarah Keane", "+353871234567");
  const aoife = client("Aoife O'Brien", "+353861112222");
  const emma = client("Emma Lynch", "+353852223333");
  const ryan = client("Ryan / Walsh wedding", "+353874445555");
  const niamh = client("Niamh Byrne", "+353899998888");
  const laura = client("Laura Murphy", null);

  const booking = (
    c: Client, service: string, startAt: string, priceCents: number, depositCents: number,
    status: BookingRow["status"], extra: Partial<BookingRow> = {},
  ): BookingRow => ({
    id: id(), clientId: c.id, client: c, service, startAt, endAt: null, priceCents,
    depositCents, status, location: null, notes: null, gcalEventId: null,
    followUpOn: status === "enquiry" ? addCalendarDays(irelandToday(), -2) : null, paymentRequestedAt: null,
    completedAt: status === "completed" ? startAt : null, createdAt: at(-45, 9), ...extra,
  });
  const b = {
    sarah: booking(sarah, "Bridal trial", at(0, 10), 8000, 2000, "confirmed", {
      location: "Studio", notes: "Soft, natural look. Bring veil options.",
    }),
    aoife: booking(aoife, "Wedding hair", at(0, 14, 30), 35000, 5000, "confirmed", {
      location: "The K Club, Kildare",
    }),
    emma: booking(emma, "Makeup", at(2, 11), 12000, 0, "enquiry"),
    ryan: booking(ryan, "Wedding party", at(4, 8, 30), 40000, 10000, "confirmed", {
      location: "Ballymagarvey Village",
    }),
    late: booking(emma, "Debs makeup", at(-1, 16), 6500, 0, "confirmed"),
    niamh: booking(niamh, "Bridal makeup", at(-4, 9), 22000, 4000, "completed"),
    laura: booking(laura, "Editorial makeup", at(-13, 12), 18000, 0, "completed"),
    autumn: booking(sarah, "Wedding makeup", at(38, 9), 28000, 5000, "confirmed", {
      location: "Tankardstown House",
    }),
  };

  const payment = (
    bk: BookingRow, kind: Payment["kind"], amountCents: number,
    paid?: { method: Payment["method"]; at: string },
  ): Payment => ({
    vatRateBp: paid ? 0 : null,
    id: id(), bookingId: bk.id, kind, amountCents, method: paid?.method ?? null,
    status: paid ? "paid" : "pending", linkUrl: null, paidAt: paid?.at ?? null,
    createdAt: paid?.at ?? bk.startAt ?? now(),
  });
  const earlier = (monthsAgo: number, day: number) => {
    const date = new Date();
    date.setMonth(date.getMonth() - monthsAgo, day);
    date.setHours(12, 0, 0, 0);
    return date.toISOString();
  };
  // A few months of history so the year view has a shape.
  const history = [
    [5, 12, 46000], [4, 8, 31000], [4, 22, 52000], [3, 5, 68000], [3, 19, 44000],
    [2, 9, 72000], [2, 26, 39000], [1, 7, 58000], [1, 21, 61000],
  ].map(([monthsAgo, day, cents]) => {
    const when = earlier(monthsAgo, day);
    const past = booking(niamh, "Wedding makeup", when, cents, 0, "completed");
    return { past, pay: payment(past, "full", cents, { method: "stripe", at: when }) };
  });

  const expense = (
    merchant: string, amountCents: number, category: Expense["category"], date: string,
    receipt = false,
  ): Expense => ({
    id: id(), merchant, amountCents, category, expenseDate: date, vatCents: null,
    receiptKey: receipt ? "demo" : null, status: "confirmed", createdAt: date,
  });
  const message = (
    bk: BookingRow, template: MessageLogEntry["template"], sentAt: string,
  ): MessageLogEntry => ({ id: id(), bookingId: bk.id, template, status: "sent", sentAt });

  return {
    user: {
      driveBackedUpAt: null,
      id: "demo", email: "demo@sorted.app", name: "Shane", businessName: "Studio by Shane",
      phone: "+353871234567", reviewLink: "https://g.page/r/example/review",
      currency: "EUR", createdAt: at(-200, 9),
      emailVerifiedAt: at(-200, 9), address: null, iban: null, bic: null, revolutLink: null, services: [],
      bookingConfirmationTemplate: null, paymentRequestTemplate: null,
      invoiceLogo: null, invoiceAccent: null, invoiceFooter: null, vatNumber: null,
      vatRegistered: false, vatRateBp: null, vatPeriodMonths: 2, incomeTaxRateBp: null,
    },
    features: { automation: true, paymentLinks: true, googleSignIn: false, googleDrive: false },
    clients: [sarah, aoife, emma, ryan, niamh, laura],
    bookings: [...Object.values(b), ...history.map((h) => h.past)],
    payments: [
      payment(b.sarah, "deposit", 2000, { method: "bank_transfer", at: at(-4, 12) }),
      payment(b.aoife, "deposit", 5000, { method: "stripe", at: at(-18, 10) }),
      payment(b.ryan, "deposit", 10000, { method: "stripe", at: at(-35, 16) }),
      payment(b.autumn, "deposit", 5000),
      payment(b.niamh, "deposit", 4000, { method: "stripe", at: at(-28, 14) }),
      payment(b.niamh, "balance", 18000),
      payment(b.laura, "full", 18000),
      ...history.map((h) => h.pay),
    ],
    expenses: [
      expense("Brown Thomas", 8640, "materials", at(-2, 12)),
      expense("Adobe", 2460, "software", at(-6, 12)),
      expense("Circle K", 6820, "travel", earlier(1, 24)),
      expense("MAC Cosmetics", 13290, "materials", earlier(1, 16)),
      expense("Three Ireland", 3500, "phone_internet", earlier(2, 3)),
      expense("Hiscox", 21000, "insurance", earlier(3, 11)),
    ],
    messages: [
      message(b.sarah, "confirmation", at(-5, 14, 2)),
      message(b.sarah, "reminder", at(-1, 10)),
      message(b.aoife, "confirmation", at(-21, 9, 15)),
      message(b.ryan, "confirmation", at(-42, 16, 40)),
      message(b.niamh, "confirmation", at(-38, 10, 20)),
      message(b.niamh, "payment_request", at(-4, 13, 5)),
    ],
    receipts: {},
    documents: [],
  };
}

function read(): DemoData {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const data = JSON.parse(saved) as DemoData;
      data.user = { ...data.user, ...TaxSettings.parse(data.user) };
      data.expenses = data.expenses.map((expense) => ({ ...expense, vatCents: expense.vatCents ?? null }));
      data.payments = data.payments.map((payment) => ({ ...payment, vatRateBp: payment.vatRateBp ?? null }));
      return data;
    }
  } catch {
    /* corrupt or unavailable storage — fall through to a fresh seed */
  }
  return write(seed());
}

function write(data: DemoData): DemoData {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* quota (receipt photos) — the demo still works for this session */
  }
  return data;
}

let cache: DemoData | null = null;
const data = () => (cache ??= read());
const save = () => void write(data());

export function resetDemo() {
  cache = write(seed());
}

function mustFind<T extends { id: string }>(list: T[], itemId: string, what: string): T {
  const item = list.find((entry) => entry.id === itemId);
  if (!item) throw new Error(`${what} not found`);
  return item;
}

const paidFor = (bookingId: string) =>
  data().payments
    .filter((p) => p.bookingId === bookingId && p.status === "paid")
    .reduce((sum, p) => sum + p.amountCents, 0);

const voidPending = (bookingId: string) => {
  for (const p of data().payments) {
    if (p.bookingId === bookingId && p.status === "pending") p.status = "cancelled";
  }
};

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

function validateDetails(booking: Pick<BookingRow, "startAt" | "timeTbc" | "priceCents" | "depositCents" | "status">) {
  const missing = missingBookingDetails(booking);
  if ((booking.status === "confirmed" || booking.status === "completed") && missing.length) throw new Error(`Add ${missing.join(", ")} before saving this booking.`);
  if (booking.depositCents > (booking.priceCents ?? 0)) throw new Error("Deposit cannot exceed price");
}

function pricedBooking(bookingId: string) {
  const booking = mustFind(data().bookings, bookingId, "Booking");
  if (booking.priceCents === null) throw new Error("Add a price first");
  return { ...booking, priceCents: booking.priceCents };
}

export const demoBackend: Backend = {
  async health() { return { ok: true, googleClientId: null, features: { automation: true, paymentLinks: true, googleSignIn: false, googleDrive: false } }; },
  async driveFiles() { throw new Error("Available when you sign in"); },
  async driveBackedUp() { throw new Error("Available when you sign in"); },
  googleStart() { throw new Error("Available when you sign in"); },
  async googleExchange() { throw new Error("Available when you sign in"); },
  async calendar() { throw new Error("Available when you sign in"); },
  async resetCalendar() { throw new Error("Available when you sign in"); },
  async document(bookingId, kind, paymentId) {
    const d = data();
    const booking = mustFind(d.bookings, bookingId, "Booking");
    if (kind === "quote" && booking.status !== "enquiry") throw new Error("Quotes are only available for enquiries.");
    const documents = d.documents ??= [];
    const existing = documents.find((document) => document.bookingId === bookingId && document.kind === kind && (kind !== "receipt" || document.paymentId === paymentId));
    if (existing) return structuredClone(existing);
    pricedBooking(bookingId);
    if (kind === "receipt" && !d.payments.some((payment) => payment.id === paymentId && payment.bookingId === bookingId && payment.status === "paid")) throw new Error("Choose a paid payment for this receipt.");
    const issuedAt = now();
    const document: BookingDocument = {
      id: id(), bookingId, kind, issuedAt,
      vatRateBp: kind !== "receipt" ? d.user.vatRegistered ? d.user.vatRateBp : 0 : null,
      paymentId: kind === "receipt" ? paymentId! : null,
      receiptSnapshot: kind === "receipt" ? snapshotReceipt(booking, d.payments, paymentId!, issuedAt, d.user) : null,
      number: Math.max(0, ...documents.filter((item) => item.kind === kind).map((item) => item.number)) + 1,
    };
    document.documentSnapshot = snapshotDocument(d.user, booking, mustFind(d.clients, booking.clientId, "Client"), d.payments, document);
    documents.push(document);
    save();
    return structuredClone(document);
  },
  signup: async () => ({ ok: true, dev_link: "/verify?token=demo" }),
  login: async () => ({ jwt: "demo", user: data().user }),
  verify: async () => ({ jwt: "demo", user: data().user }),
  forgot: async () => ({ ok: true, dev_link: "/reset?token=demo" }),
  resetPassword: async () => ({ jwt: "demo", user: data().user }),
  async load() {
    const { messages: _m, receipts: _r, documents: _d, ...snapshot } = data();
    snapshot.bookings.forEach((booking) => { booking.followUpOn ??= null; booking.paymentRequestedAt ??= null; });
    const sentAt = (documentId: string) => data().messages.filter(message => message.meta?.documentId === documentId).map(message => message.sentAt).sort().at(-1) ?? null;
    const documents = (data().documents ?? []).map(({ id, bookingId, kind, number, issuedAt, paymentId, voidedAt }) => ({ id, bookingId, kind, number, issuedAt, paymentId, voidedAt: voidedAt ?? null, sentAt: sentAt(id) }))
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
    return structuredClone({ ...snapshot, documents, payments: snapshot.payments.map(payment => ({ ...payment, receiptVoidedAt: data().documents.find(document => document.kind === "receipt" && document.paymentId === payment.id)?.voidedAt ?? null })) });
  },

  async createBooking(draft) {
    if (draft.followUpOn != null) CalendarDate.parse(draft.followUpOn);
    const repeat = draft.repeat ? RepeatInput.parse({ every_weeks: draft.repeat.everyWeeks, count: draft.repeat.count }) : null;
    CreateBookingInput.parse({ client_id: draft.clientId, client: draft.client, service: draft.service, status: draft.status, start_at: draft.startAt, time_tbc: draft.timeTbc, price_cents: draft.priceCents, deposit_cents: draft.depositCents, repeat: repeat ?? undefined });
    const start = agreedBookingStart(draft.startAt ? new Date(draft.startAt) : null, draft.timeTbc ?? false);
    const dates = Array.from({ length: repeat?.count ?? 1 }, (_, index) => start ? shiftDublinWeeks(start, index * (repeat?.every_weeks ?? 1)).toISOString() : null);
    const d = data();
    let client: Client;
    if (draft.clientId) client = mustFind(d.clients, draft.clientId, "Client");
    else {
      const fields = CreateClientInput.parse(draft.client);
      client = {
        id: id(), name: fields.name, phone: fields.phone ?? null,
        email: fields.email ?? null, notes: null, createdAt: now(),
      };
      d.clients.unshift(client);
    }
    const bookings: BookingRow[] = dates.map((startAt, index) => ({
      id: id(), clientId: client.id, client, service: draft.service, startAt,
      timeTbc: Boolean(startAt && draft.timeTbc),
      endAt: null, priceCents: draft.priceCents, depositCents: draft.depositCents,
      status: draft.status ?? "enquiry", location: draft.location, notes: draft.notes, gcalEventId: null,
      completedAt: null, createdAt: now(),
      followUpOn: draft.status !== "confirmed" && index === 0 ? draft.followUpOn === undefined ? addCalendarDays(irelandToday(), 2) : draft.followUpOn : null, paymentRequestedAt: null,
    }));
    d.bookings.push(...bookings);
    if (draft.status === "confirmed" && draft.depositCents > 0) {
      d.payments.push(...bookings.map(booking => ({
        id: id(), bookingId: booking.id, kind: "deposit" as const, amountCents: booking.depositCents,
        method: null, status: "pending" as const, linkUrl: null, paidAt: null, createdAt: now(), vatRateBp: null,
      })));
    }
    save();
    return { id: bookings[0].id, seriesCount: bookings.length };
  },

  async updateBooking(bookingId, draft) {
    if (draft.followUpOn != null) CalendarDate.parse(draft.followUpOn);
    const booking = mustFind(data().bookings, bookingId, "Booking");
    if (booking.status === "completed" || booking.status === "cancelled") throw new Error(`A ${booking.status} booking can't be edited`);
    if (draft.followUpOn != null && booking.status !== "enquiry") throw new Error("Only enquiries can have a follow-up date");
    if (booking.timeTbc && draft.timeTbc === false && draft.startAt === undefined) throw new Error("Add a time");
    const next = { ...booking, ...draft };
    const start = agreedBookingStart(next.startAt ? new Date(next.startAt) : null, next.timeTbc ?? false);
    next.startAt = start?.toISOString() ?? null;
    next.timeTbc = Boolean(start && next.timeTbc);
    validateDetails(next);
    if (draft.priceCents !== undefined && draft.priceCents !== booking.priceCents) {
      const owedCents = (draft.priceCents ?? 0) - paidFor(bookingId);
      if (owedCents < 0) throw new Error("The price can't be less than the amount already paid.");
      const pending = data().payments.filter(payment => payment.bookingId === bookingId && payment.status === "pending");
      if (!(pending.length === 1 && pending[0].amountCents === owedCents)) voidPending(bookingId);
    }
    Object.assign(booking, next);
    save();
  },

  async confirmBooking(bookingId, details) {
    const d = data();
    const booking = mustFind(d.bookings, bookingId, "Booking");
    if (booking.timeTbc && details?.timeTbc === false && details.startAt === undefined) throw new Error("Add a time");
    const next = { ...booking, ...details, status: "confirmed" as const };
    validateDetails(next);
    if (booking.status !== "enquiry") throw new Error("Only enquiries can be confirmed");
    Object.assign(booking, next, { timeTbc: false });
    booking.followUpOn = null;
    if (booking.depositCents > 0) {
      d.payments.push({
        id: id(), bookingId, kind: "deposit", amountCents: booking.depositCents,
        method: null, status: "pending", linkUrl: null, paidAt: null, createdAt: now(), vatRateBp: null,
      });
    }
    save();
  },

  async completeBooking(bookingId) {
    const d = data();
    const booking = mustFind(d.bookings, bookingId, "Booking");
    validateDetails({ ...booking, status: "completed" });
    if (booking.status !== "confirmed") throw new Error("Only confirmed bookings can be completed");
    const paid = paidFor(bookingId);
    voidPending(bookingId);
    const remainder = bookingStage(booking, d.payments).owedCents;
    if (remainder > 0) {
      d.payments.push({
        id: id(), bookingId, kind: paid > 0 ? "balance" : "full", amountCents: remainder,
        method: null, status: "pending", linkUrl: null, paidAt: null, createdAt: now(), vatRateBp: null,
      });
    }
    booking.status = "completed";
    booking.completedAt = now();
    save();
  },

  async cancelBooking(bookingId) {
    mustFind(data().bookings, bookingId, "Booking").status = "cancelled";
    mustFind(data().bookings, bookingId, "Booking").followUpOn = null;
    voidPending(bookingId);
    save();
  },

  async messages(bookingId) {
    return data()
      .messages.filter((m) => m.bookingId === bookingId)
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  },

  async followUp(bookingId, date) {
    const booking = mustFind(data().bookings, bookingId, "Booking");
    if (booking.status !== "enquiry") throw new Error("Only enquiries can have a follow-up date");
    booking.followUpOn = date === null ? null : CalendarDate.parse(date);
    save();
  },

  async paymentRequested(bookingId) {
    pricedBooking(bookingId);
    mustFind(data().bookings, bookingId, "Booking").paymentRequestedAt = now();
    save();
  },

  async messageSent(bookingId, value) {
    const input = MessageSentInput.parse(value);
    const booking = mustFind(data().bookings, bookingId, "Booking");
    if (data().messages.some(message => message.bookingId === bookingId && message.meta?.acknowledgementId === input.acknowledgement_id)) return;
    if (input.kind === "follow_up" && booking.status !== "enquiry") throw new Error("Only enquiries can have a follow-up.");
    const document = input.kind === "document" ? data().documents.find(item => item.id === input.document_id && item.bookingId === bookingId && !item.voidedAt) : undefined;
    if (input.kind === "document" && !document) throw new Error("Document not found");
    const sentAt = now();
    if (input.kind === "follow_up") booking.followUpOn = addCalendarDays(irelandToday(new Date(sentAt)), 3);
    if (input.kind === "payment_request") booking.paymentRequestedAt = sentAt;
    data().messages.push({ id: id(), bookingId, template: input.kind === "follow_up" ? "reminder" : input.kind,
      status: "sent", sentAt, meta: { userConfirmed: true, kind: input.kind, acknowledgementId: input.acknowledgement_id,
        ...(document ? { documentId: document.id, documentNumber: documentNumber(document.kind, document.number), reviewIncluded: input.review_included === true } : {}) } });
    save();
  },

  async paymentLink(paymentId) {
    const payment = mustFind(data().payments, paymentId, "Payment");
    pricedBooking(payment.bookingId);
    if (!payment.linkUrl) {
      payment.linkUrl = `https://pay.sorted.example/demo-${payment.id.slice(0, 8)}`;
      payment.method = "stripe";
      const booking = mustFind(data().bookings, payment.bookingId, "Booking");
      save();
    }
    return payment.linkUrl;
  },

  async bookingPaymentLink(bookingId) {
    pricedBooking(bookingId);
    const d = data(), booking = mustFind(d.bookings, bookingId, "Booking");
    if (booking.status !== "confirmed" && booking.status !== "completed") throw new Error("This booking cannot take payments.");
    const { owedCents } = bookingStage(booking, d.payments);
    if (!owedCents) throw new Error("This booking is already paid in full.");
    const pending = d.payments.filter(payment => payment.bookingId === bookingId && payment.status === "pending");
    let payment = pending.length === 1 && pending[0].amountCents === owedCents ? pending[0] : undefined;
    if (!payment) {
      voidPending(bookingId);
      payment = { id: id(), bookingId, kind: "custom", amountCents: owedCents, status: "pending", method: null, linkUrl: null, paidAt: null, createdAt: now(), vatRateBp: null };
      d.payments.push(payment);
      save();
    }
    return this.paymentLink(payment.id);
  },

  async markPaid(paymentId, method) {
    const payment = mustFind(data().payments, paymentId, "Payment");
    pricedBooking(payment.bookingId);
    if (payment.status !== "pending") throw new Error("Payment is not pending");
    Object.assign(payment, {
      status: "paid", method, paidAt: now(), vatRateBp: data().user.vatRegistered ? data().user.vatRateBp : 0,
    });
    save();
  },

  async recordPayment(bookingId, input) {
    pricedBooking(bookingId);
    const parsed = RecordPaymentInput.parse(input);
    const d = data();
    const booking = mustFind(d.bookings, bookingId, "Booking");
    if (booking.status !== "confirmed" && booking.status !== "completed") throw new Error("Payments can only be recorded for confirmed or completed bookings.");
    const outstanding = bookingStage(booking, d.payments).owedCents;
    if (parsed.amount_cents > outstanding) throw new Error(`That's more than the ${new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(Math.max(0, outstanding) / 100)} still owed.`);
    d.payments.push({
      id: id(), bookingId, kind: "custom", status: "paid", method: parsed.method, amountCents: parsed.amount_cents,
      paidAt: paymentPaidAt(parsed.paid_on).toISOString(), createdAt: now(), linkUrl: null, vatRateBp: d.user.vatRegistered ? d.user.vatRateBp : 0,
    });
    voidPending(bookingId);
    const remainder = outstanding - parsed.amount_cents;
    if (booking.status === "completed" && remainder > 0) d.payments.push({
      id: id(), bookingId, kind: "balance", status: "pending", method: null, amountCents: remainder,
      paidAt: null, createdAt: now(), linkUrl: null, vatRateBp: null,
    });
    save();
  },

  async editPayment(paymentId, input) {
    const parsed = EditPaymentInput.parse(input), d = data();
    const payment = mustFind(d.payments, paymentId, "Payment"), booking = pricedBooking(payment.bookingId);
    if (payment.method === "stripe") throw new Error("Paid by card — refund it in Stripe");
    if (payment.status !== "paid") throw new Error("Only paid payments can be corrected.");
    if (d.documents.some(document => document.kind === "receipt" && document.paymentId === paymentId)) throw new Error("A receipt was issued for this payment. Undo it and record it again.");
    const total = paidFor(booking.id) - payment.amountCents + (parsed.amount_cents ?? payment.amountCents);
    if (total > booking.priceCents) throw new Error("The total paid cannot exceed the booking price.");
    Object.assign(payment, { amountCents: parsed.amount_cents ?? payment.amountCents, method: parsed.method ?? payment.method, paidAt: parsed.paid_at ?? payment.paidAt });
    const pending = d.payments.filter(item => item.bookingId === booking.id && item.status === "pending");
    if (pending.length !== 1 || pending[0].amountCents !== booking.priceCents - total) voidPending(booking.id);
    save();
  },

  async undoPayment(paymentId) {
    const d = data(), payment = mustFind(d.payments, paymentId, "Payment");
    if (payment.method === "stripe") throw new Error("Paid by card — refund it in Stripe");
    if (payment.status !== "paid") throw new Error("Only paid payments can be corrected.");
    payment.status = "cancelled";
    for (const document of d.documents) if (document.kind === "receipt" && document.paymentId === paymentId) document.voidedAt = now();
    const booking = mustFind(d.bookings, payment.bookingId, "Booking"), pending = d.payments.filter(item => item.bookingId === booking.id && item.status === "pending");
    if (pending.length !== 1 || booking.priceCents === null || pending[0].amountCents !== booking.priceCents - paidFor(booking.id)) voidPending(booking.id);
    save();
  },

  async createExpense(draft) {
    ConfirmExpenseInput.parse({ merchant: draft.merchant, amount_cents: draft.amountCents, vat_cents: draft.vatCents, category: draft.category, expense_date: draft.expenseDate });
    const d = data();
    const expenseId = id();
    if (draft.receipt) d.receipts[expenseId] = await blobToDataUrl(draft.receipt);
    d.expenses.push({
      id: expenseId, merchant: draft.merchant, amountCents: draft.amountCents, vatCents: draft.vatCents,
      category: draft.category, expenseDate: draft.expenseDate,
      receiptKey: draft.receipt ? "demo" : null, status: "confirmed", createdAt: now(),
    });
    save();
  },

  async updateExpense(expenseId, draft) {
    ConfirmExpenseInput.parse({ merchant: draft.merchant, amount_cents: draft.amountCents, vat_cents: draft.vatCents, category: draft.category, expense_date: draft.expenseDate });
    const { receipt: _unused, ...fields } = draft;
    Object.assign(mustFind(data().expenses, expenseId, "Expense"), fields);
    save();
  },

  async deleteExpense(expenseId) {
    const d = data();
    d.expenses = d.expenses.filter((e) => e.id !== expenseId);
    delete d.receipts[expenseId];
    save();
  },

  async receiptUrl(expense) {
    return data().receipts[expense.id] ?? null;
  },

  async updateClient(clientId, changes) {
    const d = data();
    const patch = UpdateClientInput.parse(changes);
    Object.assign(mustFind(d.clients, clientId, "Client"), patch);
    for (const booking of d.bookings) {
      if (booking.clientId === clientId) Object.assign(booking.client, patch);
    }
    save();
  },

  async deleteClient(clientId) {
    const d = data();
    const client = mustFind(d.clients, clientId, "Client");
    const bookings = d.bookings.filter((booking) => booking.clientId === clientId);
    if (bookings.some((booking) => booking.status === "enquiry" || booking.status === "confirmed")) {
      throw new Error("Cancel or complete their open bookings first.");
    }
    const ids = new Set(bookings.map((booking) => booking.id));
    d.messages = d.messages.filter((message) => !message.bookingId || !ids.has(message.bookingId));
    if (d.payments.some((payment) => ids.has(payment.bookingId) && (payment.status === "paid" || payment.paidAt !== null))) {
      const anonymous = { name: "Deleted client", phone: null, email: null, notes: null };
      Object.assign(client, anonymous);
      for (const booking of bookings) {
        Object.assign(booking.client, anonymous);
        booking.notes = null;
        booking.location = null;
      }
    } else {
      d.payments = d.payments.filter((payment) => !ids.has(payment.bookingId));
      d.bookings = d.bookings.filter((booking) => booking.clientId !== clientId);
      d.clients = d.clients.filter((item) => item.id !== clientId);
    }
    save();
  },

  async updateUser(changes) {
    const requested = changes;
    TaxSettings.parse({ ...data().user, ...changes });
    if (changes.services !== undefined) changes = { ...changes, services: Services.parse(changes.services) };
    Object.assign(data().user, changes);
    save();
    settingsAutosaveRegistry.notifySaved(demoBackend, data().user.id, requested);
  },

  async exportCsv(year) {
    const d = data();
    const inYear = (iso: string | null) => iso && new Date(iso).getFullYear() === year;
    const rows = [
      ["INCOME"],
      ["date_paid", "client", "service", "kind", "method", "amount_eur"],
      ...d.payments
        .filter((p) => p.status === "paid" && inYear(p.paidAt))
        .map((p) => {
          const booking = d.bookings.find((bk) => bk.id === p.bookingId);
          return [
            p.paidAt!.slice(0, 10), booking?.client.name, booking?.service, p.kind,
            p.method, (p.amountCents / 100).toFixed(2),
          ];
        }),
      [],
      ["EXPENSES"],
      ["date", "merchant", "category", "amount_eur", "has_receipt", "vat_eur"],
      ...d.expenses
        .filter((e) => inYear(e.expenseDate))
        .map((e) => [
          e.expenseDate!.slice(0, 10), e.merchant, e.category,
          ((e.amountCents ?? 0) / 100).toFixed(2), e.receiptKey ? "yes" : "no",
          e.vatCents == null ? "" : (e.vatCents / 100).toFixed(2),
        ]),
    ];
    return new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\n")], {
      type: "text/csv",
    });
  },
};
