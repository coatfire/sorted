import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { clientSheet, clientTemplate, formatPhone, IMPORT_MAX_CLIENTS, planClientImport, readTable, type ClientSheet, type ImportBatch, type ImportClientRow, type ImportClientsResult } from "@sorted/core";
import { BackButton, Button, Card, Icon, PageHeader } from "../components";
import { useAction, useData, useStore } from "../lib/store";
import { dayMonth } from "../lib/format";

const people = (count: number) => `${count} ${count === 1 ? "client" : "clients"}`;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Preview { fileName: string; sheet: ClientSheet; add: ImportClientRow[]; alreadyThere: number; repeated: number }

export function ClientImport() {
  const { clients } = useData();
  const { backend } = useStore();
  const { busy, run, error } = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [preview, setPreview] = useState<Preview>();
  const [done, setDone] = useState<ImportClientsResult>();

  async function picked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReading(true); setProblem(undefined); setPreview(undefined); setDone(undefined);
    try {
      const sheet = clientSheet(await readTable(file));
      const plan = planClientImport(sheet.rows, clients);
      if (!sheet.rows.length) setProblem("That file has headings but no clients under them.");
      else if (plan.add.length > IMPORT_MAX_CLIENTS) setProblem(`That file has ${plan.add.length} new clients. Sorted adds up to ${IMPORT_MAX_CLIENTS} at a time, so split it into smaller files.`);
      else setPreview({ fileName: file.name, sheet, ...plan });
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Sorted couldn't read that file.");
    } finally { setReading(false); }
  }

  const skipped = preview ? [
    preview.alreadyThere && `${people(preview.alreadyThere)} already in Sorted`,
    preview.repeated && `${preview.repeated} repeated in the file`,
    preview.sheet.noName && `${preview.sheet.noName} ${preview.sheet.noName === 1 ? "row" : "rows"} with no name`,
  ].filter(Boolean) : [];

  return <div className="page">
    <BackButton to="/clients" />
    <PageHeader eyebrow="Clients" title="Import your client list" />
    {done ? <Card className="form-card import-card">
      <h2>{done.added ? `${people(done.added)} added` : "Nothing new to add"}</h2>
      {done.alreadyThere > 0 && <p className="sheet-copy">{people(done.alreadyThere)} {done.alreadyThere === 1 ? "was" : "were"} already in Sorted and left as they were.</p>}
      {done.added > 0 && <p className="sheet-copy">Changed your mind? You can undo this import in Settings.</p>}
      <Link className="button button-primary" to="/clients">See your clients</Link>
      <Button kind="quiet" onClick={() => setDone(undefined)}>Import another file</Button>
    </Card> : preview ? <Card className="form-card import-card">
      <p className="eyebrow">{preview.fileName}</p>
      <h2>{preview.add.length ? `${people(preview.add.length)} to add` : "Nothing new to add"}</h2>
      {skipped.length > 0 && <p className="sheet-copy">Left out: {skipped.join(", ")}.</p>}
      {(preview.sheet.unreadPhones > 0 || preview.sheet.unreadEmails > 0) && <p className="sheet-copy">
        {[preview.sheet.unreadPhones && `${preview.sheet.unreadPhones} phone ${preview.sheet.unreadPhones === 1 ? "number" : "numbers"}`, preview.sheet.unreadEmails && `${preview.sheet.unreadEmails} ${preview.sheet.unreadEmails === 1 ? "email" : "emails"}`].filter(Boolean).join(" and ")} couldn’t be read. They’re kept in the client’s notes as written.
      </p>}
      <dl className="import-columns">
        {(["name", "phone", "email", "notes"] as const).map((column) => <div key={column}><dt>{column[0]!.toUpperCase() + column.slice(1)}</dt><dd>{preview.sheet.columns[column] ? `from “${preview.sheet.columns[column]}”` : "not in this file"}</dd></div>)}
      </dl>
      {preview.add.length > 0 && <>
        <p className="chart-title">First {Math.min(5, preview.add.length)} of {preview.add.length}</p>
        <ul className="import-sample">{preview.add.slice(0, 5).map((row, index) => <li key={index}><strong>{row.name}</strong><span>{[formatPhone(row.phone), row.email].filter(Boolean).join(" · ") || "No contact details"}</span></li>)}</ul>
      </>}
      <p className="sheet-copy">Nothing is saved until you confirm. No messages are sent to anyone.</p>
      {error && <p role="alert" className="sheet-copy">{error}</p>}
      {preview.add.length > 0 && <Button disabled={busy} onClick={async () => {
        let result: ImportClientsResult | undefined;
        if (await run(async () => { result = await backend.importClients(preview.fileName, preview.add); }) && result) { setDone(result); setPreview(undefined); }
      }}>{busy ? "Adding…" : `Add ${people(preview.add.length)}`}</Button>}
      <Button kind="quiet" disabled={busy} onClick={() => setPreview(undefined)}>Choose a different file</Button>
    </Card> : <Card className="form-card import-card">
      <p className="sheet-copy">Upload a spreadsheet of your clients: an Excel file (.xlsx) or a CSV. Sorted needs a column of names. Phone, email and notes are optional.</p>
      <p className="sheet-copy">Files exported from Google Contacts, Outlook or another booking app usually work as they are.</p>
      {problem && <p role="alert" className="import-problem">{problem}</p>}
      <Button disabled={reading} onClick={() => input.current?.click()}><Icon name="download" size={18} /> {reading ? "Reading…" : "Choose a file"}</Button>
      <Button kind="quiet" onClick={async () => download(await clientTemplate(), "sorted-clients-template.xlsx")}>Download a template to fill in</Button>
      <input ref={input} className="visually-hidden" type="file" name="client-file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={picked} tabIndex={-1} aria-hidden="true" />
    </Card>}
  </div>;
}

/** Settings: where import lives after setup, and where an import can be undone. */
export function ImportSettings() {
  const { backend } = useStore();
  const { busy, run, error } = useAction();
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [confirming, setConfirming] = useState<string>();
  const [outcome, setOutcome] = useState<string>();
  useEffect(() => { let live = true; backend.imports().then((rows) => { if (live) setBatches(rows); }).catch(() => {}); return () => { live = false; }; }, [backend]);
  return <section className="settings-section"><h2>Import</h2>
    <p className="sheet-copy">Bring your client list in from a spreadsheet.</p>
    <Card className="form-card">
      <Link className="button button-soft" to="/clients/import">Import clients</Link>
      {batches.map((batch) => <div className="import-batch" key={batch.id}>
        <div><strong>{batch.fileName ?? "Imported list"}</strong><span>{dayMonth(batch.createdAt)} · {people(batch.clients)}</span></div>
        {confirming === batch.id
          ? <Button kind="danger" disabled={busy} onClick={async () => {
            if (await run(async () => {
              const { removed, kept } = await backend.undoImport(batch.id);
              setOutcome(`${people(removed)} removed.${kept ? ` ${people(kept)} kept because they have bookings.` : ""}`);
              setBatches(await backend.imports());
            })) setConfirming(undefined);
          }}>Remove {people(batch.clients)}</Button>
          : <Button kind="quiet" onClick={() => { setConfirming(batch.id); setOutcome(undefined); }}>Undo</Button>}
      </div>)}
      {confirming && <p className="sheet-copy">Clients from this import who have a booking are kept.</p>}
      {outcome && <p className="sheet-copy" role="status">{outcome}</p>}
      {error && <p role="alert" className="sheet-copy">{error}</p>}
    </Card>
  </section>;
}
