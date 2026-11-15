export type ValidatedControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export type Validators = Record<string, (() => string | undefined) | undefined>;

export function controlError(control: ValidatedControl, validators: Validators) {
  return validators[control.name]?.() || control.validationMessage || undefined;
}

export function validateForm(form: HTMLFormElement, validators: Validators) {
  const errors: Record<string, string> = {};
  let first: ValidatedControl | undefined;
  for (const control of form.querySelectorAll<ValidatedControl>('input[name], textarea[name], select[name]')) {
    if (control.disabled) continue;
    const error = controlError(control, validators);
    if (error) {
      errors[control.name] = error;
      first ??= control;
    }
  }
  first?.focus();
  return errors;
}
