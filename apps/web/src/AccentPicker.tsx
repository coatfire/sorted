import { DEFAULT_INVOICE_ACCENT } from "@sorted/core";

export const ACCENT_COLOURS = [
  { name: "Forest green", value: DEFAULT_INVOICE_ACCENT }, { name: "Deep teal", value: "#115E59" }, { name: "Navy blue", value: "#1E3A5F" }, { name: "Plum", value: "#6B315D" }, { name: "Terracotta", value: "#93472F" }, { name: "Charcoal", value: "#374151" },
];
export function AccentPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="accent-picker"><p className="field-label">Accent colour</p><p className="field-helper">For your invoices, receipts and quotes.</p><div className="accent-swatches" role="group" aria-label="Accent colour">
    {ACCENT_COLOURS.map(colour => <button type="button" key={colour.value} aria-label={colour.name} aria-pressed={value.toUpperCase() === colour.value} className="accent-swatch" onClick={() => onChange(colour.value)}><span style={{ backgroundColor: colour.value }} /></button>)}
    <label className="custom-colour">Custom<input type="color" name="invoiceAccent" aria-label="Custom accent colour" value={value} onChange={event => onChange(event.target.value)} /></label>
  </div></div>;
}
