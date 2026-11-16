import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  heldHistory, historySheet, historyTemplate, IMPORT_MAX_HISTORY_ROWS, NO_CLIENT, planHistoryImport, readTables,
  type HistoryExpenseRow, type HistoryIncomeRow, type HistorySheet, type ImportHistoryResult,
} from "@sorted/core";
import { BackButton, Button, Card, Icon, PageHeader } from "../components";
import { useAction, useData, useStore } from "../lib/store";
import { euros } from "../lib/format";
import { download } from "../lib/image";

const count = (total: number, one: string, many = `${one}s`) => `${total} ${total === 1 ? one : many}`;
const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const both = (payments: number, expenses: number) => [payments && count(payments, "payment"), expenses && count(expenses, "expense")].filter(Boolean).join(" and ");

interface Preview { fileName: string; sheet: HistorySheet; income: HistoryIncomeRow[]; expenses: HistoryExpenseRow[]; alreadyThere: number; newClients: number }

/** Income and expenses per year, so a trader can check the figures against what they expect before saving. */
function years(income: HistoryIncomeRow[], expenses: HistoryExpenseRow[]) {
  const totals = new Map<string, { income: number; expenses: number }>();
  const year = (date: string) => { const key = date.slice(0, 4); if (!totals.has(key)) totals.set(key, { income: 0, expenses: 0 }); return totals.get(key)!; };
  for (const row of income) year(row.paid_on).income += row.amount_cents;
  for (const row of expenses) year(row.date).expenses += row.amount_cents;
  return [...totals].sort(([a], [b]) => a.localeCompare(b));
}

export function HistoryImport() {
  const data = useData();
  const { backend } = useStore();
  const { busy, run, error } = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [preview, setPreview] = useState<Preview>();
  const [done, setDone] = useState<ImportHistoryResult>();

  async function picked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReading(true); setProblem(undefined); setPreview(undefined); setDone(undefined);
    try {
      const sheet = historySheet(await readTables(file));
      const plan = planHistoryImport(sheet, heldHistory(data));
      const known = new Set(data.clients.map((client) => client.name.toLowerCase().replace(/\s+/g, " ").trim()));
      const added = new Set(plan.income.map((row) => row.client.toLowerCase().replace(/\s+/g, " ").trim()).filter((name) => !known.has(name)));
      const rows = plan.income.length + plan.expenses.length;
      if (!sheet.income.length && !sheet.expenses.length) setProblem(sheet.noDate || sheet.noAmount || sheet.future
        ? "Sorted found the headings but couldn't use any of the rows. Each one needs a date in the past and an amount above zero."
        : "That file has headings but nothing under them.");
      else if (rows > IMPORT_MAX_HISTORY_ROWS) setProblem(`That file has ${rows} rows to add. Sorted adds up to ${IMPORT_MAX_HISTORY_ROWS} at a time, so split it into smaller files, such as one per year.`);
      else setPreview({ fileName: file.name, sheet, ...plan, newClients: added.size });
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Sorted couldn't read that file.");
    } finally { setReading(false); }
  }

  const leftOut = preview ? [
    preview.alreadyThere && `${preview.alreadyThere} already in Sorted`,
    preview.sheet.noDate && `${count(preview.sheet.noDate, "row")} with no date Sorted could read`,
    preview.sheet.noAmount && `${count(preview.sheet.noAmount, "row")} with no amount above zero`,
    preview.sheet.future && `${count(preview.sheet.future, "row")} dated in the future`,
  ].filter(Boolean) : [];
  const nameless = preview?.income.filter((row) => row.client === NO_CLIENT).length ?? 0;
  const total = preview ? preview.income.length + preview.expenses.length : 0;

  return <div className="page">
    <BackButton to="/money" />
    <PageHeader eyebrow="Money" title="Import past income and expenses" />
    {done ? <Card className="form-card import-card">
      <h2>{done.importId ? `${both(done.payments, done.expenses)} added` : "Nothing new to add"}</h2>
      {done.clients > 0 && <p className="sheet-copy">{count(done.clients, "new client")} added with {done.clients === 1 ? "it" : "them"}.</p>}
      {done.alreadyThere > 0 && <p className="sheet-copy">{count(done.alreadyThere, "row")} {done.alreadyThere === 1 ? "was" : "were"} already in Sorted and left as {done.alreadyThere === 1 ? "it was" : "they were"}.</p>}
      {done.importId && <p className="sheet-copy">Changed your mind? You can undo this import in Settings.</p>}
      <Link className="button button-primary" to="/money">See your money</Link>
      <Button kind="quiet" onClick={() => setDone(undefined)}>Import another file</Button>
    </Card> : preview ? <Card className="form-card import-card">
      <p className="eyebrow">{preview.fileName}</p>
      <h2>{total ? `${both(preview.income.length, preview.expenses.length)} to add` : "Nothing new to add"}</h2>
      {total > 0 && <dl className="import-columns">
        {years(preview.income, preview.expenses).map(([year, sums]) => <div key={year}><dt>{year}</dt><dd>{[sums.income && `${euros(sums.income)} income`, sums.expenses && `${euros(sums.expenses)} expenses`].filter(Boolean).join(" · ")}</dd></div>)}
      </dl>}
      {leftOut.length > 0 && <p className="sheet-copy">Left out: {leftOut.join(", ")}.</p>}
      {preview.newClients > 0 && <p className="sheet-copy">{count(preview.newClients, "client")} in this file {preview.newClients === 1 ? "isn’t" : "aren’t"} in Sorted yet and will be added, with no phone number or email.</p>}
      {nameless > 0 && <p className="sheet-copy">{count(nameless, "payment")} {nameless === 1 ? "has" : "have"} no client name and will go under “{NO_CLIENT}”.</p>}
      {preview.income.length > 0 && <>
        <p className="chart-title">Income: first {Math.min(3, preview.income.length)} of {preview.income.length}</p>
        <ul className="import-sample">{preview.income.slice(0, 3).map((row, index) => <li key={index}><strong>{euros(row.amount_cents)} · {day(row.paid_on)}</strong><span>{row.client} · {row.service}</span></li>)}</ul>
      </>}
      {preview.expenses.length > 0 && <>
        <p className="chart-title">Expenses: first {Math.min(3, preview.expenses.length)} of {preview.expenses.length}</p>
        <ul className="import-sample">{preview.expenses.slice(0, 3).map((row, index) => <li key={index}><strong>{euros(row.amount_cents)} · {day(row.date)}</strong><span>{row.merchant}</span></li>)}</ul>
      </>}
      <p className="sheet-copy">Each payment is added as a finished, paid job on the day it was paid. Nothing is saved until you confirm. No messages, reminders or receipts are sent to anyone.</p>
      {error && <p role="alert" className="sheet-copy">{error}</p>}
      {total > 0 && <Button disabled={busy} onClick={async () => {
        let result: ImportHistoryResult | undefined;
        if (await run(async () => { result = await backend.importHistory(preview.fileName, { income: preview.income, expenses: preview.expenses }); }) && result) { setDone(result); setPreview(undefined); }
      }}>{busy ? "Adding…" : `Add ${both(preview.income.length, preview.expenses.length)}`}</Button>}
      <Button kind="quiet" disabled={busy} onClick={() => setPreview(undefined)}>Choose a different file</Button>
    </Card> : <Card className="form-card import-card">
      <p className="sheet-copy">Upload a spreadsheet of money you’ve already been paid and already spent: an Excel file (.xlsx) or a CSV. Each row needs a date and an amount. Client, service, supplier and category are optional.</p>
      <p className="sheet-copy">A file from Export for accountant works as it is. Dates like 31/12/2025 are read as day, month, year.</p>
      {problem && <p role="alert" className="import-problem">{problem}</p>}
      <Button disabled={reading} onClick={() => input.current?.click()}><Icon name="download" size={18} /> {reading ? "Reading…" : "Choose a file"}</Button>
      <Button kind="quiet" onClick={async () => download(await historyTemplate(), "sorted-income-expenses-template.xlsx")}>Download a template to fill in</Button>
      <input ref={input} className="visually-hidden" type="file" name="history-file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={picked} tabIndex={-1} aria-hidden="true" />
    </Card>}
  </div>;
}
