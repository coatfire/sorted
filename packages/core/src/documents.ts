import { z } from "zod";
import type { Booking, Client, Payment, User } from "./types";

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
export const DocumentKind = z.enum(["invoice", "receipt"]);
export type DocumentKind = z.infer<typeof DocumentKind>;
export const CreateDocumentInput = z.object({ kind: DocumentKind });

export interface BookingDocument {
  id: string;
  bookingId: string;
  kind: DocumentKind;
  number: number;
  issuedAt: string;
}

export const documentNumber = (kind: DocumentKind, number: number) =>
  `${kind === "invoice" ? "INV" : "RCT"}-${String(number).padStart(4, "0")}`;

export function assembleBookingDocument(user: User, booking: Booking, client: Client, payments: readonly Payment[], document: BookingDocument) {
  if (document.bookingId !== booking.id || booking.clientId !== client.id) throw new Error("Document does not match this booking.");
  const received = payments.filter((payment) => payment.bookingId === booking.id && payment.status === "paid")
    .slice().sort((a, b) => (a.paidAt ?? a.createdAt).localeCompare(b.paidAt ?? b.createdAt));
  if (document.kind === "receipt" && !received.length) throw new Error("Record a payment before creating a receipt.");
  const paid = received.reduce((sum, payment) => sum + payment.amountCents, 0);
  const money = (cents: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(cents / 100);
  const date = (iso: string) => new Intl.DateTimeFormat("en-IE", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Dublin",
  }).format(new Date(iso));
  const methods = { cash: "Cash", bank_transfer: "Bank transfer", stripe: "Card", revolut: "Revolut" };
  const receipt = document.kind === "receipt";
  return {
    kind: document.kind,
    title: receipt ? "Receipt" : "Invoice",
    number: documentNumber(document.kind, document.number),
    issuedDate: date(document.issuedAt),
    bookingDate: date(booking.startAt),
    business: {
      name: user.businessName || user.name || "Your business", address: user.address,
      phone: user.phone, email: user.email, vatNumber: user.vatNumber ?? null,
    },
    client: { name: client.name, email: client.email, phone: client.phone },
    logo: user.invoiceLogo ?? null,
    accent: user.invoiceAccent ?? DEFAULT_INVOICE_ACCENT,
    footer: user.invoiceFooter ?? "",
    lineItem: { description: `${booking.service}${receipt ? " — payment received" : ""}`, amount: money(receipt ? paid : booking.priceCents) },
    total: money(receipt ? paid : booking.priceCents),
    bookingTotal: money(booking.priceCents),
    paidToDate: money(paid),
    balanceDue: money(Math.max(0, booking.priceCents - paid)),
    iban: receipt ? null : user.iban,
    bic: receipt ? null : user.bic,
    payments: received.map((payment) => ({
      date: date(payment.paidAt ?? payment.createdAt), amount: money(payment.amountCents),
      method: payment.method ? methods[payment.method] : "Payment",
    })),
  };
}
export type BookingDocumentData = ReturnType<typeof assembleBookingDocument>;
