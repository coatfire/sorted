import { IrishVatNumber } from "@sorted/core";

export function vatNumberUpdate(registered: boolean, value: string) {
  return registered ? { vatNumber: value.trim() ? IrishVatNumber.parse(value) : null } : {};
}
