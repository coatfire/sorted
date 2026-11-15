import { afterEach, expect, it, vi } from "vitest";
import { controlError, validateForm } from "../../web/src/lib/validation";

afterEach(() => vi.unstubAllGlobals());

function fixture(controls: { name: string; validationMessage: string; disabled?: boolean }[]) {
  const inputs = controls.map((control) => ({ ...control, focus: vi.fn() }));
  vi.stubGlobal("document", { createElement: () => ({ querySelectorAll: () => inputs }) });
  return { form: document.createElement("form"), inputs };
}

it("accepts valid fields and an empty form without moving focus", () => {
  const { form, inputs } = fixture([{ name: "phone", validationMessage: "" }]);
  expect(validateForm(form, {})).toEqual({});
  expect(inputs[0].focus).not.toHaveBeenCalled();
  expect(validateForm(fixture([]).form, {})).toEqual({});
});

it("collects every error and focuses the first invalid control in DOM order", () => {
  const { form, inputs } = fixture([
    { name: "name", validationMessage: "Please fill out this field." },
    { name: "phone", validationMessage: "" },
    { name: "price", validationMessage: "Please fill out this field." },
  ]);
  expect(validateForm(form, {
    price: () => "Add the price, like 120 or 120.50.",
    phone: () => "That mobile number doesn’t look right. Try it like 087 123 4567.",
  })).toEqual({
    name: "Please fill out this field.",
    phone: "That mobile number doesn’t look right. Try it like 087 123 4567.",
    price: "Add the price, like 120 or 120.50.",
  });
  expect(inputs[0].focus).toHaveBeenCalledOnce();
  expect(inputs[1].focus).not.toHaveBeenCalled();
  expect(inputs[2].focus).not.toHaveBeenCalled();
});

it("uses the same field validation on blur and submit, and ignores disabled controls", () => {
  const { form } = fixture([{ name: "date", validationMessage: "Invalid date", disabled: true }]);
  expect(validateForm(form, {})).toEqual({});
  expect(controlError(form.querySelectorAll<HTMLInputElement>("input")[0], {})).toBe("Invalid date");
});
