const savedReloadError = "Saved, but the screen couldn't update. Reload before recording anything else.";

export async function completeAction(work: () => Promise<unknown>, refresh: () => Promise<void>, saved: () => void) {
  await work();
  saved();
  try {
    await refresh();
  } catch {
    throw new Error(savedReloadError);
  }
}

export function createActionGuard() {
  let committed = false;
  return async (work: () => Promise<unknown>, refresh: () => Promise<void>, saved: () => void) => {
    if (committed) throw new Error(savedReloadError);
    await completeAction(work, refresh, () => {
      committed = true;
      saved();
    });
    committed = false;
  };
}
