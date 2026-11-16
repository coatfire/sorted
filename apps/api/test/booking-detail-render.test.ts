import { spawn } from "node:child_process";
import { build } from "esbuild";
import { expect, it } from "vitest";
import { bookingStage, type BookingStatus } from "@sorted/core";

it("renders every booking stage with at most one primary and its expected next-step action", async () => {
  const cases = [
    { status: "enquiry", paid: 0, primary: "Confirm booking", next: ["Quote", "Change follow-up"] },
    { status: "enquiry", paid: 0, incomplete: true, primary: "Confirm booking", next: ["Quote", "Change follow-up"] },
    { status: "confirmed", paid: 2500, primary: "Add payment", next: ["Ask for payment"] },
    { status: "confirmed", paid: 8000, primary: null, next: ["Booking confirmed", "All set"] },
    { status: "confirmed", paid: 0, futureToday: true, primary: "Add payment", next: ["Booking confirmed", "Get ready for", "Ask for payment"] },
    { status: "confirmed", paid: 8000, futureToday: true, primary: null, next: ["Booking confirmed", "All set"] },
    { status: "confirmed", paid: 2500, today: true, primary: "Mark complete", next: ["Add payment"] },
    { status: "confirmed", paid: 8000, today: true, primary: "Mark complete", next: [] },
    { status: "completed", paid: 2500, primary: "Add payment", next: ["Ask for payment"] },
    { status: "completed", paid: 8000, primary: "Book again", next: ["Receipt"] },
    { status: "cancelled", paid: 2500, primary: null, next: ["Book again"] },
    { status: "enquiry", paid: 0, automation: true, primary: "Confirm &amp; notify Áine", next: ["Quote"] },
    { status: "completed", paid: 0, price: 0, primary: "Book again", next: ["Receipt"] },
  ] satisfies { status: BookingStatus; paid: number; incomplete?: boolean; today?: boolean; futureToday?: boolean; price?: number; automation?: boolean; primary: string | null; next: string[] }[];
  const props = cases.map(item => {
    const booking = {
      id: "booking", status: item.status, service: "Gel nails", priceCents: item.incomplete ? null : item.price ?? 8000,
      startAt: item.incomplete ? null : item.today ? "2026-11-15T10:00:00Z" : item.futureToday ? "2026-11-15T22:00:00Z" : "2026-11-18T10:00:00Z", followUpOn: "2026-11-17",
      client: { name: "Áine Murphy", phone: "+353871234567" },
    };
    return { booking, ...bookingStage(booking, [{ bookingId: booking.id, amountCents: item.paid, status: "paid" }], new Date("2026-11-15T12:00:00Z")), depositCents: 2000, hasPaidPayment: item.paid > 0, automation: item.automation ?? false, busy: false, documentBusy: false };
  });
  const bundle = await build({
    stdin: {
      contents: `import {createElement} from "react"; import {renderToStaticMarkup} from "react-dom/server"; import {BookingSteps} from "./BookingSteps";
        export function render(props) { return renderToStaticMarkup(createElement(BookingSteps, {...props, onAction: () => {}})); }`,
      resolveDir: new URL("../../web/src", import.meta.url).pathname,
      loader: "tsx",
    },
    bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false,
  });
  const html = await new Promise<string[]>((resolve, reject) => {
    const child = spawn(process.execPath, ["-"], { stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", chunk => output.push(chunk));
    child.stderr.on("data", chunk => errors.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) return reject(new Error(Buffer.concat(errors).toString()));
      try { resolve(JSON.parse(Buffer.concat(output).toString()) as string[]); } catch (error) { reject(error); }
    });
    child.stdin.end(`${bundle.outputFiles[0].text}\nprocess.stdout.write(JSON.stringify(${JSON.stringify(props)}.map(props => module.exports.render(props))));`);
  });
  for (const [index, item] of cases.entries()) {
    const content = html[index];
    const next = content.split('<section class="card next-step-card">')[1].split("</section>")[0];
    const more = content.split('<section class="card booking-more-list">')[1].split("</section>")[0];
    const primary = [...content.matchAll(/<button[^>]*class="[^"]*\bbutton-primary\b[^"]*"[^>]*>([\s\S]*?)<\/button>/g)];
    expect(primary.length, `${item.status} primary count`).toBe(item.primary ? 1 : 0);
    if (item.primary) expect(primary[0][1]).toContain(item.primary);
    for (const label of item.next) expect(next).toContain(label);
    expect(more).not.toContain("button-primary");
    expect(more).toContain(item.status === "enquiry" ? "Quote" : "Invoice");
    expect(content).not.toContain("Request payment");
    if (item.status === "enquiry") {
      expect(more).not.toContain("Invoice");
      if (!item.incomplete) expect(more).toContain("Ask for payment");
      expect(next).toContain("Follow up on");
      if (item.incomplete) {
        const cancel = [...more.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(match => match[2].includes("Cancel enquiry"));
        expect(cancel).toBeDefined();
        expect(cancel![1]).not.toContain("disabled");
        expect(content).toContain("cancel this enquiry as it is");
        expect(content).not.toContain("before confirming or cancelling");
        expect(more).not.toContain("Add to calendar");
      }
    }
    if (item.status === "confirmed") {
      expect(content.match(/Mark complete/g)).toHaveLength(1);
      expect(content.match(/Add payment/g)).toHaveLength(1);
      if (!item.today) expect(more).toContain("Mark complete");
      expect(next).toContain(item.today ? "Ready to finish?" : "Booking confirmed");
      if (!item.today) expect(next).not.toContain("Ready to finish?");
    }
    if (item.status === "completed") {
      expect(content).not.toContain("Mark complete");
      expect(content).not.toContain("Cancel booking");
      expect(content.match(/Add payment/g)).toHaveLength(1);
    }
    if (item.status === "cancelled") {
      expect(content).not.toContain("Add to calendar");
      expect(content).not.toContain("Send confirmation");
      expect(content).not.toContain("Add payment");
      expect(content).not.toContain("Ask for payment");
    }
    if (item.status === "confirmed" || item.status === "enquiry") expect(more).toMatch(/Cancel (booking|enquiry)<\/span><\/button>$/);
    if (item.paid === 0) expect(content).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Receipt/);
  }
}, 15000);
