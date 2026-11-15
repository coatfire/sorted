import { Button, Field, Icon } from "./components";
import { completeServiceDrafts, serviceErrors, type ServiceDraft } from "./lib/setup";

export function ServiceEditor({ rows, onChange, limit = 30, submitted = false }: { rows: ServiceDraft[]; onChange: (rows: ServiceDraft[]) => void; limit?: number; submitted?: boolean }) {
  const { duplicateIds } = completeServiceDrafts(rows);
  return <div className="form-card">
    {rows.map((row, index) => {
      const active = submitted || Boolean(row.name || row.price) || duplicateIds.has(row.id);
      const errors = serviceErrors(row);
      const duplicate = duplicateIds.has(row.id);
      const update = (field: "name" | "price", value: string) => onChange(rows.map(item => item.id === row.id ? { ...item, [field]: value } : item));
      return <div className="service-editor-row" role="group" aria-label={`Service ${index + 1}`} key={row.id}>
        <Field label="Service name" error={active ? duplicate ? "Use a different name for each service." : errors.name : undefined}>
          <input name={`serviceName-${row.id}`} maxLength={200} value={row.name} placeholder="e.g. Gel nails" onChange={event => update("name", event.target.value)} />
        </Field>
        <Field label="Price" error={active ? errors.price : undefined}>
          <div className="money-input"><span>€</span><input name={`servicePrice-${row.id}`} inputMode="decimal" value={row.price} placeholder="35.00" onChange={event => update("price", event.target.value)} /></div>
        </Field>
        <Button type="button" kind="quiet" aria-label={`Remove ${row.name.trim() || `service ${index + 1}`}`} onClick={() => onChange(rows.filter(item => item.id !== row.id))}><Icon name="trash" size={18} /></Button>
      </div>;
    })}
    <Button type="button" kind="soft" disabled={rows.length >= limit} onClick={() => onChange([...rows, { id: crypto.randomUUID(), name: "", price: "" }])}><Icon name="plus" /> Add service</Button>
  </div>;
}
