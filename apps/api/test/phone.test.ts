import { describe, expect, it } from "vitest";
import { normalisePhone } from "@sorted/core";

describe("normalisePhone", () => {
  it.each([
    ["087 123 4567", "+353871234567"],
    ["87 123 4567", "+353871234567"],
    ["+353 (87) 123-4567", "+353871234567"],
    ["00353871234567", "+353871234567"],
    ["353871234567", "+353871234567"],
    ["+44 7700 900123", "+447700900123"],
  ])("%s → %s", (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it("returns null for blanks and nonsense", () => {
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone("12")).toBeNull();
    expect(normalisePhone("call me")).toBeNull();
  });
});
