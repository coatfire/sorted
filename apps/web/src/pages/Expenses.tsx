import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { RECEIPT_PDF_MAX_BYTES, type Expense, type ExpenseCategory, type Trip } from "@sorted/core";
import { Button, Card, EmptyState, Field, Icon, MoneyText, PageHeader, Sheet } from "../components";
import { CATEGORIES, categoryLabel, centsToInput, dayMonth, monthYear, parseEuros, toDateInput } from "../lib/format";
import { downscaleImage } from "../lib/image";
import { manageDialogFocus } from "../lib/dialogFocus";
import { useAction, useData, useStore } from "../lib/store";
import { useValidation } from "../lib/useValidation";
import { TripList, TripSheet } from "../Trips";

/** Browsers won't open a data: URL in a new tab, so PDFs always get a blob: URL. */
async function storedReceipt(pending: Promise<string | null>) {
  try {
    const url = await pending;
    if (!url) return null;
    const blob = await (await fetch(url)).blob();
    const pdf = blob.type === "application/pdf";
    if (!pdf) return { url, pdf };
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    return { url: URL.createObjectURL(blob), pdf };
  } catch { return null; }
}

const blank = () => ({
  merchant: "",
  amount: "",
  vat: "",
  date: toDateInput(new Date()),
  category: "materials" as ExpenseCategory,
});

export function Expenses() {
  const { expenses, user } = useData();
  const { backend, toast } = useStore();
  const { busy, run, error, committed } = useAction();
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  // null = closed · "new" = adding · Expense = editing
  const [open, setOpen] = useState<"new" | Expense | null>(null);
  const [photo, setPhoto] = useState<{ blob?: Blob; url: string; pdf?: boolean; name?: string } | null>(null);
  const [form, setForm] = useState(blank);
  const [trip, setTrip] = useState<"new" | Trip | null>(null);
  const validation = useValidation({
    amount: () => !parseEuros(form.amount) ? "Add the amount, like 24.60." : !user.vatRegistered && (parseEuros(form.vat) ?? 0) > parseEuros(form.amount)! ? "The amount cannot be less than the saved VAT paid. Update VAT in Settings to edit it." : undefined,
    vat: () => user.vatRegistered && form.vat.trim() && (parseEuros(form.vat) === null || parseEuros(form.vat)! > (parseEuros(form.amount) ?? 0)) ? "VAT paid cannot exceed the expense amount." : undefined,
  });
  const [filter, setFilter] = useState<ExpenseCategory | "all">("all");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [zoom, setZoom] = useState(false);
  const lightbox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (zoom && lightbox.current) {
      return manageDialogFocus(lightbox.current, () => setZoom(false));
    }
  }, [zoom]);

  const year = new Date().getFullYear();
  const dated = expenses
    .filter((expense) => expense.expenseDate && expense.amountCents)
    .sort((a, b) => b.expenseDate!.localeCompare(a.expenseDate!));
  const yearTotal = dated
    .filter((expense) => new Date(expense.expenseDate!).getFullYear() === year)
    .reduce((sum, expense) => sum + expense.amountCents!, 0);
  const used = CATEGORIES.filter((category) => dated.some((expense) => expense.category === category.value));
  const shown = filter === "all" ? dated : dated.filter((expense) => expense.category === filter);
  const editing = open && open !== "new" ? open : null;

  // Free the object URL when the photo changes or the page goes away.
  useEffect(() => {
    const url = photo?.url;
    return () => {
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, [photo]);

  function close() {
    setOpen(null);
    setPhoto(null);
    setForm(blank());
    validation.clear();
    if (fileInput.current) fileInput.current.value = "";
    if (uploadInput.current) uploadInput.current.value = "";
  }

  function show(target: "new" | Expense) {
    setOpen(target);
    validation.clear();
  }

  async function picked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const pdf = file.type === "application/pdf" || (!file.type && file.name.toLowerCase().endsWith(".pdf"));
    if (!pdf && !file.type.startsWith("image/")) {
      toast("Choose a photo or a PDF.", "error");
      return;
    }
    if (pdf && file.size > RECEIPT_PDF_MAX_BYTES) {
      toast("That PDF is over 3 MB. Try a smaller file or a photo.", "error");
      return;
    }
    try {
      const blob = pdf ? new Blob([await file.arrayBuffer()], { type: "application/pdf" }) : await downscaleImage(file);
      setPhoto({ blob, url: URL.createObjectURL(blob), pdf, name: file.name });
      if (!open) {
        setForm(blank());
        show("new");
      }
    } catch {
      toast(pdf ? "Couldn't read that file. Try again." : "Couldn't read that photo. Try again.", "error");
    }
  }

  async function edit(expense: Expense) {
    setForm({
      merchant: expense.merchant ?? "",
      amount: centsToInput(expense.amountCents ?? 0),
      vat: expense.vatCents == null ? "" : centsToInput(expense.vatCents),
      date: toDateInput(new Date(expense.expenseDate!)),
      category: expense.category ?? "other",
    });
    setPhoto(null);
    show(expense);
    if (expense.receiptKey) {
      const stored = await storedReceipt(backend.receiptUrl(expense));
      if (stored) setPhoto(stored);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || committed) return;
    if (!validation.validate(event.currentTarget)) return;
    const amountCents = parseEuros(form.amount);
    if (!amountCents) return;
    const draft = {
      merchant: form.merchant.trim(),
      amountCents,
      vatCents: form.vat.trim() ? parseEuros(form.vat) : null,
      category: form.category,
      expenseDate: new Date(`${form.date}T12:00:00`).toISOString(),
      receipt: photo?.blob,
    };
    const ok = editing
      ? await run(() => backend.updateExpense(editing.id, draft), "Expense updated")
      : await run(() => backend.createExpense(draft), "Expense saved");
    if (ok) close();
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Expenses"
        title="Keep your expenses in one place."
        action={<span className="year-total"><small>{year} so far</small><MoneyText cents={yearTotal} /></span>}
      />

        <div className="capture-stack">
          <button className="receipt-capture" onClick={() => fileInput.current?.click()}>
            <span className="camera-orb"><Icon name="camera" size={28} /></span>
            <span><strong>Snap a receipt</strong><small>Take a photo with your camera</small></span>
            <Icon name="arrow" />
          </button>
          <button className="receipt-upload" onClick={() => uploadInput.current?.click()}>
            <Icon name="receipt" size={20} />
            <span><strong>Upload a file</strong><small>A photo from your gallery or a PDF</small></span>
          </button>
          <button className="reveal-button" onClick={() => { setForm(blank()); show("new"); }}>
            <Icon name="plus" size={17} /> Add one without a receipt
          </button>
          <button className="reveal-button" onClick={() => setTrip("new")}>
            <Icon name="map" size={17} /> Add a trip (km)
          </button>
        </div>
      {open && <Sheet title={editing ? "Edit expense" : "New expense"} onClose={close}>
        {error && <p className="sheet-copy" role="alert">{error}</p>}
        {committed && error && <Button kind="soft" onClick={() => window.location.reload()}>Reload</Button>}
        <Card className="receipt-form-card">
          {photo?.pdf ? (
            <a className="receipt-file" href={photo.url} target="_blank" rel="noreferrer">
              <Icon name="receipt" />
              <span><strong>{photo.name ?? "Receipt PDF"}</strong><small>Tap to open</small></span>
            </a>
          ) : photo ? (
            <button type="button" className="receipt-preview" onClick={() => setZoom(true)} aria-label="View receipt full size">
              <img src={photo.url} alt="Receipt" />
              <span>Tap to zoom</span>
            </button>
          ) : (
            !editing && (
              <div className="receipt-add-row">
                <button type="button" className="receipt-add" onClick={() => fileInput.current?.click()}>
                  <Icon name="camera" /> Take a photo
                </button>
                <button type="button" className="receipt-add" onClick={() => uploadInput.current?.click()}>
                  <Icon name="receipt" /> Upload a file
                </button>
              </div>
            )
          )}
          <form onSubmit={submit} noValidate>
            <p className="eyebrow">{editing ? "Edit expense" : "New expense"}</p>
            <Field label="Merchant" {...validation.field("merchant")}>
              <input
                autoFocus={!editing}
                required
                name="merchant"
                value={form.merchant}
                onChange={(event) => setForm({ ...form, merchant: event.target.value })}
                placeholder="Where did you buy it?"
              />
            </Field>
            <div className="field-grid">
              <Field label="Amount" {...validation.field("amount")}>
                <div className="money-input">
                  <span>€</span>
                  <input
                    required
                    inputMode="decimal"
                    value={form.amount}
                    name="amount"
                    onChange={(event) => setForm({ ...form, amount: event.target.value })}
                    placeholder="0.00"
                  />
                </div>
              </Field>
              <Field label="Date" {...validation.field("date")}>
                <input
                  required
                  name="date"
                  type="date"
                  max={toDateInput(new Date())}
                  value={form.date}
                  onChange={(event) => setForm({ ...form, date: event.target.value })}
                />
              </Field>
            </div>
            {user.vatRegistered && <Field label="VAT paid (reclaimable)" helper="Optional. Enter only the VAT you can reclaim." {...validation.field("vat")}>
              <div className="money-input"><span>€</span><input name="vat" inputMode="decimal" value={form.vat} onChange={(event) => setForm({ ...form, vat: event.target.value })} placeholder="0.00" /></div>
            </Field>}
            <span className="field-label category-label" id="category-label">Category</span>
            <div className="category-row" role="radiogroup" aria-labelledby="category-label">
              {CATEGORIES.map((category) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={form.category === category.value}
                  key={category.value}
                  className={form.category === category.value ? "active" : ""}
                  onClick={() => setForm({ ...form, category: category.value })}
                >
                  {category.label}
                </button>
              ))}
            </div>
            <Button type="submit" disabled={busy || committed}>
              <Icon name="check" /> {busy ? "Saving…" : editing ? "Save changes" : "Confirm expense"}
            </Button>
            <div className="form-footer">
              <button type="button" className="text-link" onClick={close}>
                {editing ? "Close" : "Discard"}
              </button>
              {editing && (
                <button type="button" className="text-link danger" onClick={() => setConfirmDelete(true)}>
                  <Icon name="trash" size={16} /> Delete
                </button>
              )}
            </div>
          </form>
        </Card>
      </Sheet>}
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={picked}
        tabIndex={-1}
        aria-hidden="true"
      />
      <input
        ref={uploadInput}
        className="visually-hidden"
        type="file"
        accept="image/*,application/pdf"
        onChange={picked}
        tabIndex={-1}
        aria-hidden="true"
      />

      <section className="list-section">
        <div className="section-heading">
          <div><p className="eyebrow">Logged</p><h2>Your expenses</h2></div>
        </div>
        {used.length > 1 && (
          <div className="category-row filter-row" role="group" aria-label="Filter by category">
            <button className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              All
            </button>
            {used.map((category) => (
              <button
                key={category.value}
                className={filter === category.value ? "active" : ""}
                aria-pressed={filter === category.value}
                onClick={() => setFilter(category.value)}
              >
                {category.label}
              </button>
            ))}
          </div>
        )}
        <Card className="expense-list">
          {shown.length ? (
            shown.map((expense, index) => {
              const month = monthYear(expense.expenseDate!);
              const previous = shown[index - 1];
              return (
                <div key={expense.id}>
                  {(!previous || monthYear(previous.expenseDate!) !== month) && (
                    <p className="date-divider">{month}</p>
                  )}
                  <button className="expense-row" onClick={() => edit(expense)}>
                    <span className="expense-icon"><Icon name={expense.receiptKey ? "camera" : "receipt"} /></span>
                    <div>
                      <strong>{expense.merchant}</strong>
                      <span>
                        {categoryLabel(expense.category)} · {dayMonth(expense.expenseDate!)}
                        {expense.receiptKey ? " · receipt" : ""}
                      </span>
                    </div>
                    <MoneyText cents={expense.amountCents!} />
                  </button>
                </div>
              );
            })
          ) : (
            <EmptyState icon="receipt" title="No expenses yet" small>
              Snap a receipt when you buy something for the business — it all adds up at tax time.
            </EmptyState>
          )}
        </Card>
      </section>

      <TripList onOpen={setTrip} />
      {trip && <TripSheet key={trip === "new" ? "new" : trip.id} trip={trip} onClose={() => setTrip(null)} />}

      {confirmDelete && editing && (
        <Sheet title="Delete this expense?" onClose={() => setConfirmDelete(false)}>
          <p className="sheet-copy">
            {editing.merchant} · <MoneyText cents={editing.amountCents ?? 0} />. It comes out of your
            year totals and export{editing.receiptKey ? ", and its receipt is deleted" : ""}.
          </p>
          <Button
            kind="danger"
            disabled={busy}
            onClick={async () => {
              if (await run(() => backend.deleteExpense(editing.id), "Expense deleted")) {
                setConfirmDelete(false);
                close();
              }
            }}
          >
            Delete expense
          </Button>
          <Button kind="quiet" onClick={() => setConfirmDelete(false)}>Keep it</Button>
        </Sheet>
      )}
      {zoom && photo && !photo.pdf && (
        <div ref={lightbox} tabIndex={-1} className="lightbox" onClick={() => setZoom(false)} role="dialog" aria-modal="true" aria-label="Receipt photo">
          <img src={photo.url} alt="Receipt, full size" />
        </div>
      )}
    </div>
  );
}
