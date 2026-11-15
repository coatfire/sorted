import { afterEach, expect, it, vi } from "vitest";
import { createSettingsAutosaveRegistry, settingsAutosaveRegistry, watchSettingsAutosave } from "../../web/src/lib/settingsAutosaveSession";
import { apiBackend } from "../../web/src/lib/apiBackend";
import { demoBackend, resetDemo } from "../../web/src/lib/demoBackend";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function localStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
}

it("keeps a newer payment-prompt IBAN instead of replaying a failed API Settings IBAN on remount", async () => {
  localStorage();
  const userId = crypto.randomUUID(), iban = "DE89370400440532013000", oldIban = "IE29AIBK93115212345678";
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(Response.json({ id: userId, iban })).mockResolvedValueOnce(Response.json({ id: userId, iban, bic: "AIBKIE2D" }));
  vi.stubGlobal("fetch", fetch);
  const save = (patch: Parameters<typeof apiBackend.updateUser>[0]) => apiBackend.updateUser(patch);
  const retained = settingsAutosaveRegistry.get(apiBackend, userId, save, async () => {}, vi.fn());
  retained.saver.change("payment", "iban", { iban: oldIban });
  retained.saver.change("payment", "bic", { bic: "AIBKIE2D" });
  await retained.saver.flushAll();
  expect(retained.saver.getChanges()).toEqual({ iban: oldIban, bic: "AIBKIE2D" });
  await apiBackend.updateUser({ iban });
  expect(retained.saver.getChanges()).toEqual({ bic: "AIBKIE2D" });
  settingsAutosaveRegistry.notifySaved(apiBackend, "different-trader", { bic: "OTHER" });
  settingsAutosaveRegistry.notifySaved({}, userId, { bic: "OTHER" });
  const remounted = settingsAutosaveRegistry.get(apiBackend, userId, save, async () => {}, vi.fn());
  const unmount = watchSettingsAutosave(remounted, vi.fn(), new EventTarget(), Object.assign(new EventTarget(), { visibilityState: "visible" }));
  await remounted.saver.flushAll();
  expect(fetch.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))).toEqual([{ iban: oldIban, bic: "AIBKIE2D" }, { iban }, { bic: "AIBKIE2D" }]);
  expect(remounted.saver.getChanges()).toEqual({});
  unmount();
});

it("does not discard a retained field for an unsuccessful or unrelated API PATCH", async () => {
  localStorage();
  const userId = crypto.randomUUID(), save = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValue(undefined);
  const retained = settingsAutosaveRegistry.get(apiBackend, userId, save, async () => {}, vi.fn());
  retained.saver.change("payment", "iban", { iban: "IE29AIBK93115212345678" }, true); await retained.saver.flushAll();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ error: "Unavailable" }, { status: 503 })).mockResolvedValueOnce(Response.json({ id: userId, businessName: "Studio" })));
  await expect(apiBackend.updateUser({ iban: "DE89370400440532013000" })).rejects.toThrow();
  await apiBackend.updateUser({ businessName: "Studio", iban: undefined });
  expect(retained.saver.getChanges()).toEqual({ iban: "IE29AIBK93115212345678" });
  await retained.saver.flushAll(); expect(save).toHaveBeenCalledTimes(2);
});

it("does not retain an old IBAN when its request fails after a newer payment-details save", async () => {
  localStorage();
  const userId = crypto.randomUUID();
  let reject!: (error: Error) => void, started!: () => void;
  const requestStarted = new Promise<void>(done => { started = done; });
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((_, fail) => { reject = fail; started(); })).mockResolvedValueOnce(Response.json({ id: userId, iban: "DE89370400440532013000" }));
  vi.stubGlobal("fetch", fetch);
  const retained = settingsAutosaveRegistry.get(apiBackend, userId, patch => apiBackend.updateUser(patch), async () => {}, vi.fn());
  retained.saver.change("payment", "iban", { iban: "IE29AIBK93115212345678" }, true);
  await requestStarted;
  await apiBackend.updateUser({ iban: "DE89370400440532013000" });
  reject(new TypeError("offline")); await retained.saver.flushAll(); await retained.saver.flushAll();
  expect(retained.saver.getChanges()).toEqual({}); expect(fetch).toHaveBeenCalledTimes(2);
});

it("preserves newer queued edits while the autosave's own API retry completes", async () => {
  localStorage();
  const userId = crypto.randomUUID();
  let resolve!: (response: Response) => void, started!: () => void;
  const retryStarted = new Promise<void>(done => { started = done; });
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; started(); })).mockResolvedValueOnce(Response.json({ id: userId }));
  vi.stubGlobal("fetch", fetch);
  const retained = settingsAutosaveRegistry.get(apiBackend, userId, patch => apiBackend.updateUser(patch), async () => {}, vi.fn());
  retained.saver.change("payment", "iban", { iban: "IE29AIBK93115212345678" }, true); await retained.saver.flushAll();
  const retry = retained.saver.flushAll(); await retryStarted;
  retained.saver.change("payment", "iban", { iban: "DE89370400440532013000" }, true);
  resolve(Response.json({ id: userId, iban: "IE29AIBK93115212345678" })); await retry; await retained.saver.flushAll();
  expect(fetch.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))).toEqual([{ iban: "IE29AIBK93115212345678" }, { iban: "IE29AIBK93115212345678" }, { iban: "DE89370400440532013000" }]);
  expect(retained.getStates().payment.phase).toBe("saved");
});

it("also invalidates retained IBAN failures after a successful demo payment-details save", async () => {
  localStorage(); resetDemo();
  const { user } = await demoBackend.load(), save = vi.fn().mockRejectedValue(new TypeError("offline"));
  const retained = settingsAutosaveRegistry.get(demoBackend, user.id, save, async () => {}, vi.fn());
  retained.saver.change("payment", "iban", { iban: "IE29AIBK93115212345678" }, true); await retained.saver.flushAll();
  await demoBackend.updateUser({ iban: "DE89370400440532013000" });
  expect(retained.saver.getChanges()).toEqual({});
  await retained.saver.flushAll(); expect(save).toHaveBeenCalledTimes(1);
  expect((await demoBackend.load()).user.iban).toBe("DE89370400440532013000");
});

it("retains a save failing after unmount, notifies globally, and restores and retries it on remount", async () => {
  let reject!: (error: Error) => void;
  const request = new Promise<void>((_, fail) => { reject = fail; });
  const save = vi.fn().mockImplementationOnce(() => request).mockResolvedValue(undefined);
  const refresh = vi.fn().mockResolvedValue(undefined), notify = vi.fn(), registry = createSettingsAutosaveRegistry(), backend = {};
  const retained = registry.get(backend, "trader", save, refresh, notify);
  const page = new EventTarget(), document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const unmount = watchSettingsAutosave(retained, vi.fn(), page, document);
  retained.saver.change("profile", "name", { name: "Aoife" });
  unmount(); await Promise.resolve();
  expect(save).toHaveBeenCalledWith({ name: "Aoife" });
  reject(new TypeError("offline")); await retained.saver.flushAll();
  expect(notify).toHaveBeenCalledWith(expect.stringContaining("kept in this tab"));
  const remounted = registry.get(backend, "trader", save, refresh, notify);
  expect(remounted).toBe(retained);
  expect(remounted.saver.getChanges()).toEqual({ name: "Aoife" });
  const unmountAgain = watchSettingsAutosave(remounted, vi.fn(), page, document);
  await remounted.saver.flushAll();
  expect(save.mock.calls).toEqual([[{ name: "Aoife" }], [{ name: "Aoife" }]]);
  expect(remounted.saver.getChanges()).toEqual({});
  expect(remounted.getStates().profile.phase).toBe("saved");
  expect(registry.get(backend, "different-trader", save, refresh, notify).saver.getChanges()).toEqual({});
  expect(registry.get({}, "trader", save, refresh, notify)).not.toBe(retained);
  unmountAgain();
});

it("flushes pending text on hidden/pagehide and removes the page's lifecycle handlers on unmount", async () => {
  vi.useFakeTimers();
  const save = vi.fn().mockResolvedValue(undefined), retained = createSettingsAutosaveRegistry().get({}, "trader", save, async () => {}, vi.fn());
  const page = new EventTarget(), document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const removePage = vi.spyOn(page, "removeEventListener"), removeDocument = vi.spyOn(document, "removeEventListener");
  const unmount = watchSettingsAutosave(retained, vi.fn(), page, document);
  retained.saver.change("profile", "name", { name: "Aoife" });
  document.dispatchEvent(new Event("visibilitychange")); await Promise.resolve(); expect(save).not.toHaveBeenCalled();
  document.visibilityState = "hidden"; document.dispatchEvent(new Event("visibilitychange")); await retained.saver.flushAll();
  expect(save).toHaveBeenCalledTimes(1);
  retained.saver.change("profile", "name", { name: "Mary" });
  page.dispatchEvent(new Event("pagehide")); await retained.saver.flushAll();
  expect(save).toHaveBeenLastCalledWith({ name: "Mary" });
  unmount(); expect(removePage).toHaveBeenCalledWith("pagehide", expect.any(Function)); expect(removeDocument).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  await vi.runAllTimersAsync(); expect(save).toHaveBeenCalledTimes(2);
});
