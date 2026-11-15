/// <reference path="../../web/src/vite-env.d.ts" />
import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { PDFPage } from "../../web/node_modules/pdf-lib";
import { createBookingPdf } from "../../web/src/lib/bookingPdf";
import type { BookingDocumentData } from "@sorted/core";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["invoice", "receipt", "quote"] as const)("renders only Total, with no VAT wording, on a non-VAT %s", async kind => {
  const font = await readFile(new URL("../../web/src/assets/DejaVuSans.ttf", import.meta.url));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(font)));
  const draw = vi.spyOn(PDFPage.prototype, "drawText");
  const data: BookingDocumentData = {
    kind, title: kind, number: "TEST-0001", issuedDate: "15 Nov 2026", bookingDate: "14 Nov 2026",
    validUntil: null, deposit: null, confirmationLine: null,
    business: { name: "Test business", email: "test@example.com", address: null, phone: null, vatNumber: "IE1234567AB" },
    client: { name: "Test client", email: null, phone: null }, logo: null, accent: "#14532D", footer: "",
    lineItem: { description: "Service", amount: "€80.00" }, total: "€80.00", vat: null,
    bookingTotal: "€80.00", paidToDate: "€80.00", balanceDue: "€0.00", iban: null, bic: null, payments: [],
  };
  expect((await createBookingPdf(data)).size).toBeGreaterThan(0);
  const labels = draw.mock.calls.map(([text]) => text);
  expect(labels).toContain("Total");
  expect(labels).not.toContain("Net");
  expect(labels.some(label => /VAT|including VAT/.test(label))).toBe(false);
});
