import { useState } from "react";
import type { MessageSentInput } from "@sorted/core";
import { Button } from "./components";
import { useAction, useStore } from "./lib/store";

export function MessageOutcome({ bookingId, kind, channel, onClose }: {
  bookingId: string;
  kind: MessageSentInput["kind"];
  channel: MessageSentInput["channel"] | null;
  onClose: () => void;
}) {
  const { backend } = useStore();
  const { run, busy, error, committed } = useAction();
  const [acknowledgementId] = useState(() => crypto.randomUUID());
  return <>
    {channel && <>
      <p className="sheet-copy">Only tap “I sent it” if you sent the message. This records your acknowledgement, not verified delivery.{kind === "follow_up" && " We’ll show this enquiry again in 3 days, until you confirm or cancel it."}</p>
      {error && <p className="sheet-copy" role="alert">{error}</p>}
      {committed && error && <Button kind="soft" onClick={() => window.location.reload()}>Reload</Button>}
      <Button disabled={busy || committed} onClick={async () => {
        if (await run(() => backend.messageSent(bookingId, { kind, channel, acknowledgement_id: acknowledgementId }), kind === "follow_up" ? "Follow-up saved — back in 3 days" : kind === "payment_request" ? "Marked as asked" : "Sending acknowledged")) onClose();
      }}>I sent it</Button>
    </>}
    <Button kind="quiet" disabled={busy} onClick={onClose}>Close</Button>
  </>;
}
