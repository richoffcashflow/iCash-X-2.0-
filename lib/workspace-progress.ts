import type {WorkSummary} from './work-summary';

const count=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const money=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export function creditAmount(cents:unknown){return money(cents)?`$${(cents/100).toFixed(2)}`:'Unavailable';}

/** Only completed, account-scoped summary records. Never infer interest or income. */
export function recordedProgress(s:Partial<WorkSummary>){
 const items:string[]=[];
 if(count(s.analyzed)&&s.analyzed>0)items.push(`${s.analyzed} property ${s.analyzed===1?'analysis':'analyses'} completed`);
 if(count(s.ownerRecords)&&s.ownerRecords>0)items.push(`${s.ownerRecords} owner lookup ${s.ownerRecords===1?'result':'results'} recorded`);
 if(count(s.closed)&&s.closed>0)items.push(`${s.closed} funded ${s.closed===1?'closing':'closings'} recorded`);
 else if(count(s.contracts)&&s.contracts>0)items.push(`${s.contracts} seller ${s.contracts===1?'signature':'signatures'} recorded`);
 else if(count(s.screeningCandidates)&&s.screeningCandidates>0)items.push(`${s.screeningCandidates} ${s.screeningCandidates===1?'analysis passed':'analyses passed'} the first numbers check`);
 const empty=[s.analyzed,s.ownerRecords,s.contracts,s.closed].every(value=>value===0)&&!(s.screeningCandidates&&s.screeningCandidates>0);
 return {items,empty:items.length===0?(empty?'No completed work is recorded yet.':'Completed-work totals are not available yet.'):null,
  note:count(s.closed)&&s.closed>0?'Recorded results across your account.':count(s.contracts)&&s.contracts>0?'A seller signature is a step forward. It does not confirm a fully signed contract or closing.':items.length?'Research and lookup results do not mean a seller is interested or has agreed to a deal.':'Your saved work will appear here as results are recorded.'};
}
export type ProgressAccount={balanceCents?:number;reservedCents?:number;paused?:boolean;activeWork?:boolean;billingReview?:boolean;identity?:unknown;workReady?:boolean;contactWorkReady?:boolean;discoveryWorkReady?:boolean;smsWorkReady?:boolean;contactQuote?:{chargeCents:number;maxContacts:number}|null;discoveryQuote?:{chargeCents:number;maxProperties:number}|null};
/** The account API already returns NET available credits; never subtract reserves twice. */
export function nextWorkFunding(a:ProgressAccount,stale=false){
 if(stale)return {detail:'Refresh your account to check available credits and the next work estimate.',needsFunding:false};
 if(a.billingReview||!a.identity)return {detail:null,needsFunding:false};
 if(a.activeWork&&!a.paused)return {detail:'Work is recorded in progress. Open your saved work below for results; final charges may still change.',needsFunding:false};
 const quote=!a.workReady&&a.contactWorkReady?a.contactQuote:!a.workReady&&a.discoveryWorkReady?a.discoveryQuote:null;
 const action=!a.workReady&&a.contactWorkReady?'owner contact lookup':!a.workReady&&a.discoveryWorkReady?'property search':null;
 const limit=action==='owner contact lookup'?a.contactQuote?.maxContacts:a.discoveryQuote?.maxProperties;
 if(action&&quote&&money(quote.chargeCents)&&quote.chargeCents>0&&count(limit)&&limit>0){
  const gap=money(a.balanceCents)?Math.max(0,quote.chargeCents-a.balanceCents):null;
  return {detail:`The next eligible ${action} needs a ${creditAmount(quote.chargeCents)} planning hold.${gap===null?' Available credits could not be confirmed.':gap>0?` You need ${creditAmount(gap)} more available to cover it.`:' Your available credits cover this hold.'} Final cost and other spending limits still apply.`,needsFunding:gap!==null&&gap>0};
 }
 if(!a.workReady&&!a.contactWorkReady&&!a.discoveryWorkReady&&!a.smsWorkReady)return {detail:'The next paid task and its cost are not confirmed yet. Check setup status before adding credits; funding does not clear setup or permission checks.',needsFunding:false};
 return {detail:'A reliable estimate for the next paid task is not available yet. Work must pass your credit and spending-limit checks first.',needsFunding:money(a.balanceCents)&&a.balanceCents<=0};
}
