import { useState, type FormEvent } from "react";
import { controlError, validateForm, type ValidatedControl, type Validators } from "./validation";

export function useValidation(validators: Validators) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  function field(name: string) {
    return {
      error: errors[name],
      onBlurCapture(event: FormEvent<HTMLLabelElement>) {
        const control = event.currentTarget.querySelector<ValidatedControl>('input, textarea, select');
        if (!control) return;
        const error = controlError(control, validators);
        setErrors((current) => ({ ...current, [name]: error ?? "" }));
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
