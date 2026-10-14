import {analysisMoney, propertyAnalysisView} from '@/lib/property-analysis-view';

export function PropertyAnalysisSummary({result}: {result: unknown}) {
 const view = propertyAnalysisView(result), repairs = view.repairs;
 const repairValue = analysisMoney(repairs.baselineCents);
 const date = view.fetchedAt ? new Date(view.fetchedAt).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'}) : null;
 return <section className="property-analysis" aria-label="Property financial analysis">
  <div className="property-analysis-heading"><h4>Deal numbers</h4><small>Estimates only</small></div>
  <dl className="property-analysis-grid">
   <div className="property-analysis-metric property-analysis-offer" data-earlier-estimate={view.offerNeedsUpdate||undefined}><dt>{view.offerNeedsUpdate?'Maximum cash offer · Needs update':'Maximum cash offer'}</dt><dd>{analysisMoney(view.cashOfferCeilingCents)}{view.offerNeedsUpdate&&<small>Unapproved · {date?`Recorded ${date}`:'Recorded date unavailable'}</small>}</dd></div>
   <div className="property-analysis-metric"><dt>Estimated repairs</dt><dd>{repairValue}</dd></div>
   <div className="property-analysis-metric"><dt>Value after repairs</dt><dd>{analysisMoney(view.arvCents)}</dd></div>
  </dl>
  {view.calculation&&view.cashOfferCeilingCents!==null&&<details className="estimate-details"><summary>Offer calculation</summary><p>({analysisMoney(view.arvCents)} − {repairValue}) × {view.calculation.rulePercent}% − {analysisMoney(view.calculation.feeCents)} = {analysisMoney(view.cashOfferCeilingCents)}</p><p>Target assignment fee: {analysisMoney(view.calculation.feeCents)}. This is the fee you aim to receive for transferring the contract to a buyer. It is not confirmed earnings. Repairs are deducted before applying {view.calculation.rulePercent}%.</p></details>}
 </section>;
}
