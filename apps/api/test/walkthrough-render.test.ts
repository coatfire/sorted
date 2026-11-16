import { spawn } from "node:child_process";
import { build } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";
import { isTextEntry } from "../../web/src/lib/useKeyboardControls";

afterEach(() => vi.unstubAllGlobals());

it("recognises keyboard text controls without hiding controls for checkboxes or file pickers", () => {
  class Element {
    constructor(public tagName: string, public type = "text", public isContentEditable = false) {}
  }
  vi.stubGlobal("HTMLElement", Element);
  const entry = (tag: string, type?: string, editable?: boolean) => isTextEntry(new Element(tag, type, editable) as unknown as HTMLElement);
  expect(isTextEntry(null)).toBe(false);
  for (const type of ["text", "email", "tel", "number", "date", "password", "search"]) expect(entry("INPUT", type)).toBe(true);
  expect(entry("TEXTAREA")).toBe(true);
  expect(entry("DIV", "", true)).toBe(true);
  for (const type of ["checkbox", "radio", "button", "submit", "range", "color", "file", "hidden"]) expect(entry("INPUT", type)).toBe(false);
  expect(entry("BUTTON")).toBe(false);
});

it("renders explicit acknowledgement only after an app attempt, calm dismissal and matching calendar labels", async () => {
  const bundle = await build({ stdin: {
    contents: `import {createElement as h} from "react"; import {renderToStaticMarkup} from "react-dom/server";
      import {MessageOutcome} from "./MessageOutcome"; import {BookingMessageSheet} from "./BookingMessageSheet";
      import {BookingCalendarSheet} from "./BookingCalendarSheet"; import {CalendarSettings} from "./CalendarSettings";
      globalThis.window={location:{origin:'https://sorted.example'}};
      const booking={id:'booking',clientId:'client',status:'confirmed',client:{name:'Client',phone:null,email:null},service:'Gel nails',startAt:'2026-11-18T10:00:00Z',priceCents:8000,depositCents:0};
      export function render(screen,channel=null) {const noop=()=>{};
        const element=screen==='outcome'?h(MessageOutcome,{bookingId:booking.id,kind:'follow_up',channel,onClose:noop}):screen==='draft'?h(BookingMessageSheet,{booking,kind:'confirmation',onClose:noop}):screen==='calendar'?h(BookingCalendarSheet,{booking,onClose:noop}):h(CalendarSettings);
        return renderToStaticMarkup(element);}`,
    resolveDir: new URL("../../web/src", import.meta.url).pathname, loader: "tsx",
  }, bundle: true, platform: "node", format: "cjs", jsx: "automatic", write: false,
    plugins: [{ name: "walkthrough-store", setup(build) {
      build.onResolve({ filter: /lib\/store$/ }, () => ({ path: "store", namespace: "walkthrough-test" }));
      build.onLoad({ filter: /.*/, namespace: "walkthrough-test" }, () => ({ contents: `
        export const useData=()=>({user:{businessName:'Studio',iban:null,bic:null,revolutLink:null},features:{paymentLinks:false},payments:[]});
        export const useSession=()=>({mode:'demo'});export const useStore=()=>({backend:{},toast:()=>{}});
        export const useAction=()=>({busy:false,error:null,committed:false,run:()=>{}});` }));
    } }],
  });
  const html = await new Promise<string[]>((resolve, reject) => {
    const child = spawn(process.execPath, ["-"], { stdio: ["pipe", "pipe", "pipe"] });
    const output: Buffer[] = [], errors: Buffer[] = [];
    child.stdout.on("data", chunk => output.push(chunk)); child.stderr.on("data", chunk => errors.push(chunk)); child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) return reject(new Error(Buffer.concat(errors).toString()));
      try { resolve(JSON.parse(Buffer.concat(output).toString()) as string[]); } catch (error) { reject(error); }
    });
    child.stdin.end(`${bundle.outputFiles[0].text}\nprocess.stdout.write(JSON.stringify([['outcome',null],['outcome','whatsapp'],['outcome','email'],['draft'],['calendar'],['feeds']].map(args=>module.exports.render(...args))));`);
  });
  const [closed, whatsapp, email, draft, calendar, feeds] = html;
  expect(closed).not.toContain("I sent it");
  for (const markup of [closed, whatsapp, email, draft]) {
    expect(markup).toContain(">Close</button>");
    expect(markup).not.toContain(">Done</button>");
  }
  for (const markup of [whatsapp, email]) {
    expect(markup).toContain(">I sent it</button>");
    expect(markup).toContain("not verified delivery");
    expect(markup).toContain("again in 3 days");
  }
  expect(draft).toContain("Price: €80.00\nSee you then!");
  expect(draft).not.toMatch(/Deposit:|Balance:|€0\.00|\{deposit/);
  for (const markup of [calendar, feeds]) {
    expect(markup.indexOf("Add to phone calendar")).toBeLessThan(markup.indexOf("Google Calendar (web)"));
    expect(markup).not.toContain("iPhone /");
  }
}, 15000);
