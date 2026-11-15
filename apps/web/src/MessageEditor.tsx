import { useLayoutEffect, useRef } from "react";
import type { User } from "@sorted/core";
import { Button, Field } from "./components";
import { insertMessageToken, MESSAGE_CHIPS, previewMessage } from "./lib/messageEditor";

export function MessageEditor({ label, name, value, onChange, onBlur, onReset, user, kind }: { label: string; name: string; value: string; onChange: (value: string) => void; onBlur: () => void; onReset: () => void; user: User; kind: "confirmation" | "payment_request" }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const selection = useRef({ start: 0, end: 0 });
  useLayoutEffect(() => { if (input.current) { input.current.style.height = "auto"; input.current.style.height = `${input.current.scrollHeight}px`; } }, [value]);
  return <div className="message-editor">
    <Field label={label} helper="Write it your way. Tap a detail below to add it where you're typing.">
      <textarea ref={input} name={name} rows={3} maxLength={4000} value={value} onChange={event => onChange(event.target.value)} onBlur={onBlur} onSelect={() => { if (input.current) selection.current = { start: input.current.selectionStart, end: input.current.selectionEnd }; }} />
    </Field>
    <div className="message-chips" aria-label={`Add a detail to ${label.toLowerCase()}`}>
      {MESSAGE_CHIPS.map(([label, token]) => <Button kind="quiet" key={label} onClick={() => {
        const next = insertMessageToken(value, token, input.current?.selectionStart ?? selection.current.start, input.current?.selectionEnd ?? selection.current.end);
        if (next.value.length > 4000) return;
        onChange(next.value); selection.current = { start: next.cursor, end: next.cursor };
        requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(next.cursor, next.cursor); });
      }}>{label}</Button>)}
    </div>
    <Button kind="quiet" aria-label={`Reset ${label.toLowerCase()} to default`} onClick={onReset}>Reset to default</Button>
    <div className="message-live-preview"><h3>Example preview</h3><p className="field-helper">Sample client and booking. Your payment details appear when you've added them.</p><p className="message-preview">{previewMessage(value, user, kind) || "Your message is empty."}</p></div>
  </div>;
}
