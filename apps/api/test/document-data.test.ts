import { describe, expect, it } from "vitest";
import {
  assembleBookingDocument, documentNumber, InvoiceLogo, UpdateUserInput, MAX_LOGO_BYTES,
  type User, type Booking, type Client, type Payment, type BookingDocument,
} from "@sorted/core";

const user: User = {
  id: "user", email: "studio@example.com", name: "Shane", businessName: "Studio by Shane", phone: "+353871234567",
  emailVerifiedAt: null, address: "Main Street\nDublin", iban: "IE29AIBK93115212345678", bic: "AIBKIE2D",
  invoiceLogo: null, invoiceAccent: null, invoiceFooter: "Thank you!\nSee you soon.", vatNumber: "IE1234567AB",
  bookingConfirmationTemplate: null, paymentRequestTemplate: null, reviewLink: null, currency: "EUR", createdAt: "2026-01-01T00:00:00Z",
};
const client: Client = { id: "client", name: "Áine O’Brien", email: "aine@example.com", phone: "+353861234567", notes: null, createdAt: user.createdAt };
const booking: Booking = {
  id: "booking", clientId: client.id, service: "Bridal makeup", startAt: "2026-07-01T23:30:00Z", endAt: null,
  priceCents: 12050, depositCents: 2000, status: "confirmed", location: null, notes: null, gcalEventId: null, completedAt: null, createdAt: user.createdAt,
};
const document: BookingDocument = { id: "document", bookingId: booking.id, kind: "invoice", number: 1, issuedAt: "2026-07-02T12:00:00Z" };
const paid: Payment = { id: "paid", bookingId: booking.id, kind: "deposit", status: "paid", amountCents: 2000, paidAt: "2026-07-01T12:00:00Z", method: "bank_transfer", linkUrl: null, createdAt: user.createdAt };

describe("document data", () => {
  it("assembles an invoice with Ireland dates, exact cents, contact and bank details", () => {
    const data = assembleBookingDocument(user, booking, client, [paid, { ...paid, id: "due", status: "pending" }, { ...paid, bookingId: "other" }], document);
    expect(data).toMatchObject({ number: "INV-0001", issuedDate: "02 Jul 2026", bookingDate: "02 Jul 2026", total: "€120.50", paidToDate: "€20.00", balanceDue: "€100.50", iban: user.iban, bic: user.bic, accent: "#14532D" });
    expect(data.business).toMatchObject({ name: user.businessName, email: user.email, vatNumber: user.vatNumber });
    expect(data.client).toEqual({ name: client.name, email: client.email, phone: client.phone });
    expect(data.payments).toEqual([{ date: "01 Jul 2026", method: "Bank transfer", amount: "€20.00" }]);
  });

  it("receipts acknowledge only payments received, not an unpaid balance", () => {
    const data = assembleBookingDocument(user, booking, client, [paid], { ...document, kind: "receipt", number: 23 });
    expect(data).toMatchObject({ number: "RCT-0023", total: "€20.00", bookingTotal: "€120.50", balanceDue: "€100.50", iban: null, bic: null });
    expect(data.lineItem).toEqual({ description: "Bridal makeup — payment received", amount: "€20.00" });
    expect(documentNumber("invoice", 10000)).toBe("INV-10000");
  });

  it("handles missing optional details, zero payments and overpayments without mutating inputs", () => {
    const data = assembleBookingDocument({ ...user, businessName: null, name: null, invoiceFooter: null, vatNumber: null, invoiceAccent: "#112233" }, booking, client, [], document);
    expect(data).toMatchObject({ paidToDate: "€0.00", balanceDue: "€120.50", footer: "", accent: "#112233" });
    expect(data.business).toMatchObject({ name: "Your business", vatNumber: null });
    expect(assembleBookingDocument(user, booking, client, [{ ...paid, amountCents: 15000 }], document).balanceDue).toBe("€0.00");
    expect(paid.amountCents).toBe(2000);
  });

  it("rejects empty receipts and mismatched booking or client data", () => {
    expect(() => assembleBookingDocument(user, booking, client, [], { ...document, kind: "receipt" })).toThrow("Record a payment");
    expect(() => assembleBookingDocument(user, booking, client, [paid], { ...document, bookingId: "other" })).toThrow("does not match");
    expect(() => assembleBookingDocument(user, booking, { ...client, id: "other" }, [paid], document)).toThrow("does not match");
  });
});

describe("invoice branding validation", () => {
  it("normalises VAT numbers and colours, and supports clearing optional values", () => {
    expect(UpdateUserInput.parse({ vat_number: " ie 1234567 ab ", invoice_accent: "#abc" })).toMatchObject({ vat_number: "IE1234567AB", invoice_accent: "#AABBCC" });
    expect(UpdateUserInput.parse({ invoice_logo: null, invoice_accent: null, invoice_footer: null, vat_number: null })).toMatchObject({ invoice_logo: null, vat_number: null });
    const result = UpdateUserInput.safeParse({ vat_number: "IE1234A" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("Enter a valid Irish VAT number.");
    expect(UpdateUserInput.safeParse({ invoice_accent: "red" }).success).toBe(false);
    expect(UpdateUserInput.safeParse({ invoice_footer: "x".repeat(1001) }).success).toBe(false);
  });

  it("accepts PNG/JPEG data URLs and rejects other MIME types, malformed data and oversized logos", () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1cAAAAASUVORK5CYII=";
    expect(InvoiceLogo.safeParse(png).success).toBe(true);
    expect(InvoiceLogo.safeParse("data:image/jpeg;base64,/9j/AA==").success).toBe(true);
    for (const value of ["", "https://example.com/logo.png", "data:image/svg+xml;base64,AAAA", "data:image/png;base64,AAAA", `data:image/png;base64,iVBORw0KGgoA${"AAAA".repeat(MAX_LOGO_BYTES / 3)}`]) {
      expect(InvoiceLogo.safeParse(value).success).toBe(false);
    }
  });
});
