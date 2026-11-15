import { Services, Service, normaliseIban, normaliseBic, validIban, validBic, RevolutLink } from "@sorted/core";
import type { User } from "@sorted/core";
import { parseEuros } from "./format";

export const needsWelcome = (user: Pick<User, "businessName">) => !user.businessName?.trim();
export const traderName = (user: Pick<User, "name" | "businessName">) => user.name?.trim() || user.businessName?.trim() || "Your business";
export const needsPaymentDetails = (user: Pick<User, "iban" | "revolutLink">, kind: string, depositCents: number, balanceCents: number) =>
  !user.iban?.trim() && !user.revolutLink?.trim() && (kind === "payment_request" || (depositCents > 0 && balanceCents > 0));

export interface ServiceDraft { id: string; name: string; price: string; lastComplete?: { name: string; priceCents: number } }
export function completeServiceDrafts(rows: ServiceDraft[]) {
  const drafts = rows.map(row => {
    const duplicate = rows.some(other => other.id !== row.id && other.name.trim().toLowerCase() === row.name.trim().toLowerCase());
    const parsed = Service.safeParse({ name: row.name, priceCents: parseEuros(row.price) });
    return parsed.success && !duplicate ? { ...row, lastComplete: parsed.data } : row;
  });
  return { drafts, values: drafts.flatMap(row => row.lastComplete ? [row.lastComplete] : []) };
}
export function serviceErrors(row: ServiceDraft) {
  return {
    name: Service.shape.name.safeParse(row.name).success ? undefined : "Enter a service name.",
    price: Service.shape.priceCents.safeParse(parseEuros(row.price)).success ? undefined : "Enter a price, like 35 or 35.50.",
  };
}
export function serviceValues(rows: ServiceDraft[]) {
  return Services.safeParse(rows.filter(row => row.name.trim() || row.price.trim()).map(row => ({ name: row.name, priceCents: parseEuros(row.price) })));
}
export function paymentDetails(values: { iban: string; bic: string; revolutLink: string }) {
  const errors = {
    iban: values.iban.trim() && !validIban(values.iban) ? "Enter a valid IBAN." : undefined,
    bic: values.bic.trim() && !validBic(values.bic.trim()) ? "Enter a valid BIC." : undefined,
    revolutLink: values.revolutLink.trim() && !RevolutLink.safeParse(values.revolutLink).success ? "Enter a Revolut username or revolut.me link." : undefined,
  };
  return { errors, patch: {
    iban: values.iban.trim() ? normaliseIban(values.iban) : null,
    bic: values.bic.trim() ? normaliseBic(values.bic.trim()) : null,
    revolutLink: values.revolutLink.trim() && !errors.revolutLink ? RevolutLink.parse(values.revolutLink) : null,
  } };
}
