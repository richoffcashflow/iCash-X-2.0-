'use client';
import './instant-lead-card.css';
import {useState} from 'react';
import {Check,MapPin,MessageCircle,Phone,UserRound} from 'lucide-react';
import {DealMessages} from './deal-messages';
import {PropertyCallHistory} from './property-call-history';
import {displayContactPhone} from './manual-call-options';
import {safeLocalTime} from './workspace-view';
export type InstantLeadCardData={leadId:string;screeningId:string;dealId:string;name:string|null;phone:string;address:string|null;state:string;paused:boolean;declinedAt:string|null;submittedAt:string;firstOutreachAt:string|null;responseAt:string|null;addressConfirmedAt:string|null;formId:string;campaignId:string|null;holdReason:string|null};
export const instantLeadGroup=(lead:InstantLeadCardData)=>lead.declinedAt?'history':lead.holdReason||['review','numbers_review','unmatched','duplicate','market_review'].includes(lead.state)?'attention':lead.addressConfirmedAt?'active':'waiting';
export function InstantLeadCard({lead,onRefresh,botPaused=false,hidden=false}:{lead:InstantLeadCardData;onRefresh:()=>void;botPaused?:boolean;hidden?:boolean}){
 const [view,setView]=useState<'texts'|'calls'|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const stopped=!!lead.declinedAt,paused=lead.paused||botPaused;
 const needsReview=!!lead.holdReason||['review','numbers_review','duplicate','market_review'].includes(lead.state);
 const status=stopped?'Contact stopped':paused?'Follow-up paused':needsReview?'Needs review':lead.state==='unmatched'?'Check address':lead.addressConfirmedAt?'Matching property':lead.responseAt?'Seller replied':'Address needed';
 const initials=(lead.name??'').trim().split(/\s+/).slice(0,2).map(part=>Array.from(part)[0]).join('').toUpperCase();
 const nextTitle=stopped?'Follow-up stopped':paused?'Follow-up is paused':needsReview?'This lead needs a review':lead.state==='unmatched'?'Confirm the property address':lead.addressConfirmedAt?'Finding the property details':'Which property are they selling?';
 const nextDetail=stopped?'The seller asked to stop contact.':paused?'Resume when you are ready to continue.':needsReview?'Review the saved activity before continuing.':lead.state==='unmatched'?'The address needs a correction before we can match the property.':lead.addressConfirmedAt?'The address is saved. Property details appear after a successful match.':'The first text and call ask for the street address, city and state.';
 async function pause(){setBusy(true);setError('');try{const r=await fetch('/api/work/instant-leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leadId:lead.leadId,paused:!lead.paused})});const d=await r.json();if(!r.ok)throw Error(d.error);onRefresh();}catch(e){setError(e instanceof Error?e.message:'Could not change follow-up.');}finally{setBusy(false);}}
 return <article hidden={hidden} className="live-property instant-lead-card" id={`property-${lead.screeningId}`} aria-labelledby={`lead-name-${lead.leadId}`}>
  <div className="instant-lead-topline"><span className="instant-lead-label"><UserRound size={13} aria-hidden="true"/>Seller lead</span><span className="instant-lead-source">HomeOffer Network · Instant form</span><span className="instant-lead-status">{status}</span></div>
  <div className="instant-lead-body">
   <div className="instant-lead-identity"><span className="instant-lead-avatar" aria-hidden="true">{initials||<UserRound size={26}/>}</span><div><h4 id={`lead-name-${lead.leadId}`}>{lead.name||'New seller'}</h4><p className="instant-lead-phone">{displayContactPhone(lead.phone)}</p><p className="instant-lead-time">Received {safeLocalTime(lead.submittedAt)}</p></div></div>
   <div className="instant-lead-next"><span className="instant-lead-next-label"><MapPin size={14} aria-hidden="true"/>{lead.addressConfirmedAt?'Property lookup':'Next step'}</span><h5>{nextTitle}</h5>{lead.address&&<p className="instant-lead-address">{lead.address}</p>}<p>{nextDetail}</p></div>
  </div>
  <ol className="instant-lead-progress" aria-label="Progress toward a property deal">
   <li className="is-complete"><span aria-hidden="true"><Check size={13}/></span>Lead received</li>
   <li className={lead.addressConfirmedAt?'is-complete':stopped||paused?'':'is-current'} aria-current={!lead.addressConfirmedAt&&!stopped&&!paused?'step':undefined}><span aria-hidden="true">{lead.addressConfirmedAt?<Check size={13}/>:2}</span>Property address</li>
   <li className={lead.addressConfirmedAt&&!stopped&&!paused?'is-current':''} aria-current={lead.addressConfirmedAt&&!stopped&&!paused?'step':undefined}><span aria-hidden="true">3</span>Property deal</li>
  </ol>
  <div className="instant-lead-footer"><p className="instant-lead-activity">{stopped?'Contact closed':paused?'Follow-up paused':lead.responseAt?'Seller replied '+safeLocalTime(lead.responseAt):lead.firstOutreachAt?'First outreach '+safeLocalTime(lead.firstOutreachAt):'First outreach pending'}</p><div className="instant-lead-actions"><button type="button" className="workspace-quiet" aria-pressed={view==='texts'} onClick={()=>setView(view==='texts'?null:'texts')}><MessageCircle size={15} aria-hidden="true"/>Texts</button><button type="button" className="workspace-quiet" aria-pressed={view==='calls'} onClick={()=>setView(view==='calls'?null:'calls')}><Phone size={15} aria-hidden="true"/>Calls</button>{!stopped&&<button type="button" className="workspace-quiet instant-lead-pause" disabled={busy} onClick={()=>void pause()}>{busy?'Saving…':lead.paused?'Resume follow-up':'Pause follow-up'}</button>}</div></div>
  {lead.holdReason&&<p className="instant-lead-review">{lead.holdReason}</p>}{error&&<p role="alert">{error}</p>}
  {view==='texts'&&<DealMessages historyOnly dealId={lead.dealId} contactNames={{[lead.phone]:lead.name||'Seller'}} onTakeover={onRefresh}/>} {view==='calls'&&<PropertyCallHistory screeningId={lead.screeningId} conversations={[]}/>}
 </article>;
}
