import { describe, expect, it } from "vitest";
import { formatPhone, normaliseClientPhone, normalisePhone } from "@sorted/core";
import { whatsappLink } from "../../web/src/lib/format";

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

describe("formatPhone", () => {
  it.each([
    ["353871234567", "087 123 4567"],
    ["+353871234567", "087 123 4567"],
    ["00353 (87) 123-4567", "087 123 4567"],
    ["0871234567", "087 123 4567"],
    ["086 123 4567", "086 123 4567"],
    ["447700900123", "+447 700 900 123"],
    ["+44 (7700) 900123", "+447 700 900 123"],
    ["6581234567", "+6 581 234 567"],
    ["+1 (212) 555-1234", "+12 125 551 234"],
  ])("formats %s for display without changing its saved number or link", (input, expected) => {
    expect(formatPhone(input)).toBe(expected);
    expect(formatPhone(expected)).toBe(expected);
    expect(normaliseClientPhone(expected)).toBe(normaliseClientPhone(input));
    expect(whatsappLink(expected, "Hello")).toBe(whatsappLink(input, "Hello"));
  });
  it("handles absent values and preserves invalid legacy text for correction", () => {
    for (const input of [null, undefined, ""]) expect(formatPhone(input)).toBe("");
    expect(formatPhone("not a number")).toBe("not a number");
    expect(formatPhone("123")).toBe("123");
  });
});
