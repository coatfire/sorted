import { assembleBookingDocument, type BookingDocumentData, type DocumentKind, type Payment, type User } from "@sorted/core";
import type { Backend, BookingRow } from "./backend";
import { download } from "./image";

export interface DocumentFile { file: File; data: BookingDocumentData }

/** Issues the document if it doesn't exist yet, then renders its frozen PDF. */
export async function buildDocumentFile(backend: Backend, user: User, booking: BookingRow, payments: readonly Payment[], kind: DocumentKind, paymentId?: string): Promise<DocumentFile> {
  const record = await backend.document(booking.id, kind, paymentId);
  const data = assembleBookingDocument(user, booking, booking.client, payments, record);
  const { createBookingPdf } = await import("./bookingPdf");
  const blob = await createBookingPdf(data);
  return { file: new File([blob], `${data.number}.pdf`, { type: "application/pdf" }), data };
}

export const canShareFile = (file: File) => typeof navigator.share === "function" && navigator.canShare?.({ files: [file] }) === true;

/** Phone share sheet when available, otherwise a download. Resolves to what happened. */
export async function shareOrDownload({ file, data }: DocumentFile, text?: string): Promise<"shared" | "cancelled" | "downloaded"> {
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: `${data.title} ${data.number}`, ...(text ? { text } : {}) });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  download(file, file.name);
  return "downloaded";
}
