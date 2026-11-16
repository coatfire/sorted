import { spawn } from "node:child_process";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("renders client due-now balances from booking prices minus paid, including undone full payments", async () => {
  const client = { id: "client", name: "Áine Murphy", phone: "353871234567", email: null };
  const booking = { id: "booking", clientId: client.id, client, service: "Hair", priceCents: 8000, depositCents: 2000, status: "completed", startAt: "2026-11-14T10:00:00Z" };
  const payment = { id: "payment", bookingId: booking.id, status: "cancelled", amountCents: 8000, paidAt: "2026-11-14T10:00:00Z" };
  const cases = [
    { bookings: [booking], payments: [payment], owed: "€80.00", paid: "€0.00" },
    { bookings: [booking], payments: [], owed: "€80.00", paid: "€0.00" },
    { bookings: [booking], payments: [{ ...payment, status: "paid", amountCents: 2500 }, { ...payment, id: "pending-1", status: "pending", paidAt: null }, { ...payment, id: "pending-2", status: "pending", paidAt: null }], owed: "€55.00", paid: "€25.00" },
    { bookings: [], payments: [payment], owed: "€0.00", paid: "€0.00" },
    { bookings: [{ ...booking, clientId: "other" }], payments: [payment], owed: "€0.00", paid: "€0.00" },
    { bookings: [{ ...booking, status: "enquiry" }, { ...booking, id: "cancelled", status: "cancelled" }], payments: [], owed: "€0.00", paid: "€0.00" },
    { bookings: [{ ...booking, status: "confirmed", startAt: "2026-11-16T10:00:00Z" }], payments: [], owed: "€0.00", paid: "€0.00" },
    { bookings: [booking], payments: [{ ...payment, status: "paid" }], owed: "€0.00", paid: "€80.00" },
  ];
  const bundle = await build({
    stdin: {
      contents: `import {createElement} from "react"; import {renderToStaticMarkup} from "react-dom/server";
        import {MemoryRouter, Routes, Route} from "react-router-dom"; import {ClientDetail} from "./pages/ClientDetail";
        export function render(snapshot) {
          globalThis.__snapshot = snapshot;
          const RealDate = Date;
          globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ["2026-11-15T12:00:00Z"])); } static now() { return RealDate.parse("2026-11-15T12:00:00Z"); } };
          try { return renderToStaticMarkup(createElement(MemoryRouter, {initialEntries: ["/clients/client"]}, createElement(Routes, null, createElement(Route, {path: "/clients/:id", element: createElement(ClientDetail)})))); }
          finally { globalThis.Date = RealDate; }
        }`,
      resolveDir: new URL("../../web/src", import.meta.url).pathname, loader: "tsx",
    },
    plugins: [{ name: "client-store", setup(build) {
      build.onResolve({ filter: /lib\/store$/ }, () => ({ path: "store", namespace: "client-test" }));
      build.onLoad({ filter: /.*/, namespace: "client-test" }, () => ({ contents: `export const useData = () => globalThis.__snapshot;
        export const useStore = () => ({backend: {}, toast: () => {}});
        export const useAction = () => ({busy: false, error: null, committed: false, run: () => {}});` }));
    } }],
    bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false, external: ["./bookingPdf"],
  });
  const snapshots = cases.map(item => ({ ...item, clients: [client], documents: [], user: { reviewLink: null } }));
  const html = await new Promise<string[]>((resolve, reject) => {
    const child = spawn(process.execPath, ["-"], { stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [], errors: Buffer[] = [];
    child.stdout.on("data", chunk => output.push(chunk)); child.stderr.on("data", chunk => errors.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) return reject(new Error(Buffer.concat(errors).toString()));
      try { resolve(JSON.parse(Buffer.concat(output).toString()) as string[]); } catch (error) { reject(error); }
    });
    child.stdin.end(`${bundle.outputFiles[0].text}\nprocess.stdout.write(JSON.stringify(${JSON.stringify(snapshots)}.map(snapshot => module.exports.render(snapshot))));`);
  });
  for (const [index, item] of cases.entries()) {
    expect(html[index]).toContain("087 123 4567");
    expect(html[index]).toContain("https://wa.me/353871234567?text=");
    expect(html[index].split("Owes you</span>")[1].split("</div>")[0]).toContain(item.owed);
    expect(html[index].split("Paid to date</span>")[1].split("</div>")[0]).toContain(item.paid);
  }
}, 15000);
