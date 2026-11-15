import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_INVOICE_ACCENT, type User } from "@sorted/core";
import { completeServiceDrafts, needsPaymentDetails, needsWelcome, paymentDetails, serviceValues, traderName } from "../../web/src/lib/setup";
import { createSettingsAutosave } from "../../web/src/lib/settingsAutosave";
import { fieldPatch, settingsForm } from "../../web/src/lib/settingsFields";
import { insertMessageToken, previewMessage } from "../../web/src/lib/messageEditor";
import { DriveError, driveErrorMessage } from "../../web/src/lib/driveErrors";
import { app } from "../src/app";
import { db, schema } from "../src/db";
import { issueJwt } from "../src/lib/auth";

afterEach(() => vi.useRealTimers());
const user = { name: null, businessName: "Studio by Aoife", iban: null, bic: null, revolutLink: null, vatRegistered: false } as User;

describe("growing setup", () => {
  it("saves the minimal welcome profile and preserves omitted settings through partial PATCHes", async () => {
    const [account] = await db.insert(schema.users).values({ email: `${crypto.randomUUID()}@example.com`, phone: "+353871234567", address: "Studio, Cork", vatRegistered: true, vatRateBp: 2300 }).returning();
    const jwt = await issueJwt(account.id, account.sessionVersion);
    const patch = (body: object) => app.request("/api/auth/me", { method: "PATCH", headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) });
    const response = await patch({ business_name: "Studio", name: null, services: [{ name: "Gel nails", price_cents: 3500 }] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: null, businessName: "Studio", phone: account.phone, address: account.address, services: [{ name: "Gel nails", priceCents: 3500 }], vatRegistered: true, vatRateBp: 2300 });
    await Promise.all([patch({ name: "Aoife" }), patch({ invoice_accent: "#6B315D" }), patch({ income_tax_rate_bp: 2000 })]);
    const saved = await app.request("/api/auth/me", { headers: { Authorization: `Bearer ${jwt}` } });
    expect(await saved.json()).toMatchObject({ name: "Aoife", businessName: "Studio", phone: account.phone, invoiceAccent: "#6B315D", vatRegistered: true, vatRateBp: 2300, incomeTaxRateBp: 2000 });
  });
  it("requires only a business name for onboarding and falls back to it for a missing personal name", () => {
    expect(needsWelcome(user)).toBe(false);
    expect(needsWelcome({ businessName: "  " })).toBe(true);
    expect(traderName(user)).toBe("Studio by Aoife");
    expect(traderName({ ...user, name: " Aoife " })).toBe("Aoife");
    expect(traderName({ ...user, name: " ", businessName: null })).toBe("Your business");
    expect(serviceValues([])).toMatchObject({ success: true, data: [] });
    expect(serviceValues([{ id: "a", name: "Gel nails", price: "35" }])).toMatchObject({ success: true, data: [{ name: "Gel nails", priceCents: 3500 }] });
    expect(serviceValues([{ id: "a", name: "", price: "35" }]).success).toBe(false);
  });
  it("prompts only for payment/deposit drafts without either payment method", () => {
    expect(needsPaymentDetails(user, "payment_request", 0, 6000)).toBe(true);
    expect(needsPaymentDetails({ ...user, iban: "IE29AIBK93115212345678" }, "payment_request", 2000, 6000)).toBe(false);
    expect(needsPaymentDetails({ ...user, revolutLink: "https://revolut.me/aoife" }, "confirmation", 2000, 6000)).toBe(false);
    expect(needsPaymentDetails(user, "confirmation", 2000, 6000)).toBe(true);
    expect(needsPaymentDetails(user, "confirmation", 0, 6000)).toBe(false);
    expect(needsPaymentDetails(user, "confirmation", 2000, 0)).toBe(false);
    expect(paymentDetails({ iban: "ie29 aibk 9311 5212 3456 78", bic: " aibkie2d ", revolutLink: "@aoife" })).toMatchObject({ patch: { iban: "IE29AIBK93115212345678", bic: "AIBKIE2D", revolutLink: "https://revolut.me/aoife" } });
    expect(paymentDetails({ iban: "invalid", bic: "bad", revolutLink: "https://other.example" }).errors).toEqual({ iban: expect.any(String), bic: expect.any(String), revolutLink: expect.any(String) });
  });
  it("saves complete service rows independently without deleting an incomplete edit", () => {
    const original = { id: "existing", name: "", price: "35", lastComplete: { name: "Gel nails", priceCents: 3500 } };
    const next = completeServiceDrafts([original, { id: "new", name: "Lashes", price: "45" }, { id: "blank", name: "", price: "" }]);
    expect(next.values).toEqual([{ name: "Gel nails", priceCents: 3500 }, { name: "Lashes", priceCents: 4500 }]);
    expect(completeServiceDrafts(next.drafts.filter(row => row.id !== "existing")).values).toEqual([{ name: "Lashes", priceCents: 4500 }]);
  });
  it("rejects duplicates against names retained from incomplete rows and recovers after correction", async () => {
    const rows = [{ id: "existing", name: "New name", price: "", lastComplete: { name: "Gel nails", priceCents: 3500 } }, { id: "new", name: "  GEL NAILS ", price: "45" }];
    const next = completeServiceDrafts(rows);
    expect(next.valid).toBe(false);
    expect([...next.duplicateIds]).toEqual(["existing", "new"]);
    const save = vi.fn().mockResolvedValue(undefined), saver = createSettingsAutosave(save, async () => {}, vi.fn());
    saver.change("services", "services", next.valid ? { services: next.values } : null);
    await saver.flushAll();
    expect(save).not.toHaveBeenCalled();
    const corrected = completeServiceDrafts(next.drafts.map(row => row.id === "new" ? { ...row, name: "Lashes" } : row));
    expect(corrected.valid).toBe(true); expect(corrected.duplicateIds.size).toBe(0);
    expect(corrected.values).toEqual([{ name: "Gel nails", priceCents: 3500 }, { name: "Lashes", priceCents: 4500 }]);
    expect(completeServiceDrafts(next.drafts.filter(row => row.id !== "new")).valid).toBe(true);
  });
});

describe("Settings partial autosave", () => {
  it("drops a failed value on a newer invalid edit while retaining other failed fields", async () => {
    const save = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(undefined);
    const saver = createSettingsAutosave(save, async () => {}, vi.fn());
    saver.change("profile", "phone", { phone: "+353871234567" });
    saver.change("profile", "name", { name: "Aoife" });
    await saver.flush("profile");
    saver.change("profile", "phone", null);
    expect(saver.getChanges()).toEqual({ name: "Aoife" });
    await saver.flushAll();
    expect(save.mock.calls).toEqual([[{ phone: "+353871234567", name: "Aoife" }], [{ name: "Aoife" }]]);
    saver.change("profile", "phone", { phone: "+353879876543" }, true);
    await saver.flushAll(); expect(save).toHaveBeenLastCalledWith({ phone: "+353879876543" });
  });
  it("does not resurrect a request that fails after a newer invalid edit", async () => {
    let reject!: (error: Error) => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
    const saver = createSettingsAutosave(save, async () => {}, vi.fn());
    saver.change("profile", "phone", { phone: "+353871234567" }, true);
    await Promise.resolve(); saver.change("profile", "phone", null);
    reject(new TypeError("offline")); await saver.flushAll(); await saver.flushAll();
    expect(save).toHaveBeenCalledTimes(1); expect(saver.getChanges()).toEqual({});
  });
  it("drops obsolete queued and coupled pending keys before retrying", async () => {
    const save = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(undefined);
    const saver = createSettingsAutosave(save, async () => {}, vi.fn());
    saver.change("tax", "vatRegistered", { vatRegistered: true, vatRateBp: 2300 });
    saver.change("tax", "vatRateBp", null);
    await saver.flushAll(); expect(save).toHaveBeenCalledWith({ vatRegistered: true });
    saver.change("tax", "vatRegistered", { vatRegistered: false }, true);
    saver.change("tax", "vatRegistered", null);
    await saver.flushAll(); expect(save).toHaveBeenCalledTimes(1); expect(saver.getChanges()).toEqual({});
  });
  it("debounces text and sends just the latest changed field", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined), refresh = vi.fn().mockResolvedValue(undefined), report = vi.fn();
    const saver = createSettingsAutosave(save, refresh, report);
    saver.change("profile", "businessName", { businessName: "A" });
    saver.change("profile", "businessName", { businessName: "Aoife" });
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(save.mock.calls).toEqual([[{ businessName: "Aoife" }]]);
    expect(report).toHaveBeenLastCalledWith("profile", { phase: "saved" });
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("serialises in-flight writes across sections, preserving newer edits without resending snapshots", async () => {
    let release!: () => void;
    const first = new Promise<void>(resolve => { release = resolve; });
    const save = vi.fn().mockImplementationOnce(() => first).mockResolvedValue(undefined);
    const saver = createSettingsAutosave(save, async () => {}, vi.fn());
    saver.change("profile", "name", { name: "Aoife" }, true);
    await Promise.resolve();
    saver.change("profile", "name", { name: "Mary" }, true);
    saver.change("branding", "invoiceAccent", { invoiceAccent: "#6B315D" }, true);
    saver.change("profile", "phone", { phone: "+353871234567" }, true);
    expect(save).toHaveBeenCalledTimes(1);
    release(); await saver.flushAll();
    expect(save.mock.calls).toEqual([[{ name: "Aoife" }], [{ name: "Mary" }], [{ invoiceAccent: "#6B315D" }], [{ phone: "+353871234567" }]]);
  });
  it("does not save invalid or empty changes and retains an invalid section state", async () => {
    const save = vi.fn().mockResolvedValue(undefined), report = vi.fn();
    const saver = createSettingsAutosave(save, async () => {}, report);
    await saver.flushAll(); expect(save).not.toHaveBeenCalled();
    saver.change("profile", "phone", { phone: "+353871234567" });
    saver.change("profile", "phone", null);
    await saver.flushAll(); expect(save).not.toHaveBeenCalled();
    saver.change("profile", "name", { name: "Aoife" });
    await saver.flushAll();
    expect(save.mock.calls).toEqual([[{ name: "Aoife" }]]);
    expect(report).toHaveBeenLastCalledWith("profile", { phase: "invalid" });
    const form = settingsForm(user);
    expect(fieldPatch("iban", { ...form, iban: "bad" }).patch).toBeNull();
    expect(fieldPatch("phone", { ...form, phone: "bad" }).patch).toBeNull();
    expect(fieldPatch("businessName", { ...form, businessName: "" }).patch).toBeNull();
    expect(fieldPatch("invoiceAccent", { ...form, invoiceAccent: "#6B315D" }).patch).toEqual({ invoiceAccent: "#6B315D" });
    expect(fieldPatch("invoiceAccent", { ...form, invoiceAccent: DEFAULT_INVOICE_ACCENT }).patch).toEqual({ invoiceAccent: null });
  });
  it("retains failed fields for retry alongside a newer in-flight edit", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
    const saver = createSettingsAutosave(save, async () => {}, vi.fn());
    saver.change("profile", "name", { name: "Aoife" }, true);
    saver.change("profile", "phone", { phone: "+353871234567" }, true);
    await saver.flushAll();
    expect(save.mock.calls).toEqual([[{ name: "Aoife" }], [{ name: "Aoife", phone: "+353871234567" }]]);
    const retrySave = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
    const retry = createSettingsAutosave(retrySave, async () => {}, vi.fn());
    retry.change("profile", "name", { name: "Aoife" }, true); await retry.flush("profile"); await retry.flush("profile");
    expect(retrySave).toHaveBeenCalledTimes(2);
  });
  it("blocks queued writes and retries after a committed save cannot refresh", async () => {
    const save = vi.fn().mockResolvedValue(undefined), report = vi.fn();
    const saver = createSettingsAutosave(save, async () => { throw new Error("Refresh failed"); }, report);
    saver.change("profile", "name", { name: "Aoife" }, true);
    saver.change("branding", "invoiceAccent", { invoiceAccent: "#6B315D" }, true);
    await saver.flushAll();
    expect(save).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("profile", expect.objectContaining({ phase: "error", committed: true, message: expect.stringContaining("Reload") }));
    saver.change("profile", "name", { name: "Mary" }, true); await saver.flushAll();
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("friendly message editing", () => {
  it("inserts chips at the cursor or replaces a selected range", () => {
    expect(insertMessageToken("Hi !", "{client}", 3)).toEqual({ value: "Hi {client}!", cursor: 11 });
    expect(insertMessageToken("Hi old name!", "{client}", 3, 11)).toEqual({ value: "Hi {client}!", cursor: 11 });
    expect(insertMessageToken("", "{date}", 0)).toEqual({ value: "{date}", cursor: 6 });
  });
  it("uses the existing renderer to show sample text, name fallback and bank-line removal", () => {
    const preview = previewMessage("Hi {client}, {service} with {business} on {date} at {time}: {balance}.\nIBAN: {iban}", user, "payment_request");
    expect(preview).toContain("Hi Aoife, Gel nails with Studio by Aoife on Wednesday 18 November at 10:00: €60.00.");
    expect(preview).not.toContain("{"); expect(preview).not.toContain("IBAN");
    expect(previewMessage("", user, "payment_request")).toBe("");
  });
});

describe("plain Drive errors", () => {
  it.each([
    ["popup_closed", "window was closed"], ["popup_blocked", "browser blocked"], ["permission", "wasn't granted"], ["not_configured", "Google Drive isn't switched on for Sorted yet"], ["network", "Check your connection"], ["failed", "couldn't be saved"],
  ] as const)("explains %s inline without dropping the reassurance", (code, expected) => {
    expect(driveErrorMessage(new DriveError(code))).toContain(expected);
    expect(driveErrorMessage(new DriveError(code))).toContain("Nothing was lost");
  });
  it("handles offline/network and unknown failures without exposing raw error details", () => {
    expect(driveErrorMessage(new TypeError("fetch failed"))).toContain("Check your connection");
    expect(driveErrorMessage(new Error("secret details"), true)).toContain("Check your connection");
    expect(driveErrorMessage(new Error("secret details"))).not.toContain("secret details");
  });
});
