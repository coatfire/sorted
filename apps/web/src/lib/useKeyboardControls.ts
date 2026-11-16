import { useEffect } from "react";

export function isTextEntry(element: Element | null) {
  return element instanceof HTMLElement && (element.isContentEditable || element.tagName === "TEXTAREA" ||
    (element.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "hidden"].includes((element as HTMLInputElement).type)));
}

export function useKeyboardControls() {
  useEffect(() => {
    const viewport = window.visualViewport;
    let height = window.innerHeight;
    let width = window.innerWidth;
    const update = () => {
      if (width !== window.innerWidth) {
        width = window.innerWidth;
        height = window.innerHeight;
      }
      height = Math.max(height, window.innerHeight);
      document.documentElement.classList.toggle("keyboard-open", isTextEntry(document.activeElement) || (viewport?.height ?? height) < height - 150);
      document.documentElement.style.setProperty("--visible-height", `${viewport?.height ?? window.innerHeight}px`);
      document.documentElement.style.setProperty("--visible-top", `${viewport?.offsetTop ?? 0}px`);
    };
    const focus = () => queueMicrotask(update);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", focus);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    update();
    return () => {
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", focus);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.documentElement.classList.remove("keyboard-open");
      document.documentElement.style.removeProperty("--visible-height");
      document.documentElement.style.removeProperty("--visible-top");
    };
  }, []);
}
