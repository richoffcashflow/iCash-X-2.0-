import {db} from '@/lib/stripe-test';
import {analysisMoney} from './property-analysis-view';
import {journeyNextAction,type JourneyProgress} from './deal-journey-progress';
import {redactSupportQuestion} from './support-policy';
import type {CoachDetails,CoachThread} from './workspace-assistant-coach';

type RecentMessage={id:string;body:string;direction:string;state:string;customer_author_id:string|null;created_at:string;thread:{id:string;party:'seller'|'buyer';paused:boolean}};
type Envelope={id:string;kind:string;state:string;test_mode:boolean};
export async function assistantDealContext(accountId:string,screeningId:string,propertyId:string,dealId:string):Promise<CoachDetails>{
 const scope=`account_id=eq.${accountId}&deal_id=eq.${dealId}`;
 const [envelopes,controls,links,viewings,journeys,network,buyerCalls,...threadGroups]=await Promise.all([
  db<Envelope[]>(`icash_signing_envelopes?${scope}&select=id,kind,state,test_mode&limit=30`),
  db<{manual:boolean}[]>(`icash_property_controls?${new URLSearchParams({account_id:'eq.'+accountId,property_id:'eq.'+propertyId,select:'manual',limit:'1'})}`),
  db<{asking_price_cents:number}[]>(`icash_buyer_package_links?${scope}&revoked_at=is.null&select=asking_price_cents&limit=2`),
  db<{quote:string;state:string}[]>(`icash_seller_viewing_availability?${scope}&select=quote,state&order=stated_at.desc,created_at.desc,id.desc&limit=1`),
  db<JourneyProgress[]>('rpc/icash_journey_progress','POST',{p_account:accountId,p_screenings:[screeningId]}),
  db<{buyers:{state:string;reply:string|null}[]}>('rpc/icash_network_workspace','POST',{p_account:accountId,p_deal:dealId}),
  db<{summary:string|null}[]>('rpc/icash_buyer_reception_calls','POST',{p_account:accountId,p_screenings:[screeningId]}),
  ...(['seller','buyer'] as const).map(party=>db<RecentMessage[]>(`icash_text_messages?account_id=eq.${accountId}&thread.account_id=eq.${accountId}&thread.deal_id=eq.${dealId}&thread.retired_at=is.null&thread.party=eq.${party}&select=id,body,direction,state,customer_author_id,created_at,thread:icash_text_threads!inner(id,party,paused)&order=created_at.desc,id.desc&limit=24`))
 ]);
 const assignments=envelopes.filter(e=>e.kind==='assignment'&&e.state==='completed'&&!e.test_mode);
 const deposits=assignments.length===1?await db<{id:string}[]>(`icash_buyer_deposit_receipts?${scope}&envelope_id=eq.${assignments[0].id}&select=id&limit=1`):[];
 const threads:CoachThread[]=[];
 for(const rows of threadGroups){
  const recent=new Map<string,CoachThread>();
  for(const m of rows){
   if(!recent.has(m.thread.id)){if(recent.size===2)continue;recent.set(m.thread.id,{...m.thread,messages:[]});}
   const t=recent.get(m.thread.id)!;if(t.messages.length===6)continue;
   t.messages.push({id:m.id,body:redactSupportQuestion(m.body??'').slice(0,600),direction:m.direction,state:m.state,author:m.direction==='incoming'?'contact':m.customer_author_id?'you':'bot',at:m.created_at});
  }
  threads.push(...[...recent.values()].map(t=>({...t,messages:t.messages.reverse()})));
 }
 return {buyerEmailReplies:(network?.buyers??[]).filter(b=>b.reply).slice(0,4).map(b=>({state:b.state,reply:redactSupportQuestion(b.reply!).slice(0,500)})),buyerCalls:buyerCalls.filter(c=>c.summary).slice(0,2).map(c=>redactSupportQuestion(c.summary!).slice(0,600)),dealId,manual:controls[0]?.manual===true,purchaseSigned:envelopes.some(e=>e.kind==='purchase'&&e.state==='completed'&&!e.test_mode),assignmentSigned:assignments.length>0,buyerPrice:links.length===1?analysisMoney(links[0].asking_price_cents):null,depositReceived:deposits.length===1,viewing:viewings[0]?`${viewings[0].state}: ${redactSupportQuestion(viewings[0].quote).slice(0,500)}`:null,buyerProgress:journeys.filter(j=>j.deal_id===dealId&&j.screening_id===screeningId).slice(0,6).map(j=>({state:j.state,next:journeyNextAction(j).detail})),threads};
}
