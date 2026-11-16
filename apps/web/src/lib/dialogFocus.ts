let scrollLocks = 0;
let originalOverflow = "";

export function manageDialogFocus(panel: HTMLElement, onClose: () => void) {
  const previous = document.activeElement;
  const body = document.body;
  if (scrollLocks === 0) originalOverflow = body.style.overflow;
  scrollLocks += 1;
  // An autofocused field inside the panel keeps focus; stealing it would blur-validate an empty form.
  if (!panel.contains(document.activeElement)) panel.focus();
  body.style.overflow = "hidden";
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
    if (event.key !== "Tab") return;
    const controls = [...panel.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]',
    )].filter((element) => element.tabIndex >= 0 &&
      !element.matches(":disabled, [hidden]") && element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) {
      event.preventDefault();
      panel.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", onKey);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    document.removeEventListener("keydown", onKey);
    scrollLocks -= 1;
    if (scrollLocks === 0) body.style.overflow = originalOverflow;
    if (previous instanceof HTMLElement) previous.focus();
  };
}
