import { afterEach, expect, it, vi } from "vitest";
import { manageDialogFocus } from "../../web/src/lib/dialogFocus";

class Element {
  tabIndex = 0;
  disabled = false;
  hidden = false;
  focus = vi.fn(() => { documentState.activeElement = this; });
  children: Element[] = [];
  contains(other: unknown) { return other === this || this.children.includes(other as Element); }
  matches() { return this.disabled || this.hidden; }
  getClientRects() { return this.hidden ? [] : [{}]; }
}

const documentState = {
  activeElement: new Element(),
  body: { style: { overflow: "auto" } },
  addEventListener: vi.fn<(name: string, handler: (event: { key: string; shiftKey: boolean; preventDefault: () => void }) => void) => void>(),
  removeEventListener: vi.fn(),
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("cycles focus, skips unavailable controls, closes on Escape and restores focus", () => {
  const previous = new Element();
  documentState.activeElement = previous;
  const first = new Element();
  const disabled = new Element();
  disabled.disabled = true;
  const hidden = new Element();
  hidden.hidden = true;
  const last = new Element();
  const panel = Object.assign(new Element(), {
    querySelectorAll: () => [first, disabled, hidden, last],
  });
  vi.stubGlobal("document", documentState);
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("document", { ...documentState, createElement: () => panel,
    get activeElement() { return documentState.activeElement; } });
  const close = vi.fn();
  const cleanup = manageDialogFocus(document.createElement("div"), close);
  expect(documentState.activeElement).toBe(panel);
  expect(documentState.body.style.overflow).toBe("hidden");
  const onKey = documentState.addEventListener.mock.calls[0][1];
  const key = (value: string, shiftKey = false) => {
    const event = { key: value, shiftKey, preventDefault: vi.fn() };
    onKey(event);
    return event;
  };
  key("Tab");
  expect(documentState.activeElement).toBe(first);
  key("Tab", true);
  expect(documentState.activeElement).toBe(last);
  key("Tab");
  expect(documentState.activeElement).toBe(first);
  expect(key("ArrowDown").preventDefault).not.toHaveBeenCalled();
  key("Escape");
  expect(close).toHaveBeenCalledOnce();
  cleanup();
  expect(documentState.activeElement).toBe(previous);
  expect(documentState.body.style.overflow).toBe("auto");
  expect(documentState.removeEventListener).toHaveBeenCalledWith("keydown", onKey);
});

it("keeps focus inside a dialog with no focusable controls", () => {
  const panel = Object.assign(new Element(), { querySelectorAll: () => [] });
  vi.stubGlobal("document", documentState);
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("document", { ...documentState, createElement: () => panel,
    get activeElement() { return documentState.activeElement; } });
  const cleanup = manageDialogFocus(document.createElement("div"), vi.fn());
  const onKey = documentState.addEventListener.mock.calls[0][1];
  const preventDefault = vi.fn();
  onKey({ key: "Tab", shiftKey: true, preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(documentState.activeElement).toBe(panel);
  cleanup();
});

it.each(["", "auto", "clip"])("restores the original overflow %s only after every nested sheet closes, in either order", overflow => {
  vi.stubGlobal("document", documentState);
  vi.stubGlobal("HTMLElement", Element);
  const panel = () => Object.assign(new Element(), { querySelectorAll: () => [] }) as unknown as HTMLElement;
  for (const parentFirst of [true, false]) {
    documentState.body.style.overflow = overflow;
    const parent = manageDialogFocus(panel(), vi.fn());
    const child = manageDialogFocus(panel(), vi.fn());
    expect(documentState.body.style.overflow).toBe("hidden");
    const first = parentFirst ? parent : child, last = parentFirst ? child : parent;
    first();
    expect(documentState.body.style.overflow).toBe("hidden");
    first();
    expect(documentState.body.style.overflow).toBe("hidden");
    last();
    expect(documentState.body.style.overflow).toBe(overflow);
  }
});

it("leaves focus on a field the sheet autofocused", () => {
  const field = new Element();
  const panel = Object.assign(new Element(), { querySelectorAll: () => [field], children: [field] });
  documentState.activeElement = field;
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("document", { ...documentState, get activeElement() { return documentState.activeElement; } });
  const cleanup = manageDialogFocus(panel as unknown as HTMLElement, vi.fn());
  expect(panel.focus).not.toHaveBeenCalled();
  expect(documentState.activeElement).toBe(field);
  cleanup();
});
