import { renderBookingMessage, type User } from "@sorted/core";

export const MESSAGE_CHIPS = [
  ["Client name", "{client}"], ["Business name", "{business}"], ["Date", "{date}"], ["Time", "{time}"], ["Service", "{service}"], ["Amount", "{balance}"], ["Full price", "{price}"], ["Deposit details", "{deposit_breakdown}"], ["Bank details", "IBAN: {iban}\nBIC: {bic}"], ["Revolut link", "{revolut_link}"], ["Payment link", "{pay_link}"],
] as const;
export function insertMessageToken(value: string, token: string, start: number, end = start) {
  return { value: value.slice(0, start) + token + value.slice(end), cursor: start + token.length };
}
export function previewMessage(template: string, user: Pick<User, "businessName" | "name" | "iban" | "bic" | "revolutLink">, kind: "confirmation" | "payment_request") {
  return renderBookingMessage(template, { kind, client: "Aoife", business: user.businessName || user.name || "Your business", date: "Wednesday 18 November", time: "10:00", service: "Gel nails", priceCents: 8000, depositCents: 2000, paidCents: 2000, balanceCents: 6000, iban: user.iban, bic: user.bic, revolutLink: user.revolutLink, payLink: "https://example.com/pay" });
}
