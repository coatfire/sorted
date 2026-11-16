import { PDFDocument, PDFString, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { formatPhone, type BookingDocumentData } from "@sorted/core";
import fontUrl from "../assets/DejaVuSans.ttf?url";

let fontBytes: Promise<ArrayBuffer> | undefined;

export async function createBookingPdf(data: BookingDocumentData): Promise<Blob> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  fontBytes ??= fetch(fontUrl).then((response) => {
    if (!response.ok) throw new Error("Couldn't load the PDF font. Try again.");
    return response.arrayBuffer();
  }).catch((error: unknown) => { fontBytes = undefined; throw error; });
  const font = await pdf.embedFont(await fontBytes, { subset: true });
  const accent = rgb(...[1, 3, 5].map((start) => parseInt(data.accent.slice(start, start + 2), 16) / 255) as [number, number, number]);
  const ink = rgb(0.11, 0.11, 0.1);
  const muted = rgb(0.36, 0.36, 0.34);
  const margin = 44;
  const width = 595.28;
  const height = 841.89;
  const contentWidth = width - margin * 2;
  let page = pdf.addPage([width, height]);
  let y = height - margin;
  const nextPage = () => {
    page = pdf.addPage([width, height]);
    page.drawText(`${data.number} — continued`, { x: margin, y: height - 28, font, size: 9, color: muted });
    y = height - margin - 10;
  };
  const room = (space: number) => { if (y - space < 48) nextPage(); };
  const wrap = (value: string, size: number, available = contentWidth) => value.replace(/\r/g, "").split("\n").flatMap((paragraph) => {
    const lines: string[] = [];
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > available) { lines.push(line); line = ""; }
      for (const character of (line ? " " : "") + word) {
        if (font.widthOfTextAtSize(line + character, size) > available) { lines.push(line); line = ""; }
        line += character;
      }
    }
    lines.push(line);
    return lines;
  });
  const text = (value: string | null, size = 11, color = ink) => {
    if (!value) return;
    for (const line of wrap(value, size)) {
      room(size * 1.5);
      page.drawText(line, { x: margin, y, font, size, color });
      y -= size * 1.5;
    }
  };
  const rule = () => {
    room(20);
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, color: accent, thickness: 1.5 });
    y -= 20;
  };
  const row = (label: string, value: string, size = 11) => {
    const valueWidth = font.widthOfTextAtSize(value, size);
    const lines = wrap(label, size, contentWidth - valueWidth - 24);
    room(size * 1.6);
    page.drawText(value, { x: width - margin - valueWidth, y, font, size, color: ink });
    for (const line of lines) {
      room(size * 1.6);
      page.drawText(line, { x: margin, y, font, size, color: ink });
      y -= size * 1.6;
    }
  };

  if (data.logo) {
    const logo = data.logo.startsWith("data:image/png;") ? await pdf.embedPng(data.logo) : await pdf.embedJpg(data.logo);
    const scaled = logo.scaleToFit(120, 60);
    page.drawImage(logo, { x: margin, y: y - scaled.height, ...scaled });
    y -= scaled.height + 18;
  }
  text(data.business.name, 19, accent);
  text(data.business.address, 10);
  text([formatPhone(data.business.phone), data.business.email].filter(Boolean).join(" · "), 10);
  if (data.vat && data.business.vatNumber) text(`VAT number: ${data.business.vatNumber}`, 10);
  y -= 16;
  rule();
  if (data.voided) text("VOID — payment undone", 24, rgb(0.7, 0.1, 0.1));
  text(`${data.title} ${data.number}`, 20, accent);
  text(`Issued: ${data.issuedDate}`, 10, muted);
  if (data.validUntil) text(`Valid until: ${data.validUntil}`, 10, muted);
  y -= 14;
  text(data.kind === "receipt" ? "Received from" : data.kind === "quote" ? "Quote for" : "Bill to", 12, accent);
  text(data.client.name);
  text([data.client.email, formatPhone(data.client.phone)].filter(Boolean).join(" · "), 10);
  y -= 12;
  text(`Booking date: ${data.bookingDate}`, 10, muted);
  y -= 10;
  rule();
  row(data.lineItem.description, data.lineItem.amount);
  y -= 12;
  if (data.vat) {
    row("Net", data.vat.net);
    row(`VAT at ${data.vat.rate}`, data.vat.amount);
  }
  row(data.vat ? "Total including VAT" : "Total", data.total, 14);
  y -= 12;
  if (data.kind === "quote") {
    if (data.deposit) row("Deposit", data.deposit);
    text(data.confirmationLine, 12, accent);
  } else if (data.kind === "invoice") {
    row("Paid to date", data.paidToDate);
    row("Balance due", data.balanceDue);
    y -= 16;
    if (data.iban || data.bic) text("Bank details", 12, accent);
    if (data.iban) text(`IBAN: ${data.iban}`, 10);
    if (data.bic) text(`BIC: ${data.bic}`, 10);
  } else {
    text("Payments received", 12, accent);
    for (const payment of data.payments) row(`${payment.date} · ${payment.method}`, payment.amount, 10);
    y -= 12;
    if (!data.voided) text("Paid — thank you", 14, accent);
    row("Booking total", data.bookingTotal, 10);
    row("Balance remaining", data.balanceDue, 10);
  }
  if (data.kind !== "receipt" && data.revolutLink) {
    const label = `Pay by Revolut: ${data.revolutLink}`;
    for (const line of wrap(label, 10)) {
      room(15);
      page.drawText(line, { x: margin, y, font, size: 10, color: accent });
      const annotation = pdf.context.obj({
        Type: "Annot", Subtype: "Link", Rect: [margin, y - 2, margin + font.widthOfTextAtSize(line, 10), y + 11],
        Border: [0, 0, 0], A: { S: "URI", URI: PDFString.of(data.revolutLink) },
      });
      page.node.addAnnot(pdf.context.register(annotation));
      y -= 15;
    }
  }
  if (data.footer) {
    const lines = wrap(data.footer, 9);
    const space = lines.length * 13.5 + 20;
    if (space < height - margin * 2 - 60) {
      if (y - space < 60) nextPage();
      y = 60 + space;
      rule();
    } else { y -= 20; }
    text(data.footer, 9, muted);
  }
  pdf.getPages().forEach((item, index, pages) => {
    if (data.voided) item.drawText("VOID", { x: width - margin - 55, y: height - 28, size: 14, font, color: rgb(0.7, 0.1, 0.1) });
    item.drawText(`${data.number} · ${index + 1} / ${pages.length}`, { x: margin, y: 24, size: 8, font, color: muted });
  });
  pdf.setTitle(`${data.voided ? "VOID " : ""}${data.title} ${data.number}`);
  pdf.setAuthor(data.business.name);
  const bytes = await pdf.save();
  const buffer = new Uint8Array(bytes.length);
  buffer.set(bytes);
  return new Blob([buffer.buffer], { type: "application/pdf" });
}
