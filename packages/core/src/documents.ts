import { z } from "zod";
import type { Booking, Client, Payment, User } from "./types";
import { inclusiveVat } from "./tax";
import { addCalendarDays, dublinDateTime } from "./dates";

export const DEFAULT_INVOICE_ACCENT = "#14532D";
export const MAX_LOGO_BYTES = 300 * 1024;
export const InvoiceLogo = z.string().max(410000).refine((value) => {
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return false;
  const bytes = match[2].length * 3 / 4 - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
  return bytes <= MAX_LOGO_BYTES && (match[1] === "png" ? match[2].startsWith("iVBORw0KGgo") : match[2].startsWith("/9j/"));
}, "Choose a PNG or JPEG logo under 300KB.");
export const InvoiceAccent = z.string().regex(/^#(?:[\da-f]{3}|[\da-f]{6})$/i, "Enter a hex colour, like #14532D.")
  .transform((value) => (value.length === 4 ? `#${[...value.slice(1)].map((c) => c + c).join("")}` : value).toUpperCase());
export const IrishVatNumber = z.string().transform((value) => value.replace(/\s/g, "").toUpperCase())
  .refine((value) => /^IE\d{7}[A-Z]{1,2}$/.test(value), "Enter a valid Irish VAT number.");
export const DocumentKind = z.enum(["invoice", "receipt", "quote"]);
export type DocumentKind = z.infer<typeof DocumentKind>;
export const CreateDocumentInput = z.object({ kind: DocumentKind, payment_id: z.string().uuid().optional() })
  .refine((input) => input.kind !== "receipt" || !!input.payment_id, { message: "Choose a paid payment for this receipt.", path: ["payment_id"] });

export interface ReceiptSnapshot {
  vatRateBp?: number | null;
  service: string;
  bookingDate: string | null;
  bookingTotalCents: number;
  balanceDueCents: number;
  payment: { date: string; amountCents: number; method: Payment["method"] };
}

export function snapshotReceipt(
  booking: Pick<Booking, "id" | "service" | "startAt" | "priceCents">,
  payments: readonly Payment[], paymentId: string, issuedAt: string,
  settings: Pick<User, "vatRegistered" | "vatRateBp"> = { vatRegistered: false, vatRateBp: null },
): ReceiptSnapshot {
  if (booking.priceCents === null) throw new Error("Add a price first");
  const received = payments.filter((payment) => payment.bookingId === booking.id && payment.status === "paid"
    && new Date(payment.paidAt ?? payment.createdAt).getTime() <= new Date(issuedAt).getTime());
  const payment = received.find((item) => item.id === paymentId);
  if (!payment) throw new Error("Choose a paid payment for this receipt.");
  return {
    vatRateBp: payment.vatRateBp ?? (settings.vatRegistered ? settings.vatRateBp : null),
    service: booking.service, bookingDate: booking.startAt, bookingTotalCents: booking.priceCents,
    balanceDueCents: Math.max(0, booking.priceCents - received.reduce((sum, item) => sum + item.amountCents, 0)),
    payment: { date: payment.paidAt ?? payment.createdAt, amountCents: payment.amountCents, method: payment.method },
  };
}

export interface BookingDocument {
  voidedAt?: string | null;
  documentSnapshot?: DocumentSnapshot | null;
  vatRateBp: number | null;
  id: string;
  bookingId: string;
  kind: DocumentKind;
  number: number;
  issuedAt: string;
  paymentId: string | null;
  receiptSnapshot: ReceiptSnapshot | null;
}

export const documentNumber = (kind: DocumentKind, number: number) =>
  `${kind === "invoice" ? "INV" : kind === "quote" ? "QTE" : "RCT"}-${String(number).padStart(4, "0")}`;

function liveBookingDocument(user: User, booking: Booking, client: Client, payments: readonly Payment[], document: BookingDocument) {
  if (booking.priceCents === null) throw new Error("Add a price first");
  if (document.bookingId !== booking.id || booking.clientId !== client.id) throw new Error("Document does not match this booking.");
  const received = payments.filter((payment) => payment.bookingId === booking.id && payment.status === "paid")
    .slice().sort((a, b) => (a.paidAt ?? a.createdAt).localeCompare(b.paidAt ?? b.createdAt));
  const receipt = document.kind === "receipt";
  const quote = document.kind === "quote";
  const snapshot = receipt ? document.receiptSnapshot : null;
  if (receipt && (!document.paymentId || !snapshot)) throw new Error("Choose a paid payment for this receipt.");
  const paid = snapshot ? snapshot.payment.amountCents : received.reduce((sum, payment) => sum + payment.amountCents, 0);
  const bookingTotal = snapshot?.bookingTotalCents ?? booking.priceCents;
  const vatRateBp = receipt ? snapshot?.vatRateBp ?? null : document.vatRateBp ?? (user.vatRegistered ? user.vatRateBp : null);
  const grossCents = receipt ? paid : bookingTotal;
  const vatCents = vatRateBp === null ? 0 : inclusiveVat(grossCents, vatRateBp);
  const money = (cents: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(cents / 100);
  const date = (iso: string | null) => iso ? new Intl.DateTimeFormat("en-IE", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Dublin",
  }).format(new Date(iso)) : "Date to be agreed";
  const methods = { cash: "Cash", bank_transfer: "Bank transfer", stripe: "Card", revolut: "Revolut" };
  return {
    kind: document.kind,
    title: receipt ? "Receipt" : quote ? "Quote" : "Invoice",
    number: documentNumber(document.kind, document.number),
    issuedDate: date(document.issuedAt),
    validUntil: quote ? date(`${addCalendarDays(dublinDateTime(document.issuedAt).date, 30)}T12:00:00Z`) : null,
    deposit: quote && booking.depositCents > 0 ? money(booking.depositCents) : null,
    confirmationLine: quote ? "To go ahead, just reply to confirm." : null,
    bookingDate: date(snapshot?.bookingDate ?? booking.startAt),
    business: {
      name: user.businessName || user.name || "Your business", address: user.address,
      phone: user.phone, email: user.email, vatNumber: user.vatNumber ?? null,
    },
    client: { name: client.name, email: client.email, phone: client.phone },
    logo: user.invoiceLogo ?? null,
    accent: user.invoiceAccent ?? DEFAULT_INVOICE_ACCENT,
    footer: user.invoiceFooter ?? "",
    lineItem: { description: `${snapshot?.service ?? booking.service}${receipt ? " — payment received" : ""}`, amount: money(receipt ? paid : bookingTotal) },
    total: money(receipt ? paid : bookingTotal),
    vat: vatRateBp === null || (vatRateBp === 0 && !user.vatRegistered) ? null : { rate: `${vatRateBp / 100}%`, net: money(grossCents - vatCents), amount: money(vatCents), total: money(grossCents) },
    bookingTotal: money(bookingTotal),
    paidToDate: money(paid),
    balanceDue: money(snapshot?.balanceDueCents ?? Math.max(0, bookingTotal - paid)),
    iban: receipt || quote ? null : user.iban,
    bic: receipt || quote ? null : user.bic,
    revolutLink: receipt ? null : user.revolutLink ?? null,
    payments: (snapshot ? [{ ...snapshot.payment, paidAt: snapshot.payment.date, createdAt: snapshot.payment.date }] : received).map((payment) => ({
      date: date(payment.paidAt ?? payment.createdAt), amount: money(payment.amountCents),
      method: payment.method ? methods[payment.method] : "Payment",
    })),
  };
}
export type BookingDocumentData = ReturnType<typeof liveBookingDocument> & { voided?: boolean };

export interface DocumentSnapshot {
  version: 1;
  vatRegistered: boolean;
  data: BookingDocumentData;
}

export function assembleBookingDocument(user: User, booking: Booking, client: Client, payments: readonly Payment[], document: BookingDocument): BookingDocumentData {
  if (document.bookingId !== booking.id || booking.clientId !== client.id) throw new Error("Document does not match this booking.");
  const data = document.documentSnapshot?.data ?? liveBookingDocument(user, booking, client, payments, document);
  return document.voidedAt ? { ...data, voided: true } : data;
}

export function snapshotDocument(user: User, booking: Booking, client: Client, payments: readonly Payment[], document: BookingDocument): DocumentSnapshot {
  return { version: 1, vatRegistered: user.vatRegistered, data: liveBookingDocument(user, booking, client, payments, document) };
}
