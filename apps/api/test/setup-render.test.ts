import { spawn } from "node:child_process";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("renders a minimal welcome, payment-details gating, named swatches and a friendly preview", async () => {
  const snapshot = { user: { name: null, businessName: "Studio by Aoife", services: [], iban: null, bic: null, revolutLink: null, vatRegistered: false }, features: { paymentLinks: false }, bookings: [], payments: [], expenses: [] };
  const bundle = await build({ stdin: {
    contents: `import {createElement as h} from "react"; import {renderToStaticMarkup} from "react-dom/server"; import {MemoryRouter} from "react-router-dom";
      import {Settings} from "./pages/Settings"; import {Home} from "./pages/Home"; import {BookingMessageSheet} from "./BookingMessageSheet";
      import {AccentPicker} from "./AccentPicker"; import {MessageEditor} from "./MessageEditor";
      import {ServiceEditor} from "./ServiceEditor";
      export function render(screen,snapshot,extra={}) { globalThis.__snapshot=snapshot;const noop=()=>{};
        const booking={id:'booking',clientId:'client',client:{name:'Client',phone:null,email:null},service:'Gel nails',startAt:'2026-11-18T10:00:00Z',priceCents:8000,depositCents:2000,...extra};
        const element=screen==='welcome'?h(Settings,{welcome:true}):screen==='settings'?h(Settings):screen==='home'?h(Home):screen==='swatches'?h(AccentPicker,{value:'#6B315D',onChange:noop}):screen==='services'?h(ServiceEditor,{rows:extra.rows,onChange:noop}):screen==='editor'?h(MessageEditor,{label:'Payment request',name:'template',value:'Hi {client}, your {service} costs {balance}.',onChange:noop,onBlur:noop,onReset:noop,user:snapshot.user,kind:'payment_request'}):h(BookingMessageSheet,{booking,kind:screen==='deposit'?'confirmation':'payment_request',onClose:noop});
        return renderToStaticMarkup(h(MemoryRouter,null,element)); }`,
    resolveDir: new URL("../../web/src", import.meta.url).pathname, loader: "tsx",
  }, bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false, external: ["*.ttf?url"], define: { "import.meta.env": "{}" },
    plugins: [{ name: "setup-store", setup(build) {
      build.onResolve({ filter: /lib\/store$|\.\/store$/ }, () => ({ path: "store", namespace: "setup-test" }));
      build.onLoad({ filter: /.*/, namespace: "setup-test" }, () => ({ contents: `export const useData=()=>globalThis.__snapshot;
        export const useSession=()=>({mode:'demo',signOut:()=>{}});export const useStore=()=>({backend:{},refresh:async()=>{},toast:()=>{}});
        export const useAction=()=>({busy:false,error:null,committed:false,run:()=>{}});` }));
    } }],
  });
  const cases: [string, object, object?][] = [["welcome", snapshot], ["settings", snapshot], ["home", snapshot], ["payment", snapshot], ["payment", { ...snapshot, user: { ...snapshot.user, iban: "IE29AIBK93115212345678" } }], ["payment", { ...snapshot, user: { ...snapshot.user, revolutLink: "https://revolut.me/aoife" } }], ["deposit", snapshot], ["deposit", snapshot, { depositCents: 0 }], ["swatches", snapshot], ["editor", snapshot]];
  cases.push(["services", snapshot, { rows: [{ id: "existing", name: "New name", price: "", lastComplete: { name: "Gel nails", priceCents: 3500 } }, { id: "new", name: " GEL NAILS ", price: "45" }] }]);
  const html = await new Promise<string[]>((resolve, reject) => {
    const child = spawn(process.execPath, ["-"], { stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [], errors: Buffer[] = [];
    child.stdout.on("data", chunk => output.push(chunk)); child.stderr.on("data", chunk => errors.push(chunk)); child.on("error", reject);
    child.on("close", code => { if (code !== 0) return reject(new Error(Buffer.concat(errors).toString())); try { resolve(JSON.parse(Buffer.concat(output).toString()) as string[]); } catch (error) { reject(error); } });
    child.stdin.end(`${bundle.outputFiles[0].text}\nprocess.stdout.write(JSON.stringify(${JSON.stringify(cases)}.map(args=>module.exports.render(...args))));`);
  });
  const [welcome, settings, home, missing, iban, revolut, deposit, noDeposit, swatches, editor] = html;
  expect(welcome).toContain('name="businessName" required=""');
  expect(welcome).toContain("Your name (optional)"); expect(welcome).not.toContain('name="name" required');
  expect(welcome).toContain("What do you offer?"); expect(welcome).toContain("Save and get started");
  for (const field of ["phone", "address", "iban", "bic", "revolutLink", "invoiceAccent"]) expect(welcome).not.toContain(`name="${field}"`);
  expect(settings).not.toContain("Save settings"); expect(settings).not.toContain("Not connected"); expect(settings).toContain("Coming later");
  expect(settings).toContain("Opens a draft in your WhatsApp — you press send");
  expect(settings).toContain('<details class="settings-section customise-messages">');
  expect(home).toContain("Studio by Aoife");
  for (const html of [missing, deposit]) expect(html).toContain("How should clients pay you?");
  for (const html of [iban, revolut, noDeposit]) expect(html).not.toContain("How should clients pay you?");
  expect(missing).toContain("Not now");
  expect(swatches.match(/class="accent-swatch"/g)).toHaveLength(6);
  expect(swatches).toContain('aria-label="Plum" aria-pressed="true"');
  expect(swatches).toContain('type="color"'); expect(swatches).not.toContain('type="text"');
  expect(editor).toContain("Client name"); expect(editor).toContain("Bank details"); expect(editor).toContain("Example preview");
  expect(editor.split('class="message-live-preview"')[1]).toContain("Hi Aoife, your Gel nails costs €60.00.");
  expect(html[10].match(/Use a different name for each service\./g)).toHaveLength(2);
}, 15000);
