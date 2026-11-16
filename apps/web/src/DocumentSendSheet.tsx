import { documentMessage, documentNumber, type IssuedDocument } from "@sorted/core";
import { useEffect, useState } from "react";
import { Button, Sheet } from "./components";
import type { BookingRow } from "./lib/backend";
import { buildDocumentFile, canShareFile, downloadFile, shareFile, type DocumentFile } from "./lib/documentFile";
import { whatsappLink } from "./lib/format";
import { useData, useStore } from "./lib/store";
import { MessageOutcome } from "./MessageOutcome";

const TITLE = { invoice: "Invoice", receipt: "Receipt", quote: "Quote" } as const;

/** Send an issued PDF with a draft message. Nothing is sent by Sorted: the trader sends it and says so. */
export function DocumentSendSheet({ document, booking, onClose }: { document: IssuedDocument; booking: BookingRow; onClose: () => void }) {
  const { user, payments } = useData();
  const { backend, toast } = useStore();
  const number = documentNumber(document.kind, document.number);
  const [askReview, setAskReview] = useState(document.kind === "receipt" && !!user.reviewLink);
  const [prepared, setPrepared] = useState<DocumentFile | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [channel, setChannel] = useState<"whatsapp" | "email" | "share" | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [otherWay, setOtherWay] = useState(false);

  // Built up front so the tap on Send can open the share sheet straight away.
  useEffect(() => {
    let live = true;
    buildDocumentFile(backend, user, booking, payments, document.kind, document.paymentId ?? undefined)
      .then((file) => { if (live) setPrepared(file); })
      .catch((error: unknown) => { if (live) setFailed(error instanceof Error ? error.message : "Couldn't create that PDF. Try again."); });
    return () => { live = false; };
  }, [document.id]);

  const client = booking.client;
  const message = documentMessage({
    kind: document.kind, number, client: client.name, business: user.businessName || user.name || "your trader",
    service: booking.service, reviewLink: askReview ? user.reviewLink : null,
  });
  const canShare = prepared !== null && canShareFile(prepared.file);
  const share = canShare && !otherWay;
  const subject = `${TITLE[document.kind]} ${number}`;
  const email = client.email ? `mailto:${encodeURIComponent(client.email).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}` : null;

  const copyMessage = () => navigator.clipboard?.writeText(message).then(() => true, () => false) ?? Promise.resolve(false);
  async function send() {
    if (!prepared) return;
    // Sharing goes first: a browser can refuse the share menu if the tap has already been used for something else.
    const sharing = shareFile(prepared, message);
    void copyMessage();
    const outcome = await sharing;
    if (outcome === "shared") setChannel("share");
    if (outcome === "failed") {
      setOtherWay(true);
      toast("The share menu didn’t open. Use WhatsApp, Email or Download instead.", "error");
    }
  }
  function saveForDraft() {
    if (!prepared || downloaded) return;
    setDownloaded(true);
    downloadFile(prepared);
  }

  return (
    <Sheet title={`Send ${TITLE[document.kind].toLowerCase()} ${number}`} onClose={onClose}>
      <p className="sheet-copy message-preview">{message}</p>
      {user.reviewLink ? (
        <label className="check-row">
          <input type="checkbox" checked={askReview} onChange={(event) => setAskReview(event.target.checked)} />
          <span>Ask for a Google review</span>
        </label>
      ) : (
        <p className="sheet-copy">Add your Google review link in Settings to ask for a review here.</p>
      )}
      {failed && <p className="sheet-copy" role="alert">{failed}</p>}
      {share ? <>
        <p className="sheet-copy">Opens your phone’s share menu with the PDF. Pick WhatsApp or Mail, choose {client.name}, and send it there. The message is also copied, so you can paste it if it’s missing.</p>
        <Button onClick={() => { void send(); }}>Send PDF</Button>
        <button type="button" className="text-link" onClick={() => setOtherWay(true)}>Share menu not opening? Send it another way</button>
      </> : <>
        <p className="sheet-copy">WhatsApp or Email saves the PDF to this device’s Downloads and opens a draft with the message. Attach the PDF to the draft and send it there.</p>
        {client.phone && prepared ? (
          <a className="button button-primary" href={whatsappLink(client.phone, message)} onClick={() => { saveForDraft(); setChannel("whatsapp"); }} target="_blank" rel="noreferrer">WhatsApp</a>
        ) : (
          <>
            <Button disabled aria-describedby="document-no-phone">WhatsApp</Button>
            {!client.phone && <p className="sheet-copy" id="document-no-phone">No mobile number added for this client. Add one in their details.</p>}
          </>
        )}
        {email && prepared ? (
          <a className="button button-soft" href={email} onClick={() => { saveForDraft(); setChannel("email"); }}>Email</a>
        ) : (
          <>
            <Button kind="soft" disabled aria-describedby="document-no-email">Email</Button>
            {!client.email && <p className="sheet-copy" id="document-no-email">No email address added for this client. Add one in their details.</p>}
          </>
        )}
        <div className="button-pair">
          <Button kind="quiet" disabled={!prepared} onClick={() => {
            if (!prepared) return;
            downloadFile(prepared);
            setDownloaded(true);
            setChannel((current) => current ?? "share");
            toast("PDF downloaded");
          }}>Download PDF</Button>
          <Button kind="quiet" onClick={async () => { if (await copyMessage()) toast("Message copied"); else toast("Couldn’t copy. Press and hold the message above to copy it.", "error"); }}>Copy message</Button>
        </div>
      </>}
      <MessageOutcome bookingId={booking.id} kind="document" channel={channel} documentId={document.id} reviewIncluded={askReview} onClose={onClose} />
    </Sheet>
  );
}
