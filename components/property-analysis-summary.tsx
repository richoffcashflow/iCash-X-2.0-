import {analysisMoney, propertyAnalysisView} from '@/lib/property-analysis-view';

export function PropertyAnalysisSummary({result}: {result: unknown}) {
 const view = propertyAnalysisView(result), repairs = view.repairs;
 const repairValue = repairs.rangeCents ? `${analysisMoney(repairs.rangeCents.low)}–${analysisMoney(repairs.rangeCents.high)}` : analysisMoney(repairs.baselineCents);
 const date = view.fetchedAt ? new Date(view.fetchedAt).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'}) : null;
 return <section className="property-analysis" aria-label="Property financial analysis">
  <div className="property-analysis-heading"><h4>Property numbers</h4><small>Saved estimates</small></div>
  <dl className="property-analysis-grid">
   <div className="property-analysis-metric property-analysis-offer"><dt>Estimated cash offer</dt><dd>{analysisMoney(view.cashOfferCeilingCents)}</dd><small>Highest offer from the initial numbers. This estimate is not a sent, agreed or approved offer.</small></div>
   <div className="property-analysis-metric"><dt>Estimated repairs</dt><dd>{repairValue}</dd><small>{repairs.status === 'invalid' ? 'Repair range is inconsistent and needs review.' : repairs.status === 'range' ? 'Provider estimate range; not an inspection.' : repairs.status === 'baseline' ? 'Provider baseline estimate; no repair range recorded.' : 'No repair estimate recorded.'}{repairs.rangeCents && repairs.baselineCents !== null ? ` Baseline: ${analysisMoney(repairs.baselineCents)}.` : ''}</small></div>
   <div className="property-analysis-metric"><dt>Value after repairs (ARV)</dt><dd>{analysisMoney(view.arvCents)}</dd><small>{view.arvCents === null ? 'No estimated value recorded.' : 'Based on the saved property-value estimate. We have not verified what this home would sell for after repairs.'}</small></div>
  </dl>
  <p className="property-analysis-source">Source: {view.source}{date && <> · Data recorded <time dateTime={view.fetchedAt!}>{date}</time></>}{repairs.condition && <> · Reported condition: {repairs.condition}</>}</p>
  <div className="property-analysis-comps"><strong>Nearby sold homes (comps)</strong><span>Not recorded</span><p>No verified nearby sales are saved with these numbers.</p></div>
 </section>;
}
