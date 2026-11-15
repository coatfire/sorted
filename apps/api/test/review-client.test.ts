import { describe, expect, it, vi } from "vitest";
import { completeAction, createActionGuard } from "../../web/src/lib/action";
import { jobDateLabel } from "../../web/src/lib/format";

describe("mutation completion", () => {
  it.each(["expense", "booking"])("blocks a second %s create after saving succeeds but reloading fails", async () => {
    const run = createActionGuard();
    const create = vi.fn(async () => {});
    const refresh = vi.fn(async () => { throw new Error("Network unavailable"); });
    const saved = vi.fn();
    await expect(run(create, refresh, saved)).rejects.toThrow("Saved, but the screen couldn't update");
    await expect(run(create, refresh, saved)).rejects.toThrow("Reload before recording anything else");
    expect(create).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
    expect(saved).toHaveBeenCalledOnce();
  });
  it("allows subsequent creates after a successful reload", async () => {
    const run = createActionGuard();
    const create = vi.fn(async () => {});
    const refresh = vi.fn(async () => {});
    await run(create, refresh, vi.fn());
    await run(create, refresh, vi.fn());
    expect(create).toHaveBeenCalledTimes(2);
  });
  it("allows retrying a rejected create without claiming it was saved", async () => {
    const run = createActionGuard();
    const saved = vi.fn();
    const refresh = vi.fn(async () => {});
    await expect(run(async () => { throw new Error("Invalid expense"); }, refresh, saved)).rejects.toThrow("Invalid expense");
    expect(saved).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    await run(async () => {}, refresh, saved);
    expect(saved).toHaveBeenCalledOnce();
  });
  it("finishes only after both saving and reloading succeed", async () => {
    const steps: string[] = [];
    await completeAction(async () => { steps.push("write"); }, async () => { steps.push("reload"); }, () => { steps.push("saved"); });
    expect(steps).toEqual(["write", "saved", "reload"]);
  });
  it("keeps a rejected write's error and never reloads or claims it was saved", async () => {
    const reload = vi.fn();
    const saved = vi.fn();
    await expect(completeAction(async () => { throw new Error("That's more than the €55.00 still owed."); }, reload, saved)).rejects.toThrow("€55.00");
    expect(reload).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
  });
});

describe("outstanding job dates in Ireland", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  it("names the upcoming job date, not the age of its deposit row", () => {
    expect(jobDateLabel("2026-11-18T10:00:00Z", now)).toBe("job on Wed 18 Nov");
  });
  it("uses plain wording for past and same-day jobs", () => {
    expect(jobDateLabel("2026-11-13T10:00:00Z", now)).toBe("job was 2 days ago");
    expect(jobDateLabel("2026-11-14T10:00:00Z", now)).toBe("job was 1 day ago");
    expect(jobDateLabel("2026-11-15T10:00:00Z", now)).toBe("job today");
  });
  it("uses Irish calendar days across midnight and the clock change", () => {
    expect(jobDateLabel("2026-07-02T09:00:00Z", new Date("2026-07-01T23:30:00Z"))).toBe("job today");
    expect(jobDateLabel("2026-10-24T23:30:00Z", new Date("2026-10-26T00:30:00Z"))).toBe("job was 1 day ago");
  });
  it("rejects an invalid date instead of describing a nonexistent job", () => {
    expect(() => jobDateLabel("", now)).toThrow();
  });
});
