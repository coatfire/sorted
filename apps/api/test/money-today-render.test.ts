import { spawn } from "node:child_process";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("renders matching due-now totals, a leading appointment and secondary yearly tax disclosure", async () => {
  const client = { id: "client", name: "Áine Murphy", phone: null, email: null };
  const booking = { id: "owed", clientId: client.id, client, service: "Hair", priceCents: 8000, depositCents: 2000, status: "completed", startAt: "2026-11-14T10:00:00Z", endAt: null, followUpOn: null, paymentRequestedAt: null };
  const snapshot = { user: { name: "Trader", businessName: "Studio", vatRegistered: false, vatRateBp: null, vatPeriodMonths: 2, incomeTaxRateBp: 2000 }, features: { paymentLinks: true, automation: false }, expenses: [], bookings: [booking, { ...booking, id: "future", status: "confirmed", startAt: "2026-11-16T10:00:00Z", location: "Cork City" }], payments: [{ id: "paid", bookingId: "owed", status: "paid", amountCents: 2500, paidAt: "2026-11-10T10:00:00Z", vatRateBp: 0 }] };
  const empty = { ...snapshot, bookings: [], payments: [] };
  const bundle = await build({
    stdin: {
      contents: `import {createElement} from "react"; import {renderToStaticMarkup} from "react-dom/server"; import {MemoryRouter} from "react-router-dom";
        import {Home} from "./pages/Home"; import {Money} from "./pages/Money";
        export function render(screen, snapshot) {
          globalThis.__snapshot = snapshot;
          const RealDate = Date;
          globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ["2026-11-15T12:00:00Z"])); } static now() { return RealDate.parse("2026-11-15T12:00:00Z"); } };
          try { return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(screen === "home" ? Home : Money))); }
          finally { globalThis.Date = RealDate; }
        }`,
      resolveDir: new URL("../../web/src", import.meta.url).pathname,
      loader: "tsx",
    },
    plugins: [{ name: "screen-store", setup(build) {
      build.onResolve({ filter: /lib\/store$/ }, () => ({ path: "store", namespace: "screen-test" }));
      build.onLoad({ filter: /.*/, namespace: "screen-test" }, () => ({ contents: `export const useData = () => globalThis.__snapshot;
        export const useStore = () => ({backend: {}, toast: () => {}});
        export const useAction = () => ({busy: false, error: null, committed: false, run: () => {}});` }));
    } }],
    bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false,
  });
  const html = await new Promise<string[]>((resolve, reject) => {
    const child = spawn(process.execPath, ["-"], { stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [], errors: Buffer[] = [];
    child.stdout.on("data", chunk => output.push(chunk));
    child.stderr.on("data", chunk => errors.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) return reject(new Error(Buffer.concat(errors).toString()));
      try { resolve(JSON.parse(Buffer.concat(output).toString()) as string[]); } catch (error) { reject(error); }
    });
    child.stdin.end(`${bundle.outputFiles[0].text}\nprocess.stdout.write(JSON.stringify(${JSON.stringify([["home", snapshot], ["money", snapshot], ["home", empty], ["money", empty]])}.map(([screen,snapshot]) => module.exports.render(screen,snapshot))));`);
  });
  const [home, money, emptyHome, emptyMoney] = html;
  expect(home.indexOf("Next appointment")).toBeLessThan(home.indexOf("Needs attention"));
  expect(home).toContain("Tomorrow, 10:00");
  expect(home).toContain("€20.00 deposit due");
  expect(home).toContain("destination=Cork%20City");
  expect(home).toContain("€55.00 owed by 1 client");
  expect(home).not.toContain("snapshot-card");
  expect(home).not.toContain("bar-chart");
  expect(money).toContain('class="money money-hero">€55.00');
  expect(money).toContain("Due now across 1 booking");
  expect(money).toContain("€80.00 expected");
  expect(money.match(/class="card owed-card/g)).toHaveLength(2);
  expect(money).toContain("Balance · job was 1 day ago");
  expect(money).toContain("Full payment · job on Mon 16 Nov");
  expect(money.indexOf("2026 so far")).toBeLessThan(money.indexOf("Tax estimate (rough guide)"));
  expect(money).toContain('<details class="tax-guide"><summary>Tax estimate (rough guide)</summary>');
  expect(money).not.toContain('<details class="tax-guide" open');
  const taxSummary = money.split("Tax estimate (rough guide)</summary>")[1].split('<details class="tax-workings">')[0];
  expect(taxSummary).not.toContain("Paid income");
  expect(taxSummary).not.toContain("Expenses");
  expect(taxSummary).not.toContain("profit");
  expect(emptyHome).toContain("No appointments ahead");
  expect(emptyHome).not.toContain("Needs attention");
  expect(emptyMoney).not.toContain("Coming up");
  expect(emptyMoney).toContain("Nobody owes you anything. Lovely.");
}, 15000);
