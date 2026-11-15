export class DriveError extends Error {
  constructor(public code: "popup_closed" | "popup_blocked" | "permission" | "not_configured" | "network" | "failed") { super(code); }
}
export function driveErrorMessage(error: unknown, offline = typeof navigator !== "undefined" && navigator.onLine === false) {
  const code = error instanceof DriveError ? error.code : offline || error instanceof TypeError ? "network" : "failed";
  const reason = {
    popup_closed: "The Google window was closed. Open it again to save your copy.",
    popup_blocked: "Your browser blocked the Google window. Allow pop-ups for Sorted and try again.",
    permission: "Access to Google Drive wasn't granted. Please allow access and try again.",
    not_configured: "Google Drive isn't switched on for Sorted yet. Please try again later.",
    network: "Couldn't reach Google Drive. Check your connection and try again.",
    failed: "Your copy couldn't be saved to Google Drive. Please try again.",
  }[code];
  return `${reason} Nothing was lost.`;
}
