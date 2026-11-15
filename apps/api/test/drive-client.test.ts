/// <reference path="../../web/src/vite-env.d.ts" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { backUpToDrive, prepareDriveBackup } from "../../web/src/lib/driveBackup";
import type { Backend } from "../../web/src/lib/backend";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function fixture({ failUpload = false, closePopup = false, empty = false } = {}) {
  const scope = "https://www.googleapis.com/auth/drive.file";
  const tokenClient = vi.fn((options: { scope: string; include_granted_scopes: boolean; callback: (value: { access_token: string; scope: string }) => void; error_callback: () => void }) => {
    expect(options.scope).toBe(scope);
    expect(options.include_granted_scopes).toBe(false);
    return { requestAccessToken: requestAccessToken.mockImplementation(() => closePopup ? options.error_callback() : options.callback({ access_token: "test-drive-token", scope })) };
  });
  const requestAccessToken = vi.fn();
  const identity = { accounts: { oauth2: { initTokenClient: tokenClient } } };
  vi.stubGlobal("window", { google: identity });
  const uploads: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-drive-token");
    if (url.includes("upload/drive/")) {
      uploads.push({ url, init });
      if (failUpload && uploads.length === 2) return Response.json({ error: "quota exceeded" }, { status: 403 });
      return Response.json({ id: "uploaded" });
    }
    const query = new URL(url).searchParams.get("q")!;
    if (query.includes("appProperties")) {
      expect(query).toContain("user-1");
      return Response.json({ files: [{ id: "root", name: "Sorted", mimeType: "application/vnd.google-apps.folder" }] });
    }
    return Response.json({ files: [{ id: "csv-2024", name: "sorted-2024.csv", mimeType: "text/csv" }] });
  });
  vi.stubGlobal("fetch", fetchMock);
  const backedUp = vi.fn(async () => { expect(uploads).toHaveLength(2); return { driveBackedUpAt: "2026-07-01T12:00:00Z" }; });
  const backend = {
    driveFiles: vi.fn(async () => ({ userId: "user-1", logo: null, documents: [], photos: [], years: empty ? [] : [2024, 2026] })),
    exportCsv: vi.fn(async () => new Blob(["INCOME"], { type: "text/csv" })),
    driveBackedUp: backedUp,
  } as unknown as Backend;
  return { backend, uploads, fetchMock, tokenClient, requestAccessToken, identity, backedUp };
}

describe("browser-driven Drive backup", () => {
  it("preloads a cold GIS script and client without opening a popup, then requests synchronously on tap", async () => {
    const f = fixture();
    const script = { src: "", async: false, onload: () => {}, onerror: () => {}, remove: vi.fn() };
    const append = vi.fn();
    vi.stubGlobal("window", { setTimeout });
    vi.stubGlobal("document", { createElement: () => script, head: { append } });
    const preparing = prepareDriveBackup("test-client");
    expect(script.src).toBe("https://accounts.google.com/gsi/client");
    expect(append).toHaveBeenCalledWith(script);
    expect(f.tokenClient).not.toHaveBeenCalled();
    vi.stubGlobal("window", { google: f.identity });
    script.onload();
    const requestToken = await preparing;
    expect(f.tokenClient).toHaveBeenCalledOnce();
    expect(f.requestAccessToken).not.toHaveBeenCalled();
    const token = requestToken();
    expect(f.requestAccessToken).toHaveBeenCalledOnce();
    expect(await token).toBe("test-drive-token");
    expect(f.fetchMock).not.toHaveBeenCalled();
  });
  it("updates old CSVs, creates missing CSVs and marks completion only after every upload", async () => {
    const f = fixture();
    const progress = vi.fn();
    const requestToken = await prepareDriveBackup("test-client");
    expect(await backUpToDrive(requestToken(), f.backend, progress)).toEqual({ driveBackedUpAt: "2026-07-01T12:00:00Z" });
    expect(f.uploads.map(({ init }) => init.method)).toEqual(["PATCH", "POST"]);
    expect(f.uploads[0].url).toContain("/files/csv-2024?");
    expect(f.uploads[0].init.headers).toMatchObject({ "Content-Type": expect.stringContaining("multipart/related; boundary=") });
    expect(await (f.uploads[0].init.body as Blob).text()).toContain("sorted-2024.csv");
    expect(progress.mock.calls).toEqual([[0, 2], [1, 2], [2, 2]]);
    expect(f.backedUp).toHaveBeenCalledOnce();
  });
  it("never records a backup when a later upload fails", async () => {
    const f = fixture({ failUpload: true });
    const requestToken = await prepareDriveBackup("test-client");
    await expect(backUpToDrive(requestToken(), f.backend, vi.fn())).rejects.toThrow();
    expect(f.uploads).toHaveLength(2);
    expect(f.backedUp).not.toHaveBeenCalled();
  });
  it("does not upload or mark completion after popup dismissal", async () => {
    const f = fixture({ closePopup: true });
    const requestToken = await prepareDriveBackup("test-client");
    await expect(backUpToDrive(requestToken(), f.backend, vi.fn())).rejects.toThrow();
    expect(f.fetchMock).not.toHaveBeenCalled();
    expect(f.backedUp).not.toHaveBeenCalled();
  });
  it("does not claim a backup when there are no files", async () => {
    const f = fixture({ empty: true });
    const requestToken = await prepareDriveBackup("test-client");
    expect(await backUpToDrive(requestToken(), f.backend, vi.fn())).toEqual({ driveBackedUpAt: null });
    expect(f.fetchMock).not.toHaveBeenCalled();
    expect(f.backedUp).not.toHaveBeenCalled();
  });
});
