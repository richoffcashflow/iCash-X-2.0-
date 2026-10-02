import {analysisMoney, propertyAnalysisView} from '@/lib/property-analysis-view';

export function PropertyAnalysisSummary({result}: {result: unknown}) {
 const view = propertyAnalysisView(result), repairs = view.repairs;
 const repairValue = analysisMoney(repairs.baselineCents);
 const date = view.fetchedAt ? new Date(view.fetchedAt).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'}) : null;
 return <section className="property-analysis" aria-label="Property financial analysis">
  <div className="property-analysis-heading"><h4>Deal numbers</h4><small>Estimates only</small></div>
  <dl className="property-analysis-grid">
   <div className="property-analysis-metric property-analysis-offer"><dt>Cash offer estimate</dt><dd>{analysisMoney(view.cashOfferCeilingCents)}</dd></div>
   <div className="property-analysis-metric"><dt>Estimated repairs</dt><dd>{repairValue}</dd></div>
   <div className="property-analysis-metric"><dt>Value after repairs</dt><dd>{analysisMoney(view.arvCents)}</dd></div>
  </dl>
  <details className="estimate-details"><summary>About these estimates</summary><p>These are saved research numbers, not an approved offer or an inspection. Value after repairs (ARV) uses the saved property-value estimate and has not been verified.</p><p>{repairs.status==='invalid'?'Repair estimate needs review.':repairs.status==='missing'?'No repair estimate recorded.':`Provider repair estimate: ${analysisMoney(repairs.baselineCents)}.`}</p><p>{date?`Recorded ${date}. `:''}{repairs.condition?`Reported condition: ${repairs.condition}. `:''}No verified nearby sales are saved.</p></details>
 </section>;
}
