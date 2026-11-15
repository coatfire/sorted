import { backupFiles, planDriveBackup } from "@sorted/core";
import type { Backend } from "./backend";
import { DriveError } from "./driveErrors";

const scope = "https://www.googleapis.com/auth/drive.file";
interface TokenResponse { access_token?: string; error?: string; scope?: string }
interface GoogleIdentity {
  accounts: { oauth2: { initTokenClient(options: {
    client_id: string; scope: string; include_granted_scopes: false;
    callback: (response: TokenResponse) => void; error_callback: (error?: { type?: string }) => void;
  }): { requestAccessToken(): void } } };
}
const google = () => (window as Window & { google?: GoogleIdentity }).google;
let scriptLoading: Promise<void> | undefined;

function loadIdentity() {
  if (google()?.accounts.oauth2) return Promise.resolve();
  return scriptLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    const timeout = window.setTimeout(() => { script.remove(); reject(new DriveError("network")); }, 20000);
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new DriveError("network")); };
    document.head.append(script);
  }).catch((error: unknown) => { scriptLoading = undefined; throw error; });
}

export async function prepareDriveBackup(clientId: string) {
  await loadIdentity();
  const identity = google();
  if (!identity) throw new DriveError("failed");
  let pending: { resolve: (token: string) => void; reject: (error: Error) => void } | undefined;
  const client = identity.accounts.oauth2.initTokenClient({
      client_id: clientId, scope, include_granted_scopes: false,
      callback: (response) => {
        if (response.error || !response.access_token || !response.scope?.split(" ").includes(scope)) pending?.reject(new DriveError("permission"));
        else pending?.resolve(response.access_token);
        pending = undefined;
      },
      error_callback: error => { pending?.reject(new DriveError(error?.type === "popup_failed_to_open" ? "popup_blocked" : "popup_closed")); pending = undefined; },
  });
  return () => new Promise<string>((resolve, reject) => {
    pending = { resolve, reject };
    client.requestAccessToken();
  });
}

interface DriveFile { id: string; name: string; mimeType: string }

export async function backUpToDrive(tokenResponse: Promise<string>, backend: Backend, progress: (done: number, total: number) => void) {
  let token: string | undefined = await tokenResponse;
  try {
    const request = async (url: string, init: RequestInit = {}) => {
      const response = await fetch(`https://www.googleapis.com/${url}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const reason = await response.text();
        if (response.status === 403 && /accessNotConfigured|SERVICE_DISABLED|(?:Drive API|drive.googleapis.com).*(?:disabled|not.*enabled|not.*used)/i.test(reason)) throw new DriveError("not_configured");
        throw new DriveError(response.status === 401 || (response.status === 403 && /insufficientPermissions|PERMISSION_DENIED|access_denied/i.test(reason)) ? "permission" : "failed");
      }
      return response;
    };
    const literal = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
    const list = async (q: string) => {
      const files: DriveFile[] = [];
      let pageToken = "";
      do {
        const params = new URLSearchParams({ q: `trashed = false and (${q})`, fields: "nextPageToken,files(id,name,mimeType)", pageSize: "1000", ...(pageToken ? { pageToken } : {}) });
        const page = await (await request(`drive/v3/files?${params}`)).json() as { files: DriveFile[]; nextPageToken?: string };
        files.push(...page.files); pageToken = page.nextPageToken ?? "";
      } while (pageToken);
      return files;
    };
    const backup = await backend.driveFiles();
    const files = backupFiles(backup);
    if (!files.length) return { driveBackedUpAt: null };
    const folderType = "application/vnd.google-apps.folder";
    const createFolder = async (name: string, parent?: string) => {
      const response = await request("drive/v3/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: folderType, ...(parent ? { parents: [parent] } : { appProperties: { sortedUser: backup.userId } }) }) });
      return (await response.json() as { id: string }).id;
    };
    const roots = await list(`name = 'Sorted' and mimeType = '${folderType}' and appProperties has { key='sortedUser' and value=${literal(backup.userId)} }`);
    const root = roots[0]?.id ?? await createFolder("Sorted");
    const rootFiles = await list(`${literal(root)} in parents`);
    const folders = new Map(rootFiles.filter((file) => file.mimeType === folderType).map((file) => [file.name, file.id]));
    const existing = rootFiles.filter((file) => file.mimeType !== folderType).map((file) => ({ path: file.name, id: file.id }));
    for (const name of new Set(files.filter((file) => file.path.includes("/")).map((file) => file.path.split("/")[0]))) {
      const id = folders.get(name);
      if (id) for (const file of await list(`${literal(id)} in parents`)) if (file.mimeType !== folderType) existing.push({ path: `${name}/${file.name}`, id: file.id });
    }
    const plan = planDriveBackup(files, existing);
    let done = 0;
    progress(done, plan.length);
    for (const file of plan) {
      if (file.action !== "skip") {
        let blob: Blob;
        if (file.kind === "document") {
          const { createBookingPdf } = await import("./bookingPdf");
          const document = backup.documents[file.index];
          blob = await createBookingPdf({ ...document, logo: document.logo === undefined ? backup.logo : document.logo });
        } else if (file.kind === "csv") blob = await backend.exportCsv(file.index);
        else {
          const photo = backup.photos[file.index];
          const url = await backend.receiptUrl(photo);
          if (!url) throw new Error("Receipt unavailable");
          try {
            const response = await fetch(url);
            if (!response.ok) throw new Error("Receipt unavailable");
            blob = await response.blob();
          } finally { URL.revokeObjectURL(url); }
        }
        const parts = file.path.split("/");
        let parent = root;
        if (parts.length > 1) {
          const folder = parts[0];
          parent = folders.get(folder) ?? await createFolder(folder, root);
          folders.set(folder, parent);
        }
        const metadata = { name: parts.at(-1), mimeType: blob.type || "application/octet-stream", ...(file.action === "create" ? { parents: [parent] } : {}) };
        const boundary = `sorted-${crypto.randomUUID()}`;
        const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`, blob, `\r\n--${boundary}--\r\n`]);
        await request(`upload/drive/v3/files${file.id ? `/${encodeURIComponent(file.id)}` : ""}?uploadType=multipart`, { method: file.action === "update" ? "PATCH" : "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
      }
      progress(++done, plan.length);
    }
    return await backend.driveBackedUp();
  } finally { token = undefined; }
}
