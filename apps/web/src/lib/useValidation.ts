import { useRef, useState, type FormEvent } from "react";
import { controlError, validateForm, type ValidatedControl, type Validators } from "./validation";

export function useValidation(validators: Validators) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const latest = useRef(validators);
  latest.current = validators;
  function field(name: string) {
    return {
      error: errors[name],
      onBlurCapture(event: FormEvent<HTMLLabelElement>) {
        const control = event.currentTarget.querySelector<ValidatedControl>('input, textarea, select');
        if (!control) return;
        // Checked once the tap that took focus away has landed, so an error appearing can't move what was tapped,
        // and that tap may have filled the field. An empty field is left alone until Save.
        setTimeout(() => {
          if (control.isConnected && control.value) setErrors((current) => ({ ...current, [name]: controlError(control, latest.current) ?? "" }));
        }, 0);
      },
      onChangeCapture() {
        setErrors((current) => ({ ...current, [name]: "" }));
      },
    };
  }
  return {
    field,
    hasErrors: Object.values(errors).some(Boolean),
    clear: () => setErrors({}),
    validate(form: HTMLFormElement) {
      const next = validateForm(form, validators);
      setErrors(next);
      return Object.keys(next).length === 0;
    },
  };
}
