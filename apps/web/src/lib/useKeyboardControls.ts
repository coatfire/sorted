import { useEffect } from "react";

export function isTextEntry(element: Element | null) {
  return element instanceof HTMLElement && (element.isContentEditable || element.tagName === "TEXTAREA" ||
    (element.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "hidden"].includes((element as HTMLInputElement).type)));
}

export function watchKeyboardControls() {
  const viewport = window.visualViewport;
  const update = () => {
    document.documentElement.classList.toggle("keyboard-open", isTextEntry(document.activeElement));
    document.documentElement.style.setProperty("--visible-height", `${viewport?.height ?? window.innerHeight}px`);
    document.documentElement.style.setProperty("--visible-top", `${viewport?.offsetTop ?? 0}px`);
  };
  // Leaving a field waits for the tap that caused it, so the buttons don't move under that tap.
  let pending: ReturnType<typeof setTimeout> | undefined;
  const blur = () => { clearTimeout(pending); pending = setTimeout(update, 0); };
  const focus = () => queueMicrotask(() => isTextEntry(document.activeElement) ? update() : blur());
  document.addEventListener("focusin", focus);
  document.addEventListener("focusout", blur);
  viewport?.addEventListener("resize", update);
  viewport?.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  update();
  return () => {
    document.removeEventListener("focusin", focus);
    document.removeEventListener("focusout", blur);
    clearTimeout(pending);
    viewport?.removeEventListener("resize", update);
    viewport?.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    document.documentElement.classList.remove("keyboard-open");
    document.documentElement.style.removeProperty("--visible-height");
    document.documentElement.style.removeProperty("--visible-top");
  };
}

export function useKeyboardControls() {
  useEffect(watchKeyboardControls, []);
}
