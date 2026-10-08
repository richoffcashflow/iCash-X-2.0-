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
   <div className="property-analysis-metric"><dt>ARV · Value after repairs</dt><dd>{analysisMoney(view.arvCents)}</dd></div>
  </dl>
  {view.calculation&&view.cashOfferCeilingCents!==null&&<details className="estimate-details"><summary>Offer calculation</summary><p>({analysisMoney(view.arvCents)} − {repairValue}) × {view.calculation.rulePercent}% − {analysisMoney(view.calculation.feeCents)} = {analysisMoney(view.cashOfferCeilingCents)}</p><p>Wholesale fee: {analysisMoney(view.calculation.feeCents)}. Repairs are deducted before applying {view.calculation.rulePercent}%.</p></details>}
  <details className="estimate-details property-comps"><summary>Comparable sales</summary><p>No verified nearby sales are saved for this property yet. The ARV above is a property-value estimate.</p></details>
  <details className="estimate-details"><summary>About these estimates</summary>{view.offerNeedsUpdate&&<p>The earlier saved offer estimate was {analysisMoney(view.cashOfferCeilingCents)}. It needs a new calculation using the current offer formula. No new offer has been calculated or approved.</p>}<p>The bot confirms the property details and presents the current calculated cash offer. Any agreed purchase price is saved separately. Mortgage or lien questions may make the offer conditional. These estimates are not an inspection. Value after repairs (ARV) uses the saved property-value estimate and has not been verified.</p><p>{repairs.status==='invalid'?'Repair estimate needs review.':repairs.status==='missing'?'No repair estimate recorded.':`Provider repair estimate: ${analysisMoney(repairs.baselineCents)}.`}</p><p>{date?`Recorded ${date}. `:''}{repairs.condition?`Reported condition: ${repairs.condition}. `:''}No verified nearby sales are saved.</p></details>
 </section>;
}
