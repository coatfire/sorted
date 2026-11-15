export async function completeAction(work: () => Promise<unknown>, refresh: () => Promise<void>, saved: () => void) {
  await work();
  saved();
  try {
    await refresh();
  } catch {
    throw new Error("Saved, but the screen couldn't update. Reload before recording anything else.");
  }
}
