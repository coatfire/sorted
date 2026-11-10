import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { Expense, ExpenseCategory } from "@sorted/core";
import { Button, Card, EmptyState, Field, Icon, MoneyText, PageHeader, Sheet } from "../components";
import { CATEGORIES, categoryLabel, centsToInput, dayMonth, monthYear, parseEuros, toDateInput } from "../lib/format";
import { downscaleImage } from "../lib/image";
import { useAction, useData, useStore } from "../lib/store";

const blank = () => ({
  merchant: "",
  amount: "",
  date: toDateInput(new Date()),
  category: "materials" as ExpenseCategory,
});

export function Expenses() {
  const { expenses } = useData();
  const { backend, toast } = useStore();
  const { busy, run } = useAction();
  const fileInput = useRef<HTMLInputElement>(null);
  const formTop = useRef<HTMLDivElement>(null);
  // null = closed · "new" = adding · Expense = editing
  const [open, setOpen] = useState<"new" | Expense | null>(null);
  const [photo, setPhoto] = useState<{ blob?: Blob; url: string } | null>(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ExpenseCategory | "all">("all");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [zoom, setZoom] = useState(false);

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
    setError("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function show(target: "new" | Expense) {
    setOpen(target);
    setError("");
    requestAnimationFrame(() => formTop.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }

  async function picked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const blob = await downscaleImage(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
      if (!open) {
        setForm(blank());
        show("new");
      }
    } catch {
      toast("Couldn't read that photo. Try taking it again.", "error");
    }
  }

  async function edit(expense: Expense) {
    setForm({
      merchant: expense.merchant ?? "",
      amount: centsToInput(expense.amountCents ?? 0),
      date: toDateInput(new Date(expense.expenseDate!)),
      category: expense.category ?? "other",
    });
    setPhoto(null);
    show(expense);
    if (expense.receiptKey) {
      const url = await backend.receiptUrl(expense).catch(() => null);
      if (url) setPhoto({ url });
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const amountCents = parseEuros(form.amount);
    if (!amountCents) return setError("Add the amount, like 24.60.");
    const draft = {
      merchant: form.merchant.trim(),
      amountCents,
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
        title="Keep every write-off."
        action={<span className="year-total"><small>{year} so far</small><MoneyText cents={yearTotal} /></span>}
      />

      <div ref={formTop} className="scroll-anchor" />
      {!open ? (
        <div className="capture-stack">
          <button className="receipt-capture" onClick={() => fileInput.current?.click()}>
            <span className="camera-orb"><Icon name="camera" size={28} /></span>
            <span><strong>Snap a receipt</strong><small>The photo is kept with the expense</small></span>
            <Icon name="arrow" />
          </button>
          <button className="reveal-button" onClick={() => { setForm(blank()); show("new"); }}>
            <Icon name="plus" size={17} /> Add one without a photo
          </button>
        </div>
      ) : (
        <Card className="receipt-form-card">
          {photo ? (
            <button type="button" className="receipt-preview" onClick={() => setZoom(true)} aria-label="View receipt full size">
              <img src={photo.url} alt="Receipt" />
              <span>Tap to zoom</span>
            </button>
          ) : (
            !editing && (
              <button type="button" className="receipt-add" onClick={() => fileInput.current?.click()}>
                <Icon name="camera" /> Add a receipt photo
              </button>
            )
          )}
          <form onSubmit={submit}>
            <p className="eyebrow">{editing ? "Edit expense" : "New expense"}</p>
            <Field label="Merchant">
              <input
                autoFocus={!editing}
                required
                value={form.merchant}
                onChange={(event) => setForm({ ...form, merchant: event.target.value })}
                placeholder="Where did you buy it?"
              />
            </Field>
            <div className="field-grid">
              <Field label="Amount">
                <div className="money-input">
                  <span>€</span>
                  <input
                    required
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(event) => { setError(""); setForm({ ...form, amount: event.target.value }); }}
                    placeholder="0.00"
                  />
                </div>
              </Field>
              <Field label="Date">
                <input
                  required
                  type="date"
                  max={toDateInput(new Date())}
                  value={form.date}
                  onChange={(event) => setForm({ ...form, date: event.target.value })}
                />
              </Field>
            </div>
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
            {error && <p className="form-error" role="alert">{error}</p>}
            <Button type="submit" disabled={busy}>
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
      )}
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

      {confirmDelete && editing && (
        <Sheet title="Delete this expense?" onClose={() => setConfirmDelete(false)}>
          <p className="sheet-copy">
            {editing.merchant} · <MoneyText cents={editing.amountCents ?? 0} />. It comes out of your
            year totals and export{editing.receiptKey ? ", and the receipt photo is deleted" : ""}.
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
      {zoom && photo && (
        <div className="lightbox" onClick={() => setZoom(false)} role="dialog" aria-label="Receipt photo">
          <img src={photo.url} alt="Receipt, full size" />
        </div>
      )}
    </div>
  );
}
