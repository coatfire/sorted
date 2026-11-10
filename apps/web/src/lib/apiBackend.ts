import type { Booking, Client, Expense, Health, MessageLogEntry, Payment, User } from "@sorted/core";
import { api, apiBlob, patch, post } from "./api";
import type { Backend, ExpenseDraft } from "./backend";
import { blobToDataUrl } from "./image";

const expenseBody = (draft: ExpenseDraft) => ({
  merchant: draft.merchant,
  amount_cents: draft.amountCents,
  category: draft.category,
  expense_date: draft.expenseDate,
});

export const apiBackend: Backend = {
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
    post<Booking>("/bookings", {
      client_id: draft.clientId,
      client: draft.client,
      service: draft.service,
      start_at: draft.startAt,
      price_cents: draft.priceCents,
      deposit_cents: draft.depositCents,
      location: draft.location ?? undefined,
      notes: draft.notes ?? undefined,
    }),

  async updateBooking(id, draft) {
    await patch(`/bookings/${id}`, {
      service: draft.service,
      start_at: draft.startAt,
      price_cents: draft.priceCents,
      deposit_cents: draft.depositCents,
      location: draft.location,
      notes: draft.notes,
    });
  },

  confirmBooking: (id) => post(`/bookings/${id}/confirm`),
  completeBooking: (id) => post(`/bookings/${id}/complete`),
  cancelBooking: (id) => post(`/bookings/${id}/cancel`),

  async messages(bookingId) {
    const detail = await api<{ messages: MessageLogEntry[] }>(`/bookings/${bookingId}`);
    return detail.messages;
  },

  async paymentLink(paymentId) {
    const payment = await post<Payment>(`/payments/${paymentId}/link`);
    return payment.linkUrl!;
  },

  markPaid: (paymentId, method) => post(`/payments/${paymentId}/mark-paid`, { method }),

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

  async updateUser(changes) {
    await patch("/auth/me", {
      name: changes.name,
      business_name: changes.businessName,
      phone: changes.phone,
      review_link: changes.reviewLink,
    });
  },

  exportCsv: (year) => apiBlob(`/reports/export?year=${year}`),
};
