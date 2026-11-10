import type { ExpenseCategory, MessageLogEntry, Payment } from "@sorted/core";

export const euros = (cents: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(cents / 100);

/** "12,50" / "€12.5" / "1,250.00" → cents, or null if it isn't money. */
export function parseEuros(input: string): number | null {
  let text = input.replace(/[€\s]/g, "");
  if (!text) return null;
  // A lone comma is a decimal comma; with a dot present, commas are thousands.
  text = text.includes(".") ? text.replace(/,/g, "") : text.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

export const centsToInput = (cents: number) =>
  cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);

const fmt = (options: Intl.DateTimeFormatOptions) => {
  const formatter = new Intl.DateTimeFormat("en-IE", options);
  return (value: string | Date) => formatter.format(new Date(value));
};

export const time = fmt({ hour: "2-digit", minute: "2-digit", hour12: false });
export const longDay = fmt({ weekday: "long", day: "numeric", month: "long" });
export const shortDay = fmt({ weekday: "short", day: "numeric", month: "short" });
export const dayMonth = fmt({ day: "numeric", month: "short" });
export const monthYear = fmt({ month: "long", year: "numeric" });
export const stamp = fmt({ weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

export const startOfDay = (date = new Date()) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

export const daysBetween = (from: Date, to: Date) =>
  Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);

/** Human dates: "Today", "Tomorrow", "Thu 16 Jul". */
export function dayLabel(value: string | Date) {
  const diff = daysBetween(new Date(), new Date(value));
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return shortDay(value);
}

/** Local-time values for <input type="date"> / <input type="time">. */
const pad = (n: number) => String(n).padStart(2, "0");
export const toDateInput = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const toTimeInput = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export const CATEGORIES: Array<{ value: ExpenseCategory; label: string }> = [
  { value: "materials", label: "Materials" },
  { value: "travel", label: "Travel" },
  { value: "equipment", label: "Equipment" },
  { value: "software", label: "Software" },
  { value: "phone_internet", label: "Phone & internet" },
  { value: "insurance", label: "Insurance" },
  { value: "training", label: "Training" },
  { value: "marketing", label: "Marketing" },
  { value: "other", label: "Other" },
];
export const categoryLabel = (value: ExpenseCategory | null) =>
  CATEGORIES.find((category) => category.value === value)?.label ?? "Uncategorised";

export const kindLabel = (kind: Payment["kind"]) =>
  ({ deposit: "Deposit", balance: "Balance", full: "Full payment", custom: "Payment" })[kind];

export const methodLabel = (method: Payment["method"]) =>
  method
    ? { stripe: "Card (Stripe)", revolut: "Revolut", cash: "Cash", bank_transfer: "Bank transfer" }[method]
    : null;

export const messageLabel = (message: MessageLogEntry) => {
  const what = {
    confirmation: "Confirmation",
    reminder: "Reminder",
    payment_request: "Payment request",
    review_request: "Review request",
  }[message.template];
  return message.status === "failed" ? `${what} failed to send` : `${what} sent`;
};

/** wa.me deep link — lets the trader send from their own WhatsApp. */
export const whatsappLink = (phone: string, text: string) =>
  `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

/** Buttons say what happens — including when no message will go out. */
export function confirmCopy(
  client: { name: string; phone: string | null },
  automation: boolean,
): { label: string; caption?: string } {
  if (!client.phone) {
    return { label: "Confirm booking", caption: "No mobile on file — no message will be sent." };
  }
  if (!automation) {
    return {
      label: "Confirm booking",
      caption: `Automatic WhatsApp messages aren’t connected yet — you can message ${firstName(client.name)} yourself from the booking.`,
    };
  }
  return { label: `Confirm & notify ${firstName(client.name)}` };
}
