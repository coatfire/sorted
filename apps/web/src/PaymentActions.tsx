import { useState } from "react";
import type { Payment } from "@sorted/core";
import { Button, Icon, MoneyText, Sheet } from "./components";
import type { BookingRow } from "./lib/backend";
import { euros, firstName, whatsappLink } from "./lib/format";
import { useAction, useData, useStore } from "./lib/store";

/** The two things you can do with money you're owed: chase it, or record it. */
export function PaymentActions({ payment, booking }: { payment: Payment; booking: BookingRow }) {
  const { backend, toast } = useStore();
  const { features, user } = useData();
  const { busy, run } = useAction();
  const [sheet, setSheet] = useState<"paid" | "link" | null>(null);
  const [link, setLink] = useState(payment.linkUrl);
  const client = booking.client;

  async function openLink() {
    if (!link) {
      let created = "";
      const ok = await run(async () => {
        created = await backend.paymentLink(payment.id);
      });
      if (!ok) return;
      setLink(created);
    }
    setSheet("link");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link!);
      toast("Link copied");
    } catch {
      toast("Couldn't copy — press and hold the link to copy it.", "error");
    }
  }

  const message =
    `Hi ${firstName(client.name)}, here's the payment link for your ${booking.service} ` +
    `(${euros(payment.amountCents)}): ${link}` +
    (user.businessName ? `\n— ${user.businessName}` : "");

  return (
    <>
      <div className="inline-actions">
        {features.paymentLinks && (
          <Button kind="soft" disabled={busy} onClick={openLink}>
            <Icon name="message" size={17} /> Payment link
          </Button>
        )}
        <Button kind="quiet" disabled={busy} onClick={() => setSheet("paid")}>
          <Icon name="check" size={17} /> Mark paid
        </Button>
      </div>

      {sheet === "paid" && (
        <Sheet title="How were you paid?" onClose={() => setSheet(null)}>
          <p className="sheet-copy">
            <MoneyText cents={payment.amountCents} /> from {client.name}
          </p>
          {(["cash", "bank_transfer"] as const).map((method) => (
            <Button
              key={method}
              kind="soft"
              disabled={busy}
              onClick={async () => {
                if (await run(() => backend.markPaid(payment.id, method), "Marked paid")) {
                  setSheet(null);
                }
              }}
            >
              {method === "cash" ? "Cash" : "Bank transfer"}
            </Button>
          ))}
          <Button kind="quiet" onClick={() => setSheet(null)}>Not yet</Button>
        </Sheet>
      )}

      {sheet === "link" && link && (
        <Sheet title="Payment link" onClose={() => setSheet(null)}>
          <p className="sheet-copy">
            {client.name} can pay <MoneyText cents={payment.amountCents} /> by card. It’ll flip to
            paid here on its own.
            {features.automation && client.phone && " Sorted has sent it on WhatsApp."}
          </p>
          <p className="link-box">{link}</p>
          {client.phone && (
            <a
              className="button button-primary"
              href={whatsappLink(client.phone, message)}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="message" size={17} /> Send on WhatsApp
            </a>
          )}
          <Button kind="soft" onClick={copy}><Icon name="copy" size={17} /> Copy link</Button>
          <Button kind="quiet" onClick={() => setSheet(null)}>Done</Button>
        </Sheet>
      )}
    </>
  );
}
