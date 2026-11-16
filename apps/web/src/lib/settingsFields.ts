import { DEFAULT_BOOKING_CONFIRMATION_TEMPLATE, DEFAULT_PAYMENT_REQUEST_TEMPLATE, DEFAULT_INVOICE_ACCENT, InvoiceAccent, IrishVatNumber, formatPhone, normalisePhone, percentToBasisPoints, type User } from "@sorted/core";
import { paymentDetails } from "./setup";
import type { UserChanges } from "./settingsAutosave";

export function settingsForm(user: User) {
  return { businessName: user.businessName ?? "", name: user.name ?? "", phone: formatPhone(user.phone), address: user.address ?? "", reviewLink: user.reviewLink ?? "", iban: user.iban ?? "", bic: user.bic ?? "", revolutLink: user.revolutLink ?? "", invoiceAccent: user.invoiceAccent ?? DEFAULT_INVOICE_ACCENT, invoiceFooter: user.invoiceFooter ?? "", bookingConfirmationTemplate: user.bookingConfirmationTemplate ?? DEFAULT_BOOKING_CONFIRMATION_TEMPLATE, paymentRequestTemplate: user.paymentRequestTemplate ?? DEFAULT_PAYMENT_REQUEST_TEMPLATE, vatRegistered: user.vatRegistered, vatRateChoice: user.vatRateBp == null ? "2300" : [2300, 1350, 900].includes(user.vatRateBp) ? String(user.vatRateBp) : "custom", vatCustomPercent: user.vatRateBp == null ? "" : String(user.vatRateBp / 100), vatPeriodMonths: String(user.vatPeriodMonths ?? 2), incomeTaxPercent: user.incomeTaxRateBp == null ? "" : String(user.incomeTaxRateBp / 100), vatNumber: user.vatNumber ?? "" };
}
export type SettingsForm = ReturnType<typeof settingsForm>;
export type SettingsField = keyof SettingsForm;
export function fieldPatch(field: SettingsField, form: SettingsForm): { patch: UserChanges | null; error?: string } {
  const text = String(form[field]).trim();
  const ok = (patch: UserChanges) => ({ patch });
  const invalid = (error: string) => ({ patch: null, error });
  switch (field) {
    case "businessName": return text ? ok({ businessName: text }) : invalid("Enter your business name.");
    case "name": return ok({ name: text || null });
    case "phone": return text && !normalisePhone(text) ? invalid("Enter a mobile number, like 087 123 4567.") : ok({ phone: text ? normalisePhone(text) : null });
    case "address": return ok({ address: text || null });
    case "reviewLink": {
      if (!text) return ok({ reviewLink: null });
      const link = /^https?:\/\//i.test(text) ? text : `https://${text}`;
      try { const url = new URL(link); return ["https:", "http:"].includes(url.protocol) ? ok({ reviewLink: link }) : invalid("Enter a web address."); }
      catch { return invalid("Enter a web address."); }
    }
    case "iban": case "bic": case "revolutLink": {
      const details = paymentDetails(form);
      return details.errors[field] ? invalid(details.errors[field]!) : ok({ [field]: details.patch[field] });
    }
    case "invoiceAccent": return InvoiceAccent.safeParse(text).success ? ok({ invoiceAccent: InvoiceAccent.parse(text) === DEFAULT_INVOICE_ACCENT ? null : InvoiceAccent.parse(text) }) : invalid("Choose a colour.");
    case "invoiceFooter": return ok({ invoiceFooter: text || null });
    case "bookingConfirmationTemplate": return ok({ bookingConfirmationTemplate: form[field] === DEFAULT_BOOKING_CONFIRMATION_TEMPLATE ? null : form[field] });
    case "paymentRequestTemplate": return ok({ paymentRequestTemplate: form[field] === DEFAULT_PAYMENT_REQUEST_TEMPLATE ? null : form[field] });
    case "vatRegistered": {
      if (!form.vatRegistered) return ok({ vatRegistered: false });
      const rate = fieldPatch("vatRateChoice", form);
      return rate.patch ? ok({ vatRegistered: true, ...rate.patch }) : rate;
    }
    case "vatRateChoice": case "vatCustomPercent": {
      const rate = form.vatRateChoice === "custom" ? percentToBasisPoints(form.vatCustomPercent, 3000) : Number(form.vatRateChoice);
      return rate === null || !Number.isFinite(rate) ? invalid("Enter a VAT rate from 0 to 30%.") : ok({ vatRateBp: rate });
    }
    case "vatPeriodMonths": return ok({ vatPeriodMonths: Number(text) });
    case "incomeTaxPercent": {
      const rate = text ? percentToBasisPoints(text) : null;
      return text && rate === null ? invalid("Enter a rate from 0 to 100%.") : ok({ incomeTaxRateBp: rate });
    }
    case "vatNumber": return !text || IrishVatNumber.safeParse(text).success ? ok({ vatNumber: text ? IrishVatNumber.parse(text) : null }) : invalid("Enter a valid Irish VAT number.");
  }
}
