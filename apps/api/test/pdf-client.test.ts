/// <reference path="../../web/src/vite-env.d.ts" />
import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { PDFPage, PDFDocument, PDFDict, PDFName, PDFString } from "../../web/node_modules/pdf-lib";
import { createBookingPdf } from "../../web/src/lib/bookingPdf";
import type { BookingDocumentData } from "@sorted/core";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("marks a voided receipt clearly on every PDF page without changing frozen figures", async () => {
  const font = await readFile(new URL("../../web/src/assets/DejaVuSans.ttf", import.meta.url));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(font)));
  const draw = vi.spyOn(PDFPage.prototype, "drawText"), data = { ...documentData("receipt"), voided: true };
  const pdf = await PDFDocument.load(await (await createBookingPdf(data)).arrayBuffer());
  expect(pdf.getTitle()).toBe("VOID receipt TEST-0001");
  expect(draw.mock.calls.map(([text]) => text)).toContain("VOID — payment undone");
  expect(draw.mock.calls.filter(([text]) => text === "VOID")).toHaveLength(pdf.getPageCount());
  expect(draw.mock.calls.map(([text]) => text)).not.toContain("Paid — thank you");
  expect(draw.mock.calls.map(([text]) => text)).toContain("€80.00");
});

function documentData(kind: BookingDocumentData["kind"]): BookingDocumentData {
  return {
    kind, title: kind, number: "TEST-0001", issuedDate: "15 Nov 2026", bookingDate: "14 Nov 2026",
    validUntil: null, deposit: null, confirmationLine: null,
    business: { name: "Test business", email: "test@example.com", address: null, phone: null, vatNumber: "IE1234567AB" },
    client: { name: "Test client", email: null, phone: null }, logo: null, accent: "#14532D", footer: "",
    lineItem: { description: "Service", amount: "€80.00" }, total: "€80.00", vat: null, revolutLink: null,
    bookingTotal: "€80.00", paidToDate: "€80.00", balanceDue: "€0.00", iban: null, bic: null, payments: [],
  };
}

it.each(["invoice", "receipt", "quote"] as const)("renders only Total, with no VAT wording, on a non-VAT %s", async kind => {
  const font = await readFile(new URL("../../web/src/assets/DejaVuSans.ttf", import.meta.url));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(font)));
  const draw = vi.spyOn(PDFPage.prototype, "drawText");
  const data = documentData(kind);
  expect((await createBookingPdf(data)).size).toBeGreaterThan(0);
  const labels = draw.mock.calls.map(([text]) => text);
  expect(labels).toContain("Total");
  expect(labels).not.toContain("Net");
  expect(labels.some(label => /VAT|including VAT/.test(label))).toBe(false);
  expect(labels.some(label => /Revolut/.test(label))).toBe(false);
});

it.each(["invoice", "quote", "receipt"] as const)("renders a clickable Revolut line on %s unless already paid", async kind => {
  const font = await readFile(new URL("../../web/src/assets/DejaVuSans.ttf", import.meta.url));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(font)));
  const draw = vi.spyOn(PDFPage.prototype, "drawText");
  const data = { ...documentData(kind), revolutLink: "https://revolut.me/studio" };
  const blob = await createBookingPdf(data);
  const pdf = await PDFDocument.load(await blob.arrayBuffer());
  const annotations = pdf.getPages().flatMap(page => page.node.Annots()?.asArray() ?? []);
  const labels = draw.mock.calls.map(([text]) => text);
  if (kind === "receipt") {
    expect(annotations).toEqual([]);
    expect(labels.some(label => label.includes("Revolut"))).toBe(false);
  } else {
    expect(labels).toContain(`Pay by Revolut: ${data.revolutLink}`);
    expect(annotations).toHaveLength(1);
    const annotation = pdf.context.lookup(annotations[0], PDFDict);
    expect(annotation.lookup(PDFName.of("A"), PDFDict).lookup(PDFName.of("URI"), PDFString).decodeText()).toBe(data.revolutLink);
  }
});
