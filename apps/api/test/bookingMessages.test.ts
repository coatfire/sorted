import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOOKING_CONFIRMATION_TEMPLATE, DEFAULT_PAYMENT_REQUEST_TEMPLATE, MESSAGE_PLACEHOLDERS,
  renderBookingMessage, bookingMessagePayLink, UpdateUserInput, type BookingMessageDetails,
} from "@sorted/core";

const details: BookingMessageDetails = {
  client: "Sarah & Jane", business: "Studio by Shane", date: "15 November", time: "10:00",
  service: "Wedding hair", priceCents: 35050, depositCents: 10000, balanceCents: 25050,
  iban: "IE29AIBK93115212345678", bic: "AIBKIE2D", payLink: null,
};

describe("booking message templates", () => {
  const deposit = { status: "pending", kind: "deposit", amountCents: 10000, linkUrl: "https://example.com/deposit" } as const;
  const balance = { status: "pending", kind: "balance", amountCents: 25050, linkUrl: "https://example.com/balance" } as const;

  it("only includes a payment request link for the exact unpaid balance", () => {
    expect(bookingMessagePayLink([deposit], "payment_request", 35050)).toBeNull();
    expect(bookingMessagePayLink([deposit, balance], "payment_request", 25050)).toBe(balance.linkUrl);
    expect(bookingMessagePayLink([deposit, balance], "payment_request", 35050)).toBeNull();
    expect(bookingMessagePayLink([{ ...balance, kind: "full", amountCents: 35050 }], "payment_request", 35050)).toBe(balance.linkUrl);
    expect(bookingMessagePayLink([deposit], "payment_request", 10000)).toBe(deposit.linkUrl);
  });

  it("only includes pending deposit links for confirmations and skips unavailable links", () => {
    expect(bookingMessagePayLink([balance, deposit], "confirmation", 35050)).toBe(deposit.linkUrl);
    expect(bookingMessagePayLink([balance], "confirmation", 25050)).toBeNull();
    for (const kind of ["confirmation", "payment_request"] as const) {
      expect(bookingMessagePayLink([], kind, 10000)).toBeNull();
      expect(bookingMessagePayLink([{ ...deposit, linkUrl: null }], kind, 10000)).toBeNull();
      expect(bookingMessagePayLink([{ ...deposit, status: "paid" }], kind, 10000)).toBeNull();
      expect(bookingMessagePayLink([{ ...deposit, status: "cancelled" }], kind, 10000)).toBeNull();
    }
  });

  it("renders every placeholder from cents without recursively interpreting client content", () => {
    expect(renderBookingMessage(MESSAGE_PLACEHOLDERS.map((key) => `{${key}}`).join("|"), details))
      .toBe("Sarah & Jane|Studio by Shane|15 November|10:00|Wedding hair|€350.50|€100.00|€250.50|IE29AIBK93115212345678|AIBKIE2D|");
    expect(renderBookingMessage("Hi {client}: {balance}", { ...details, client: "{balance}" }))
      .toBe("Hi {balance}: €250.50");
  });

  it("includes bank details in both defaults and leaves disabled payment links empty", () => {
    for (const template of [DEFAULT_BOOKING_CONFIRMATION_TEMPLATE, DEFAULT_PAYMENT_REQUEST_TEMPLATE]) {
      const result = renderBookingMessage(template, details);
      expect(result).toContain("IBAN: IE29AIBK93115212345678");
      expect(result).toContain("BIC: AIBKIE2D");
      expect(result).toContain("€250.50");
      expect(result).not.toMatch(/\{\w+\}|null|undefined/);
    }
  });

  it("drops bare or labelled empty bank lines, including CRLF and whitespace", () => {
    const empty = { ...details, iban: null, bic: "  ", depositCents: 0, balanceCents: 0 };
    expect(renderBookingMessage("Hello\r\nIBAN: {iban}\r\n{bic}\r\nIBAN / BIC: {iban} / {bic}\r\nDue {balance}", empty))
      .toBe("Hello\nDue €0.00");
    expect(renderBookingMessage("IBAN: {iban}\nBIC: {bic}", { ...details, iban: null })).toBe("BIC: AIBKIE2D");
    expect(renderBookingMessage("", empty)).toBe("");
    expect(renderBookingMessage("{iban}\n{bic}", empty)).toBe("");
  });

  it("preserves unknown placeholders and supports Unicode, punctuation and optional links", () => {
    expect(renderBookingMessage("{constructor} {unknown}", details)).toBe("{constructor} {unknown}");
    expect(renderBookingMessage("Thanks {unknown}! {client} {pay_link}", { ...details, payLink: "https://example.com/pay?a=1&b=2" }))
      .toBe("Thanks {unknown}! Sarah & Jane https://example.com/pay?a=1&b=2");
    expect(renderBookingMessage("Hello\nBank details: {iban}. Ask me if needed.", { ...details, iban: null }))
      .toBe("Hello");
    expect(renderBookingMessage("Price {price}; bank {iban}", { ...details, iban: null }))
      .toBe("Price €350.50; bank");
  });

  it("accepts empty custom templates and null defaults but rejects oversized or invalid values", () => {
    expect(UpdateUserInput.safeParse({ booking_confirmation_template: "", payment_request_template: null }).success).toBe(true);
    expect(UpdateUserInput.safeParse({ booking_confirmation_template: "x".repeat(4001) }).success).toBe(false);
    expect(UpdateUserInput.safeParse({ payment_request_template: 42 }).success).toBe(false);
  });
});
