import { Link } from "react-router-dom";
import { BackButton, Card, Icon, PageHeader } from "../components";

/** Where a new trader is offered import straight after the welcome step, and where the reminder on Today leads. */
export function ImportOffer({ welcome = false }: { welcome?: boolean }) {
  return <div className="page">
    {!welcome && <BackButton to="/" />}
    <PageHeader eyebrow={welcome ? "One more thing" : "Import"} title="Bring in what you already have." />
    <p className="page-intro">If your clients or last year’s income and expenses are in a spreadsheet, Sorted can read it. You see everything before it’s saved, and no messages are sent to anyone.</p>
    <Card className="form-card import-card">
      <Link className="button button-primary" to="/clients/import"><Icon name="user" size={18} /> Import my client list</Link>
      <Link className="button button-soft" to="/money/import"><Icon name="wallet" size={18} /> Import past income and expenses</Link>
      {welcome && <Link className="button button-quiet" to="/" replace>Skip for now</Link>}
    </Card>
    <p className="settings-footnote">You can do this any time in Settings, under Import.</p>
  </div>;
}
