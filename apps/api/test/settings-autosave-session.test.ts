import { afterEach, expect, it, vi } from "vitest";
import { createSettingsAutosaveRegistry, watchSettingsAutosave } from "../../web/src/lib/settingsAutosaveSession";

afterEach(() => vi.useRealTimers());

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
