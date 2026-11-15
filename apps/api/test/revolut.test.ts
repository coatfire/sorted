import { describe, expect, it } from "vitest";
import { RevolutLink, UpdateUserInput, renderBookingMessage, DEFAULT_PAYMENT_REQUEST_TEMPLATE, DEFAULT_BOOKING_CONFIRMATION_TEMPLATE } from "@sorted/core";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";

describe("Revolut links", () => {
  it.each(["name", "@name", "revolut.me/name", "https://revolut.me/name", " HTTPS://REVOLUT.ME/name "])("normalises %s", value => {
    expect(RevolutLink.parse(value)).toBe("https://revolut.me/name");
  });
  it("accepts username punctuation and turns empty settings off", () => {
    expect(RevolutLink.parse("@name_1.-2")).toBe("https://revolut.me/name_1.-2");
    expect(UpdateUserInput.parse({ revolut_link: " " }).revolut_link).toBeNull();
    expect(UpdateUserInput.parse({ revolut_link: null }).revolut_link).toBeNull();
  });
  it.each(["", "@", "https://evil.test/name", "http://revolut.me/name", "revolut.me/name?x=1", "name/path", "name space", "name#fragment", "javascript:alert(1)", "x".repeat(201)])("rejects %s", value => {
    expect(RevolutLink.safeParse(value).success).toBe(false);
  });
  it("persists, preserves omitted values, validates and clears only the signed-in user's link", async () => {
    const [owner, other] = await db.insert(schema.users).values([{ email: `${crypto.randomUUID()}@example.com` }, { email: `${crypto.randomUUID()}@example.com` }]).returning();
    const jwt = await issueJwt(owner.id, owner.sessionVersion);
    const patch = (body: object) => app.request("/api/auth/me", { method: "PATCH", headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) });
    expect((await app.request("/api/auth/me", { method: "PATCH", body: JSON.stringify({ revolut_link: "@name" }) })).status).toBe(401);
    expect(await (await patch({ revolut_link: "@name" })).json()).toMatchObject({ revolutLink: "https://revolut.me/name" });
    expect((await patch({ revolut_link: "https://evil.test/name" })).status).toBe(400);
    expect(await (await patch({ business_name: "Studio" })).json()).toMatchObject({ revolutLink: "https://revolut.me/name" });
    expect(await (await patch({ revolut_link: "" })).json()).toMatchObject({ revolutLink: null });
    const users = await db.select().from(schema.users);
    expect(users.find(user => user.id === other.id)?.revolutLink).toBeNull();
  });
});

describe("Revolut in manual message drafts", () => {
  const link = "https://revolut.me/studio";
  const details = { client: "Áine", business: "Studio", date: "18 November", time: "10:00", service: "Hair", priceCents: 8000, depositCents: 2500, balanceCents: 5500, iban: "IE29AIBK93115212345678", bic: null, payLink: null, revolutLink: link };
  it("includes the link once in both defaults and custom payment requests", () => {
    for (const template of [DEFAULT_PAYMENT_REQUEST_TEMPLATE, DEFAULT_BOOKING_CONFIRMATION_TEMPLATE, "Please pay {balance}", "Pay by Revolut: {revolut_link}", `Please pay ${link}`, `Please pay ${link}.`, "Please pay revolut.me/studio"]) {
      const result = renderBookingMessage(template, details);
      expect(result.match(/revolut\.me\/studio/g)).toHaveLength(1);
    }
    expect(renderBookingMessage("Please pay {balance}", details)).toContain(`Pay by Revolut: ${link}`);
  });
  it("does not mistake another username for the configured link", () => {
    expect(renderBookingMessage("Old link revolut.me/studio-other", details)).toContain(`Pay by Revolut: ${link}`);
  });
  it("omits disabled links and placeholder labels", () => {
    const result = renderBookingMessage(DEFAULT_PAYMENT_REQUEST_TEMPLATE, { ...details, revolutLink: null });
    expect(result).not.toMatch(/Revolut|revolut_link|null|undefined/);
  });
  it("includes Revolut in deposit confirmations with bank details, not no-deposit or fully-paid confirmations", () => {
    const confirmation = { ...details, kind: "confirmation" as const };
    expect(renderBookingMessage(DEFAULT_BOOKING_CONFIRMATION_TEMPLATE, confirmation)).toContain(link);
    expect(renderBookingMessage("Hello {client}", confirmation)).not.toContain(link);
    expect(renderBookingMessage(DEFAULT_BOOKING_CONFIRMATION_TEMPLATE, { ...confirmation, depositCents: 0 })).not.toContain(link);
    expect(renderBookingMessage(DEFAULT_BOOKING_CONFIRMATION_TEMPLATE, { ...confirmation, balanceCents: 0 })).not.toContain(link);
  });
});
