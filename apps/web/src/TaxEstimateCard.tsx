import { Link } from "react-router-dom";
import { taxEstimate } from "@sorted/core";
import { Card, MoneyText } from "./components";
import { useData } from "./lib/store";

export function TaxEstimateCard() {
  const { payments, expenses, user } = useData();
  const estimate = taxEstimate({ payments, expenses, settings: user, now: new Date() });
  return <section className="list-section">
    <div className="section-heading"><h2>VAT &amp; tax estimate</h2></div>
    <Card className="year-card tax-estimate">
      <p className="tax-estimate-caveat">Estimate based on the details you entered — not tax advice.</p>
      {estimate.vatRegistered && <>
        <p className="eyebrow">VAT · {estimate.periodLabel}</p>
        <div className="tax-estimate-row"><span>VAT on sales ({estimate.vatRateBp! / 100}%)</span><MoneyText cents={estimate.salesVatCents} /></div>
        <div className="tax-estimate-row"><span>VAT paid (reclaimable)</span><MoneyText cents={estimate.purchaseVatCents} /></div>
        <div className="tax-estimate-row"><strong>{estimate.vatDueCents < 0 ? "Estimated VAT refund" : "Estimated VAT due"}</strong><MoneyText cents={Math.abs(estimate.vatDueCents)} /></div>
      </>}
      <p className="eyebrow">Income tax · {estimate.year} year to date</p>
      <div className="tax-estimate-row"><span>Paid income{estimate.vatRegistered ? " after VAT" : ""}</span><MoneyText cents={estimate.netIncomeCents} /></div>
      <div className="tax-estimate-row"><span>Expenses{estimate.vatRegistered ? " after reclaimable VAT" : ""}</span><MoneyText cents={estimate.netExpenseCents} /></div>
      <div className="tax-estimate-row"><span>Estimated profit</span><MoneyText cents={estimate.profitCents} /></div>
      {estimate.incomeTaxCents === null
        ? <Link className="button button-quiet" to="/settings">Set your income tax rate in Settings</Link>
        : <div className="tax-estimate-row"><strong>Estimated income tax ({estimate.incomeTaxRateBp! / 100}%)</strong><MoneyText cents={estimate.incomeTaxCents} /></div>}
      {estimate.vatRegistered && <details className="tax-workings">
        <summary>How it's worked out</summary>
        <div className="tax-estimate-row"><span>VAT-period paid sales, including VAT</span><MoneyText cents={estimate.periodIncomeCents} /></div>
        <div className="tax-estimate-row"><span>Year-to-date paid income, including VAT</span><MoneyText cents={estimate.yearIncomeCents} /></div>
        <div className="tax-estimate-row"><span>Less VAT on income</span><MoneyText cents={estimate.yearSalesVatCents} /></div>
        <div className="tax-estimate-row"><span>Year-to-date expenses, including VAT</span><MoneyText cents={estimate.yearExpenseCents} /></div>
        <div className="tax-estimate-row"><span>Less reclaimable VAT</span><MoneyText cents={estimate.yearPurchaseVatCents} /></div>
      </details>}
    </Card>
  </section>;
}
