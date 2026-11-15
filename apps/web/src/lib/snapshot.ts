import type { Snapshot } from "./backend";

export function patchSnapshotUser(current: Snapshot | null, userId: string, patch: Partial<Omit<Snapshot["user"], "id">>): Snapshot | null {
  if (!current || current.user.id !== userId) return current;
  return { ...current, user: { ...current.user, ...patch } };
}
