/**
 * The demo: the same app, backed by localStorage and a believable seeded
 * business. It mirrors the API's rules (state machine, payment rows) so what
 * someone tries here is what they get after signing up. "Messages" and
 * payment links are simulated — nothing leaves the browser.
 */
import type { Client, Expense, MessageLogEntry, Payment } from "@sorted/core";
import type { Backend, BookingRow, Snapshot } from "./backend";
import { blobToDataUrl } from "./image";

const KEY = "sorted_demo_v3";

interface DemoData extends Snapshot {
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
    id: id(), bookingId: bk.id, kind, amountCents, method: paid?.method ?? null,
    status: paid ? "paid" : "pending", linkUrl: null, paidAt: paid?.at ?? null,
    createdAt: paid?.at ?? bk.startAt,
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
    id: id(), merchant, amountCents, category, expenseDate: date,
    receiptKey: receipt ? "demo" : null, status: "confirmed", createdAt: date,
  });
  const message = (
    bk: BookingRow, template: MessageLogEntry["template"], sentAt: string,
  ): MessageLogEntry => ({ id: id(), bookingId: bk.id, template, status: "sent", sentAt });

  return {
    user: {
      id: "demo", email: "demo@sorted.app", name: "Shane", businessName: "Studio by Shane",
      phone: "+353871234567", reviewLink: "https://g.page/r/example/review",
      currency: "EUR", createdAt: at(-200, 9),
    },
    features: { automation: true, paymentLinks: true },
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
  };
}

function read(): DemoData {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return JSON.parse(saved) as DemoData;
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

const log = (bookingId: string, template: MessageLogEntry["template"]) =>
  data().messages.push({ id: id(), bookingId, template, status: "sent", sentAt: now() });

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

export const demoBackend: Backend = {
  async load() {
    const { messages: _m, receipts: _r, ...snapshot } = data();
    return structuredClone(snapshot);
  },

  async createBooking(draft) {
    const d = data();
    let client: Client;
    if (draft.clientId) client = mustFind(d.clients, draft.clientId, "Client");
    else {
      client = {
        id: id(), name: draft.client!.name, phone: draft.client!.phone ?? null,
        email: null, notes: null, createdAt: now(),
      };
      d.clients.unshift(client);
    }
    const booking: BookingRow = {
      id: id(), clientId: client.id, client, service: draft.service, startAt: draft.startAt,
      endAt: null, priceCents: draft.priceCents, depositCents: draft.depositCents,
      status: "enquiry", location: draft.location, notes: draft.notes, gcalEventId: null,
      completedAt: null, createdAt: now(),
    };
    d.bookings.push(booking);
    save();
    return { id: booking.id };
  },

  async updateBooking(bookingId, draft) {
    Object.assign(mustFind(data().bookings, bookingId, "Booking"), draft);
    save();
  },

  async confirmBooking(bookingId) {
    const d = data();
    const booking = mustFind(d.bookings, bookingId, "Booking");
    booking.status = "confirmed";
    if (booking.depositCents > 0) {
      d.payments.push({
        id: id(), bookingId, kind: "deposit", amountCents: booking.depositCents,
        method: null, status: "pending", linkUrl: null, paidAt: null, createdAt: now(),
      });
    }
    if (booking.client.phone) log(bookingId, "confirmation");
    save();
  },

  async completeBooking(bookingId) {
    const d = data();
    const booking = mustFind(d.bookings, bookingId, "Booking");
    const paid = paidFor(bookingId);
    voidPending(bookingId);
    const remainder = Math.max(booking.priceCents - paid, 0);
    if (remainder > 0) {
      d.payments.push({
        id: id(), bookingId, kind: paid > 0 ? "balance" : "full", amountCents: remainder,
        method: null, status: "pending", linkUrl: null, paidAt: null, createdAt: now(),
      });
    }
    booking.status = "completed";
    booking.completedAt = now();
    save();
  },

  async cancelBooking(bookingId) {
    mustFind(data().bookings, bookingId, "Booking").status = "cancelled";
    voidPending(bookingId);
    save();
  },

  async messages(bookingId) {
    return data()
      .messages.filter((m) => m.bookingId === bookingId)
      .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  },

  async paymentLink(paymentId) {
    const payment = mustFind(data().payments, paymentId, "Payment");
    if (!payment.linkUrl) {
      payment.linkUrl = `https://pay.sorted.example/demo-${payment.id.slice(0, 8)}`;
      payment.method = "stripe";
      const booking = mustFind(data().bookings, payment.bookingId, "Booking");
      if (booking.client.phone) log(payment.bookingId, "payment_request");
      save();
    }
    return payment.linkUrl;
  },

  async markPaid(paymentId, method) {
    Object.assign(mustFind(data().payments, paymentId, "Payment"), {
      status: "paid", method, paidAt: now(),
    });
    save();
  },

  async createExpense(draft) {
    const d = data();
    const expenseId = id();
    if (draft.receipt) d.receipts[expenseId] = await blobToDataUrl(draft.receipt);
    d.expenses.push({
      id: expenseId, merchant: draft.merchant, amountCents: draft.amountCents,
      category: draft.category, expenseDate: draft.expenseDate,
      receiptKey: draft.receipt ? "demo" : null, status: "confirmed", createdAt: now(),
    });
    save();
  },

  async updateExpense(expenseId, draft) {
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
    Object.assign(mustFind(d.clients, clientId, "Client"), changes);
    for (const booking of d.bookings) {
      if (booking.clientId === clientId) Object.assign(booking.client, changes);
    }
    save();
  },

  async updateUser(changes) {
    Object.assign(data().user, changes);
    save();
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
      ["date", "merchant", "category", "amount_eur", "has_receipt"],
      ...d.expenses
        .filter((e) => inYear(e.expenseDate))
        .map((e) => [
          e.expenseDate!.slice(0, 10), e.merchant, e.category,
          ((e.amountCents ?? 0) / 100).toFixed(2), e.receiptKey ? "yes" : "no",
        ]),
    ];
    return new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\n")], {
      type: "text/csv",
    });
  },
};
