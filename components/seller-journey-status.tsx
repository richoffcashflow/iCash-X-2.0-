import type {JourneyCheck} from '@/lib/seller-journey-readiness';
export type SellerJourneyStatusData={checks:JourneyCheck[];pending:number;needsAttention:number;started:number};
export function SellerJourneyStatus({data}:{data:SellerJourneyStatusData}){
 return <section aria-labelledby="seller-journey-title"><h2 id="seller-journey-title">Seller response & closing</h2>
  <p>{data.pending} queued · {data.needsAttention} need attention · {data.started} contacted by text and call</p>
  <p>Configured means settings are present. It does not prove a completed call, signature, or closing.</p>
  {data.checks.map(check=><details key={check.key}><summary>{check.label} · {check.status==='blocked'?'Needs setup':check.status==='configured'?'Configured':'Not verified live'}</summary><p>{check.detail}</p></details>)}
 </section>;
}
