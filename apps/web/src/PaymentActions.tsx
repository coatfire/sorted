import { useState } from "react";
import type { Payment } from "@sorted/core";
import { Button, Icon, MoneyText, Sheet } from "./components";
import type { BookingRow } from "./lib/backend";
import { euros, firstName, methodLabel, whatsappLink, paymentRecordedToast } from "./lib/format";
import { useAction, useData, useStore } from "./lib/store";
import { MessageOutcome } from "./MessageOutcome";

/** The two things you can do with money you're owed: chase it, or record it. */
export function PaymentActions({ payment, booking, showMarkPaid = true, owedCents }: { booking: BookingRow; showMarkPaid?: boolean } & ({ payment: Payment; owedCents?: never } | { payment?: never; owedCents: number })) {
  const { backend, toast } = useStore();
  const { features, user } = useData();
  const { busy, run, error, committed } = useAction();
  const [sheet, setSheet] = useState<"paid" | "link" | null>(null);
  const [link, setLink] = useState(payment?.linkUrl ?? null);
  const [channel, setChannel] = useState<"whatsapp" | null>(null);
  const amountCents = owedCents ?? payment!.amountCents;
  const client = booking.client;

  async function openLink() {
    setChannel(null);
    if (!link) {
      let created = "";
      const ok = await run(async () => {
        created = owedCents !== undefined ? await backend.bookingPaymentLink(booking.id) : await backend.paymentLink(payment!.id);
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
    `(${euros(amountCents)}): ${link}` +
    (user.businessName ? `\n— ${user.businessName}` : "");

  return (
    <>
      <div className="inline-actions">
        {features.paymentLinks && (
          <Button kind="soft" disabled={busy || Boolean(committed && error)} onClick={openLink}>
            <Icon name="message" size={17} /> Payment link
          </Button>
        )}
        {showMarkPaid && <Button kind="quiet" disabled={busy || Boolean(committed && error)} onClick={() => setSheet("paid")}>
          <Icon name="check" size={17} /> Mark paid
        </Button>}
      </div>
      {error && !sheet && <p className="sheet-copy" role="alert">{error}</p>}
      {error && committed && !sheet && <Button kind="quiet" onClick={() => window.location.reload()}>Reload</Button>}

      {sheet === "paid" && (
        <Sheet title="How were you paid?" onClose={() => setSheet(null)}>
          <p className="sheet-copy">
            <MoneyText cents={amountCents} /> from {client.name}
          </p>
          {error && <p className="sheet-copy" role="alert">{error}</p>}
          {committed && error && <Button kind="soft" onClick={() => window.location.reload()}>Reload</Button>}
          {(["cash", "bank_transfer", "revolut"] as const).map((method) => (
            <Button
              key={method}
              kind="soft"
              disabled={busy || Boolean(committed && error)}
              onClick={async () => {
                if (await run(() => owedCents !== undefined ? backend.recordPayment(booking.id, { amount_cents: owedCents, method }) : backend.markPaid(payment!.id, method), paymentRecordedToast(client.name, amountCents))) {
                  setSheet(null);
                }
              }}
            >
              {methodLabel(method)}
            </Button>
          ))}
          <Button kind="quiet" onClick={() => setSheet(null)}>Not yet</Button>
        </Sheet>
      )}

      {sheet === "link" && link && (
        <Sheet title="Payment link" onClose={() => setSheet(null)}>
          <p className="sheet-copy">
            {client.name} can pay <MoneyText cents={amountCents} /> by card. It’ll flip to
            paid here on its own.
          </p>
          <p className="link-box">{link}</p>
          {client.phone && (
            <a
              className="button button-primary"
              href={whatsappLink(client.phone, message)}
              onClick={() => setChannel("whatsapp")}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="message" size={17} /> Send on WhatsApp
            </a>
          )}
          <Button kind="soft" onClick={copy}><Icon name="copy" size={17} /> Copy link</Button>
          <MessageOutcome bookingId={booking.id} kind="payment_request" channel={channel} onClose={() => setSheet(null)} />
        </Sheet>
      )}
    </>
  );
}
