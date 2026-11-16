import { afterEach, expect, it, vi } from "vitest";
import { watchKeyboardControls } from "../../web/src/lib/useKeyboardControls";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mount(withViewport = true) {
  class Control {
    tagName = "INPUT";
    type = "text";
    isContentEditable = false;
  }
  const classes = new Set<string>(), styles = new Map<string, string>();
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
  const win = Object.assign(new EventTarget(), { innerHeight: 844, visualViewport: withViewport ? viewport : undefined });
  const doc = Object.assign(new EventTarget(), {
    activeElement: null as Element | null,
    documentElement: {
      classList: {
        toggle: (name: string, enabled: boolean) => enabled ? classes.add(name) : classes.delete(name),
        remove: (name: string) => classes.delete(name),
      },
      style: {
        setProperty: (name: string, value: string) => styles.set(name, value),
        removeProperty: (name: string) => styles.delete(name),
      },
    },
  });
  vi.stubGlobal("HTMLElement", Control);
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  cleanup = watchKeyboardControls();
  return { win, doc, viewport, classes, styles, control: new Control() as unknown as Element };
}

it.each([true, false])("ignores desktop height reductions and resets immediately on blur (visualViewport: %s)", async withViewport => {
  const { win, doc, viewport, classes, styles, control } = mount(withViewport);
  win.innerHeight = 450;
  viewport.height = 450;
  win.dispatchEvent(new Event("resize"));
  expect(classes.has("keyboard-open")).toBe(false);
  expect(styles.get("--visible-height")).toBe("450px");

  doc.activeElement = control;
  doc.dispatchEvent(new Event("focusin"));
  await Promise.resolve();
  expect(classes.has("keyboard-open")).toBe(true);
  viewport.height = 200;
  viewport.offsetTop = 25;
  viewport.dispatchEvent(new Event("resize"));
  viewport.dispatchEvent(new Event("scroll"));
  expect(classes.has("keyboard-open")).toBe(true);
  expect(styles.get("--visible-height")).toBe(withViewport ? "200px" : "450px");
  expect(styles.get("--visible-top")).toBe(withViewport ? "25px" : "0px");

  doc.activeElement = null;
  doc.dispatchEvent(new Event("focusout"));
  await Promise.resolve();
  expect(classes.has("keyboard-open")).toBe(false);
  win.innerHeight = 300;
  viewport.height = 150;
  win.dispatchEvent(new Event("resize"));
  viewport.dispatchEvent(new Event("resize"));
  expect(classes.has("keyboard-open")).toBe(false);
  doc.activeElement = control;
  doc.dispatchEvent(new Event("focusin"));
  await Promise.resolve();
  expect(classes.has("keyboard-open")).toBe(true);
  cleanup?.();
  expect(classes.has("keyboard-open")).toBe(false);
  expect(styles.size).toBe(0);
  win.dispatchEvent(new Event("resize"));
  viewport.dispatchEvent(new Event("scroll"));
  expect(styles.size).toBe(0);
});
