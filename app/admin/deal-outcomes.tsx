import type {OwnerDealOutcomes} from '@/lib/owner-deal-outcomes';
import {overviewMoney} from '@/lib/owner-overview';
import styles from './overview.module.css';
import tableStyles from './deal-outcomes.module.css';

export function DealOutcomesView({data}:{data:OwnerDealOutcomes|null|undefined}){
 return <section className={styles.completion} aria-label="Customer and owner deal outcomes"><h2>Customer and owner deal outcomes</h2>
  <p>Live purchase-signing workflows started in the selected period, followed through today. Customer results always exclude your account.</p>
  {data?<>
   {data.truncated&&<p role="status">Showing the oldest {data.maxDeals.toLocaleString('en-US')} signing workflows in this period. These are partial totals; choose a shorter period.</p>}
   <div className={styles.costEvidenceScroll}><table className={tableStyles.table}><caption className={styles.srOnly}>Verified outcomes for the same signing cohort, with owner activity separate</caption>
    <thead><tr><th scope="col">Outcome</th><th scope="col">Customers</th><th scope="col">Your account</th></tr></thead>
    <tbody>{([
     ['signingStarted','Signing workflows started'],['awaitingSeller','Waiting for seller signature'],['awaitingCustomer','Waiting for customer signature'],
     ['needsReview','Signing needs review'],['verifiedPurchases','Verified purchase contracts'],['verifiedAssignments','Verified buyer assignments'],
     ['verifiedClosings','Title-confirmed closings'],['receivedDeals','Proceeds receipt confirmed'],['receivedCents','Proceeds received'],
    ] as const).map(([key,label])=><tr key={key}><th scope="row">{label}</th>{data.cohorts.map(c=><td key={c.key}>{key==='receivedCents'?overviewMoney(c[key],'cents'):c[key].toLocaleString('en-US')}</td>)}</tr>)}</tbody>
   </table></div>
   <p>Starting signing does not establish a contract. Completed contracts require matching provider signature evidence; closings require verified title evidence. Proceeds require the account holder’s receipt confirmation. Test envelopes and practice deals are excluded. Your account can include live demonstrations.</p>
  </>:<p role="status">Deal outcome evidence is unavailable. No customer results are inferred.</p>}
 </section>;
}
