import type { BookingDocumentData } from "./documents";

export interface DriveBackup {
  userId: string;
  logo: string | null;
  documents: (Omit<BookingDocumentData, "logo"> & { logo?: string | null })[];
  photos: { id: string; receiptKey: string | null; date: string; merchant: string | null; contentType: string }[];
  years: number[];
}

export interface BackupFile {
  replace?: boolean;
  path: string;
  kind: "document" | "photo" | "csv";
  index: number;
}

export function backupFiles(backup: DriveBackup): BackupFile[] {
  const folders = { invoice: "Invoices", receipt: "Receipts", quote: "Quotes" };
  return [
    ...backup.documents.map((document, index) => ({ path: `${folders[document.kind]}/${document.number}.pdf`, kind: "document" as const, index, ...(document.voided ? { replace: true } : {}) })),
    ...backup.photos.map((photo, index) => {
      const merchant = (photo.merchant ?? "receipt").replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 80) || "receipt";
      const extension = photo.contentType === "image/png" ? "png" : photo.contentType === "image/webp" ? "webp" : "jpg";
      return { path: `Expense photos/${photo.date}-${merchant}-${photo.id}.${extension}`, kind: "photo" as const, index };
    }),
    ...[...new Set(backup.years)].sort().map((year) => ({ path: `sorted-${year}.csv`, kind: "csv" as const, index: year })),
  ];
}

export function planDriveBackup(files: readonly BackupFile[], existing: readonly { path: string; id: string }[]) {
  const ids = new Map(existing.map((file) => [file.path, file.id]));
  return files.map((file) => {
    const id = ids.get(file.path);
    return { ...file, id, action: id ? file.kind === "csv" || file.replace ? "update" as const : "skip" as const : "create" as const };
  });
}
