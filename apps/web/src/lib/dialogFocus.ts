export function manageDialogFocus(panel: HTMLElement, onClose: () => void) {
  const previous = document.activeElement;
  const overflow = document.body.style.overflow;
  panel.focus();
  document.body.style.overflow = "hidden";
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
  return () => {
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = overflow;
    if (previous instanceof HTMLElement) previous.focus();
  };
}
