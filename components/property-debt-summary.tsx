import {propertyDebtView} from '@/lib/property-debt-view';
import {analysisMoney} from '@/lib/property-analysis-view';

export function PropertyDebtSummary({result,closing=false}:{result:unknown;closing?:boolean}){
 const view=propertyDebtView(result);
 const date=view.fetchedAt?new Date(view.fetchedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}):null;
 return <section className="property-debt-summary" aria-label="Mortgage and title information">
  <h4>{closing?'Mortgage & title':'Mortgage, equity & liens'}</h4>
  <dl>
   <div><dt>Estimated mortgage balance</dt><dd>{analysisMoney(view.mortgageCents)}</dd></div>
   {!closing&&<div><dt>Owner’s estimated equity</dt><dd>{analysisMoney(view.equityCents)}</dd></div>}
   <div><dt>Liens in property records</dt><dd>{view.lienStatus}</dd></div>
  </dl>
  {view.taxesReported&&<p>Unpaid property taxes are reported in the records.</p>}
  {view.conflicting?<p>Property records disagree. Confirm the amounts with the closing office.</p>:view.payoffMayExceedOffer&&<p>Mortgage debt reached the saved offer limit. Confirm the current payoff with the closing office.</p>}
  <small>{date?`Research from ${date}. `:''}The closing office confirms actual payoffs and liens.</small>
 </section>;
}
