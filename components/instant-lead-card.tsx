'use client';
import './instant-lead-card.css';
import {SellerReplyPreview} from './seller-reply-preview';
import type {SellerTextSummary} from '@/lib/seller-text-summary';
import {useEffect,useRef,useState} from 'react';
import {Check,MapPin,MessageCircle,Phone,UserRound} from 'lucide-react';
import {ReadOnlyPropertyMessages} from './read-only-property-messages';
import {DealMessages} from './deal-messages';
import {PropertyCallHistory} from './property-call-history';
import {displayContactPhone} from './manual-call-options';
import {safeLocalTime} from './workspace-view';
export type InstantLeadCardData={leadId:string;screeningId:string;dealId:string;name:string|null;phone:string;address:string|null;state:string;paused:boolean;declinedAt:string|null;submittedAt:string;firstOutreachAt:string|null;responseAt:string|null;addressConfirmedAt:string|null;formId:string;campaignId:string|null;holdReason:string|null};
export const instantLeadGroup=(lead:InstantLeadCardData)=>lead.declinedAt?'history':lead.holdReason||['review','numbers_review','unmatched','duplicate','market_review'].includes(lead.state)?'attention':lead.addressConfirmedAt?'active':'waiting';
export function InstantLeadCard({apiBase='/api/work',readOnly=false,lead,sellerText,textRequest,onRefresh,botPaused=false,stale=false,hidden=false}:{apiBase?:string;readOnly?:boolean;lead:InstantLeadCardData;sellerText?:SellerTextSummary;textRequest?:{threadId:string;nonce:number}|null;onRefresh:()=>void;botPaused?:boolean;stale?:boolean;hidden?:boolean}){
 const [view,setView]=useState<'texts'|'calls'|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const handledTextRequest=useRef(0);
 useEffect(()=>{if(textRequest&&textRequest.nonce!==handledTextRequest.current){handledTextRequest.current=textRequest.nonce;setView('texts');}},[textRequest]);
 const stopped=!!lead.declinedAt,paused=lead.paused||botPaused;
 const needsReview=!!lead.holdReason||['review','numbers_review','duplicate','market_review'].includes(lead.state);
 const status=stopped?'Contact stopped':stale?'Checking status':paused?'Follow-up paused':needsReview?'Needs review':lead.state==='unmatched'?'Check address':lead.addressConfirmedAt?'Matching property':lead.responseAt?'Seller replied':lead.firstOutreachAt?'Awaiting seller reply':'New lead';
 const initials=(lead.name??'').trim().split(/\s+/).slice(0,2).map(part=>Array.from(part)[0]).join('').toUpperCase();
 const nextTitle=stopped?'Follow-up stopped':stale?'Your lead is saved':paused?'Your lead is saved':needsReview?'This lead needs a review':lead.state==='unmatched'?'Confirm the property address':lead.addressConfirmedAt?'Finding the property details':lead.responseAt?'The conversation has started':lead.firstOutreachAt?'A new connection is underway':'A seller joined your pipeline';
 const nextDetail=stopped?'The seller asked to stop contact.':stale?'Refresh to check the latest outreach and replies.':paused?'Follow-up is paused. Their details and activity stay here.':needsReview?'Review the saved activity before continuing.':lead.state==='unmatched'?'The address needs a correction before we can match the property.':lead.addressConfirmedAt?'The address is saved. A property card with photos and numbers appears after a successful match.':lead.responseAt?'Next: confirm their street address, city and state to find the property.':lead.firstOutreachAt?'Outreach has started. We’re waiting for their reply so we can confirm the property address.':'Their name and phone are saved. The first conversation will ask which property they want to sell.';
 const progress=[{label:'Lead saved',done:true},{label:'Outreach',done:!!(lead.firstOutreachAt||lead.responseAt||lead.addressConfirmedAt)},{label:'Seller reply',done:!!(lead.responseAt||lead.addressConfirmedAt)},{label:'Property match',done:false}];
 const currentStep=stopped||paused||stale||needsReview||lead.state==='unmatched'?-1:progress.findIndex(step=>!step.done);
 async function pause(){if(readOnly)return;setBusy(true);setError('');try{const r=await fetch('/api/work/instant-leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leadId:lead.leadId,paused:!lead.paused})});const d=await r.json();if(!r.ok)throw Error(d.error);onRefresh();}catch(e){setError(e instanceof Error?e.message:'Could not change follow-up.');}finally{setBusy(false);}}
 return <article hidden={hidden} data-conversation-open={view==='texts'?'true':undefined} className="live-property instant-lead-card" id={`property-${lead.screeningId}`} aria-labelledby={`lead-name-${lead.leadId}`}>
  <div className="instant-lead-topline"><span className="instant-lead-label"><Check size={14} aria-hidden="true"/>Lead generated</span><span className="instant-lead-source">HomeOffer Network · Instant form</span><span className="instant-lead-status">{status}</span></div>
  <div className="instant-lead-body">
   <div className="instant-lead-identity"><span className="instant-lead-avatar" aria-hidden="true">{initials||<UserRound size={26}/>}</span><div><h4 id={`lead-name-${lead.leadId}`}>{lead.name||'New seller'}</h4><p className="instant-lead-phone">{displayContactPhone(lead.phone)}</p><p className="instant-lead-time">Received {safeLocalTime(lead.submittedAt)}</p></div></div>
   <div className="instant-lead-next"><span className="instant-lead-next-label"><MapPin size={14} aria-hidden="true"/>{lead.addressConfirmedAt?'Property lookup':'Next step'}</span><h5>{nextTitle}</h5>{lead.address&&<p className="instant-lead-address">{lead.address}</p>}<p>{nextDetail}</p></div>
  </div>
  <ol className="instant-lead-progress" aria-label="Progress toward a property deal">
   {progress.map((step,index)=><li key={step.label} className={step.done?'is-complete':index===currentStep?'is-current':''} aria-current={index===currentStep?'step':undefined}><span aria-hidden="true">{step.done?<Check size={13}/>:index+1}</span>{step.label}</li>)}
  </ol>
  {sellerText&&<SellerReplyPreview reply={sellerText} onOpen={()=>setView('texts')}/>}
  <div className="instant-lead-footer"><p className="instant-lead-activity">{stopped?'Contact closed':paused?'Follow-up paused':lead.responseAt?'Seller replied '+safeLocalTime(lead.responseAt):lead.firstOutreachAt?'First outreach '+safeLocalTime(lead.firstOutreachAt):'First outreach pending'}</p><div className="instant-lead-actions"><button type="button" className="workspace-quiet" aria-pressed={view==='texts'} onClick={()=>setView(view==='texts'?null:'texts')}><MessageCircle size={15} aria-hidden="true"/>Texts</button><button type="button" className="workspace-quiet" aria-pressed={view==='calls'} onClick={()=>setView(view==='calls'?null:'calls')}><Phone size={15} aria-hidden="true"/>Calls</button>{!stopped&&<button type="button" className="workspace-quiet instant-lead-pause" disabled={busy||stale||readOnly} onClick={()=>void pause()}>{busy?'Saving…':lead.paused?'Resume follow-up':'Pause follow-up'}</button>}</div></div>
  {lead.holdReason&&<p className="instant-lead-review">{lead.holdReason}</p>}{error&&<p role="alert">{error}</p>}
  {view==='texts'&&(readOnly?<ReadOnlyPropertyMessages base={apiBase} screeningId={lead.screeningId} preferredThreadId={textRequest?.threadId||sellerText?.thread_id}/>:<DealMessages active={!hidden} initialThreadId={textRequest?.threadId||sellerText?.thread_id} historyOnly dealId={lead.dealId} contactNames={{[lead.phone]:lead.name||'Seller'}} onTakeover={onRefresh}/>)} {view==='calls'&&<PropertyCallHistory apiBase={apiBase} screeningId={lead.screeningId} conversations={[]}/>}
 </article>;
}
