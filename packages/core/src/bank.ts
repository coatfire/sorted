export const normaliseIban = (value: string) => value.replace(/\s/g, "").toUpperCase();

export function validIban(value: string) {
  const iban = normaliseIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  let remainder = 0;
  for (const char of iban.slice(4) + iban.slice(0, 4)) {
    const digits = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export const normaliseBic = (value: string) => value.toUpperCase();
export const validBic = (value: string) => /^(?:[A-Z0-9]{8}|[A-Z0-9]{11})$/.test(normaliseBic(value));
