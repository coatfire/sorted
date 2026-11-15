import type { Booking, Client, Expense, Health, MessageLogEntry, Payment, User, BookingDocument, CalendarLinks } from "@sorted/core";
import { api, apiBlob, apiUrl, patch, post } from "./api";
import type { Backend, ExpenseDraft } from "./backend";
import { blobToDataUrl } from "./image";

const expenseBody = (draft: ExpenseDraft) => ({
  merchant: draft.merchant,
  amount_cents: draft.amountCents,
  vat_cents: draft.vatCents,
  category: draft.category,
  expense_date: draft.expenseDate,
});

export const apiBackend: Backend = {
  health: () => api<Health>("/health"),
  driveFiles: () => api("/drive/files"),
  driveBackedUp: () => post("/drive/backed-up"),
  googleStart: () => window.location.assign(apiUrl("/auth/google/start")),
  googleExchange: (code) => api("/auth/google/exchange", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }),
  calendar: () => api<CalendarLinks>("/calendar"),
  resetCalendar: () => post<CalendarLinks>("/calendar/reset"),
  document: (bookingId, kind, paymentId) => post<BookingDocument>(`/bookings/${bookingId}/documents`, { kind, payment_id: paymentId }),
  signup: (email, password) => post("/auth/signup", { email, password }),
  login: (email, password) => post("/auth/login", { email, password }),
  verify: (token) => post("/auth/verify", { token }),
  forgot: (email) => post("/auth/forgot", { email }),
  resetPassword: (token, password) => post("/auth/reset", { token, password }),
  async load() {
    const [user, health, clients, bookings, payments, expenses] = await Promise.all([
      api<User>("/auth/me"),
      api<Health>("/health"),
      api<Client[]>("/clients"),
      api<Array<{ booking: Booking; client: Client }>>("/bookings"),
      api<Array<{ payment: Payment }>>("/payments"),
      api<Expense[]>("/expenses"),
    ]);
    return {
      user,
      features: health.features,
      clients,
      bookings: bookings.map(({ booking, client }) => ({ ...booking, client })),
      payments: payments.map(({ payment }) => payment),
      expenses,
    };
  },

  createBooking: (draft) =>
    post<Booking & { seriesCount: number }>("/bookings", {
      client_id: draft.clientId,
      client: draft.client,
      status: draft.status,
      service: draft.service,
      start_at: draft.startAt,
      follow_up_on: draft.followUpOn,
      repeat: draft.repeat ? { every_weeks: draft.repeat.everyWeeks, count: draft.repeat.count } : undefined,
      price_cents: draft.priceCents,
      deposit_cents: draft.depositCents,
      location: draft.location ?? undefined,
      notes: draft.notes ?? undefined,
    }),

  async updateBooking(id, draft) {
    await patch(`/bookings/${id}`, {
      service: draft.service,
      start_at: draft.startAt,
      follow_up_on: draft.followUpOn,
      price_cents: draft.priceCents,
      deposit_cents: draft.depositCents,
      location: draft.location,
      notes: draft.notes,
    });
  },

  confirmBooking: (id) => post(`/bookings/${id}/confirm`),
  completeBooking: (id) => post(`/bookings/${id}/complete`),
  cancelBooking: (id) => post(`/bookings/${id}/cancel`),
  followUp: (id, date) => patch(`/bookings/${id}`, { follow_up_on: date }),
  paymentRequested: (id) => post(`/bookings/${id}/payment-requested`),

  async messages(bookingId) {
    const detail = await api<{ messages: MessageLogEntry[] }>(`/bookings/${bookingId}`);
    return detail.messages;
  },

  async paymentLink(paymentId) {
    const payment = await post<Payment>(`/payments/${paymentId}/link`);
    return payment.linkUrl!;
  },

  markPaid: (paymentId, method) => post(`/payments/${paymentId}/mark-paid`, { method }),
  recordPayment: (bookingId, input) => post(`/bookings/${bookingId}/payments`, input),

  async createExpense(draft) {
    let receiptKey: string | undefined;
    if (draft.receipt) {
      const dataUrl = await blobToDataUrl(draft.receipt);
      const uploaded = await post<{ receipt_key: string }>("/expenses/receipts", {
        content_type: draft.receipt.type,
        data_base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
      });
      receiptKey = uploaded.receipt_key;
    }
    await post("/expenses", { ...expenseBody(draft), receipt_key: receiptKey, confirmed: true });
  },

  async updateExpense(id, draft) {
    await patch(`/expenses/${id}`, expenseBody(draft));
  },

  deleteExpense: (id) => api(`/expenses/${id}`, { method: "DELETE" }),

  async receiptUrl(expense) {
    if (!expense.receiptKey) return null;
    return URL.createObjectURL(await apiBlob(`/expenses/${expense.id}/receipt`));
  },

  async updateClient(id, changes) {
    await patch(`/clients/${id}`, changes);
  },

  deleteClient: (id) => api(`/clients/${id}`, {
    method: "DELETE", body: JSON.stringify({ confirm: true }),
  }),

  async updateUser(changes) {
    await patch("/auth/me", {
      name: changes.name,
      business_name: changes.businessName,
      phone: changes.phone,
      review_link: changes.reviewLink,
      address: changes.address,
      iban: changes.iban,
      bic: changes.bic,
      booking_confirmation_template: changes.bookingConfirmationTemplate,
      payment_request_template: changes.paymentRequestTemplate,
      invoice_logo: changes.invoiceLogo,
      invoice_accent: changes.invoiceAccent,
      invoice_footer: changes.invoiceFooter,
      vat_number: changes.vatNumber,
      revolut_link: changes.revolutLink,
      services: changes.services?.map(service => ({ name: service.name, price_cents: service.priceCents })),
      vat_registered: changes.vatRegistered,
      vat_rate_bp: changes.vatRateBp,
      vat_period_months: changes.vatPeriodMonths,
      income_tax_rate_bp: changes.incomeTaxRateBp,
    });
  },

  exportCsv: (year) => apiBlob(`/reports/export?year=${year}`),
};
