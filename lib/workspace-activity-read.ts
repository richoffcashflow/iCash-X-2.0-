import {instantLeadsEnabled} from '@/lib/meta-instant-lead-service';
import type {InstantLeadCardData} from '@/components/instant-lead-card';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {db} from '@/lib/stripe-test';
import {attachTaskRecovery} from '@/lib/task-completion-service';
import {workspaceAttentionQuery} from '@/lib/workspace-attention-query';
import type {SmsRouteReview} from '@/components/sms-route-review';
const pageSize=6;
type Property={id:string;state:string;result:{property:{propertyId:string;address:string};financialCheck:{status:string;reason:string};preliminarySellerCeilingCents:number|null};completed_at:string};
type Attention={id:string;screening_id?:string|null;deal_id?:string|null;[key:string]:unknown};
type ContactRow={account_id:string;screening_id:string;created_at:unknown;lookup_at:unknown;people:unknown};
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const contactText=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max)||null:null;
const contactTime=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
function purchasedContacts(rows:ContactRow[],accountId:string,visible:Property[]){
 const ids=new Set(visible.map(p=>p.id));
 // This table is written only by the DealMachine owner lookup. Never forward raw
 // provider results, match guesses, email addresses or claimed permissions.
 return rows.filter(row=>row.account_id===accountId&&ids.has(row.screening_id)).map(row=>({
  screening_id:row.screening_id,created_at:contactTime(row.created_at),fetchedAt:contactTime(row.lookup_at),source:'DealMachine',ownershipVerified:false,outreachAuthorized:false,
  contacts:(Array.isArray(row.people)?row.people:[]).slice(0,25).filter(record).map(person=>({
   name:contactText(person.name,200),
   phones:(Array.isArray(person.phones)?person.phones:[]).slice(0,20).filter(record).map(phone=>({
    number:contactText(phone.number,30),type:contactText(phone.type,30),doNotCall:typeof phone.doNotCall==='boolean'?phone.doNotCall:null
   }))
  }))
 }));
}
function pageNumber(value:string|null){if(value===null)return 0;if(!/^\d{1,5}$/.test(value))throw Error('Invalid page');const page=Number(value);if(page>10000)throw Error('Invalid page');return page;}
export async function workspaceActivity(req:Request,accountId:string,{refreshOutcomes=false}:{refreshOutcomes?:boolean}={}){
 const headers={'Cache-Control':'private, no-store'};
 try{
  const params=new URL(req.url).searchParams;
  const page=pageNumber(params.get('page')),attentionPage=pageNumber(params.get('attentionPage'));
  const screeningId=params.get('screeningId');if(screeningId)z.guid().parse(screeningId);
  const query=(params.get('query')??'').trim();
  const responsesOnly=params.get('view')==='responses',opportunitiesOnly=params.get('view')==='opportunities';
  // A literal address fragment, never a caller-supplied PostgREST expression or wildcard.
  if(query.length>100||/[^\p{L}\p{N}\s#.,'\-]/u.test(query))return NextResponse.json({error:'Search using a street, city or ZIP code.'},{status:400,headers});
  if(refreshOutcomes)await db('rpc/icash_refresh_opportunity_outcomes','POST',{p_account:accountId});
  const responseCounts=await db<{responded:number;total:number}>('rpc/icash_workspace_response_counts','POST',{p_account:accountId});
  let properties:Property[];
  if(screeningId){
   properties=await db<Property[]>(`icash_screening_jobs?account_id=eq.${accountId}&id=eq.${screeningId}&state=eq.complete&select=id,state,result,completed_at&limit=1`);
  }else{
   // Rank actual seller responses across the account before paging.
   properties=opportunitiesOnly
    ?await db<Property[]>('rpc/icash_workspace_ready_opportunities','POST',{p_account:accountId,p_query:query,p_offset:page*pageSize,p_limit:pageSize+1})
    :await db<Property[]>('rpc/icash_workspace_opportunities','POST',{p_account:accountId,p_query:query,p_offset:page*pageSize,p_limit:pageSize+1,p_responses_only:responsesOnly});
  }
  const instantRows=instantLeadsEnabled(process.env)?await db<InstantLeadCardData[]>('rpc/icash_meta_workspace_response_leads','POST',{p_account:accountId,p_query:query,p_offset:page*pageSize,p_limit:pageSize+1,p_screening:screeningId??null,p_responses_only:(responsesOnly||opportunitiesOnly)&&!screeningId}):[];
  const instantLeads=instantRows.slice(0,pageSize);
  const visible=properties.slice(0,pageSize);
  const ids=visible.map(p=>p.id).join(',');
  const propertyIds=visible.map(p=>p.result.property.propertyId).filter(id=>/^prop_[a-zA-Z0-9]+$/.test(id)).join(',');
  const [deals,contactRows,controls,conversations,callbacks,sellerRows,buyerCalls]=ids?await Promise.all([
   db<{id:string;screening_id:string}[]>(`icash_deal_files?account_id=eq.${accountId}&screening_id=in.(${ids})&select=id,screening_id,terms,stage,updated_at`),
   db<ContactRow[]>(`icash_owner_contacts?account_id=eq.${accountId}&screening_id=in.(${ids})&select=account_id,screening_id,created_at,lookup_at:result->>fetchedAt,people:result->contacts&limit=${pageSize}`),
   propertyIds?db<unknown[]>(`icash_property_controls?account_id=eq.${accountId}&property_id=in.(${propertyIds})&manual=eq.true&select=property_id`):Promise.resolve([]),
   db<unknown[]>(`icash_live_conversations?account_id=eq.${accountId}&screening_id=in.(${ids})&state=eq.complete&select=id,screening_id,party,completed_at,summary:result->>summary,durationSeconds:result->durationSeconds,nextAction:result->>nextAction,interested:result->interested,optedOut:result->optedOut,humanRequested:result->humanRequested&order=completed_at.desc,id.desc&limit=24`),
   db<unknown[]>(`icash_live_callbacks?account_id=eq.${accountId}&screening_id=in.(${ids})&select=id,screening_id,due_at,timezone,state&order=due_at,id&limit=24`),
   db<{account_id:string;screening_id:string;lead:{name:string|null;phone:string}|null}[]>(`icash_seller_matches?account_id=eq.${accountId}&screening_id=in.(${ids})&select=account_id,screening_id,lead:icash_seller_intakes(name,phone)&limit=${pageSize}`),
   db<unknown[]>('rpc/icash_buyer_reception_calls','POST',{p_account:accountId,p_screenings:visible.map(p=>p.id)})
  ]):[[],[],[],[],[],[],[]];
  conversations.push(...buyerCalls);
  const contacts=purchasedContacts(contactRows,accountId,visible);
  // Self-reported seller identity is displayed separately from provider owner matches.
  // Neither the form checkbox nor ownership claim grants the customer's calling authority.
  for(const lead of sellerRows.filter(l=>l.account_id===accountId&&l.lead&&visible.some(p=>p.id===l.screening_id)))contacts.push({screening_id:lead.screening_id,created_at:null,fetchedAt:null,source:'HomeOffer Network · seller-submitted',ownershipVerified:false,outreachAuthorized:false,contacts:[{name:contactText(lead.lead?.name,100),phones:[{number:contactText(lead.lead?.phone,30),type:'Seller-submitted',doNotCall:null}]}]});
  // Existence joins return each visible property once, regardless of request volume
  // or the separately selected attention page. Empty embeds avoid transferring messages.
  const propertyAttentionRows=ids?await Promise.all([
   ['icash_text_attention','open'],['icash_handoffs','open'],['icash_sms_call_requests','needs_review'],['icash_buyer_viewing_requests','needs_confirmation'],['icash_seller_gaps','needs_review'],['icash_closing_setup','needs_review']
  ].map(([table,state])=>db<{id:string}[]>(`icash_screening_jobs?account_id=eq.${accountId}&id=in.(${ids})&select=id,${table}!inner()&${table}.account_id=eq.${accountId}&${table}.state=${table==='icash_handoffs'?'neq.resolved':`eq.${state}`}&limit=${pageSize}`))):[];
  const propertyAttentionIds=[...new Set(propertyAttentionRows.flat().map(p=>p.id))];
  const journeys=ids?await db('rpc/icash_journey_progress','POST',{p_account:accountId,p_screenings:visible.map(p=>p.id)}):[];
  const dealIds=deals.map(d=>d.id).join(',');
  const proceeds=dealIds?await db<{deal_id:string}[]>(`icash_proceeds_receipts?account_id=eq.${accountId}&deal_id=in.(${dealIds})&select=deal_id&limit=${pageSize}`):[];
  const queuePage={limit:pageSize+1,offset:attentionPage*pageSize};
  const [closingTaskRows,textRows,callRows,handoffRows,signing,signatureRows,routeRows,viewingRows,recoveryRows,closingRows]=await Promise.all([
   db<Attention[]>('rpc/icash_closing_task_attention','POST',{p_account:accountId,p_offset:attentionPage*pageSize,p_limit:pageSize+1}),
   db<Attention[]>(workspaceAttentionQuery('icash_text_attention',accountId,{...queuePage,select:'id,message_id,screening_id,deal_id,kind,party,quote,timezone',order:'created_at,id'})),
   db<Attention[]>(workspaceAttentionQuery('icash_sms_call_requests',accountId,{...queuePage,select:'id,screening_id,requested_at,state',order:'requested_at,id'})),
   db<Attention[]>(workspaceAttentionQuery('icash_handoffs',accountId,{...queuePage,select:'id,screening_id,party,reason,summary,next_action,state,assigned_to,due_at,resolution',order:'created_at,id'})),
   dealIds?db<unknown[]>(`icash_signing_envelopes?account_id=eq.${accountId}&deal_id=in.(${dealIds})&select=id,deal_id,kind,state,test_mode,provider_status,updated_at`):Promise.resolve([]),
   db<Attention[]>(workspaceAttentionQuery('icash_signing_envelopes',accountId,{...queuePage,select:'id,deal_id,kind,test_mode',order:'created_at,id'})),
   db<SmsRouteReview[]>('rpc/icash_sms_route_review_items','POST',{p_account:accountId,p_offset:attentionPage*pageSize,p_limit:pageSize+1}),
   db<Attention[]>(workspaceAttentionQuery('icash_buyer_viewing_requests',accountId,{...queuePage,select:'id,screening_id,deal_id,kind,quote,title_quote,viewing_quote,coordination_quote,timezone,created_at,acknowledged_at',order:'created_at,id'})),
   db<Attention[]>(workspaceAttentionQuery('icash_seller_gaps',accountId,{...queuePage,select:'id,screening_id,deal_id,reason,quote,review_reason,updated_at',order:'updated_at,id'})),
   db<Attention[]>(workspaceAttentionQuery('icash_closing_setup',accountId,{...queuePage,select:'id,screening_id,deal_id,review_reason,state,updated_at',order:'created_at,id'}))
  ]);
  const closingTasks=await attachTaskRecovery(accountId,closingTaskRows.slice(0,pageSize));
  const closingReview=closingRows.slice(0,pageSize),viewingRequests=viewingRows.slice(0,pageSize),sellerRecovery=recoveryRows.slice(0,pageSize);
  const textAttention=textRows.slice(0,pageSize),callRequests=callRows.slice(0,pageSize),handoffs=handoffRows.slice(0,pageSize),signatureActions=signatureRows.slice(0,pageSize);
  // Resolve bounded queue context independently of the current property page/search.
  const signatureDeals=[...new Set(signatureActions.map(s=>s.deal_id).filter((id):id is string=>!!id))];
  const linkedDeals=signatureDeals.length?await db<{id:string;screening_id:string}[]>(`icash_deal_files?account_id=eq.${accountId}&id=in.(${signatureDeals.join(',')})&select=id,screening_id`):[];
  for(const item of signatureActions)item.screening_id=linkedDeals.find(d=>d.id===item.deal_id)?.screening_id??null;
  const allAttention=[...closingTasks,...closingReview,...sellerRecovery,...viewingRequests,...textAttention,...callRequests,...handoffs,...signatureActions];
  const missingIds=[...new Set(allAttention.map(a=>a.screening_id).filter((id):id is string=>!!id&&!visible.some(p=>p.id===id)))];
  const context=missingIds.length?await db<{id:string;result:{address:string}|null}[]>(`icash_screening_jobs?account_id=eq.${accountId}&id=in.(${missingIds.join(',')})&state=eq.complete&select=id,result:result->property`):[];
  // JSON projection above returns property directly; keep existing property results unchanged.
  const addressById=new Map(visible.map(p=>[p.id,p.result.property.address]));
  for(const p of context)addressById.set(p.id,p.result?.address??'');
  for(const item of allAttention)item.address=item.screening_id?addressById.get(item.screening_id)??null:null;
  const smsRouteReviews=routeRows.slice(0,pageSize);
  const attentionHasMoreByKind={closingTasks:closingTaskRows.length>pageSize,closing:closingRows.length>pageSize,sellerRecovery:recoveryRows.length>pageSize,viewings:viewingRows.length>pageSize,routing:routeRows.length>pageSize,texts:textRows.length>pageSize,calls:callRows.length>pageSize,handoffs:handoffRows.length>pageSize,signatures:signatureRows.length>pageSize};
  return NextResponse.json({responseCounts,instantLeads,proceedsReceivedDealIds:proceeds.map(p=>p.deal_id),journeys,closingTasks,closingReview,sellerRecovery,viewingRequests,smsRouteReviews,textAttention,signatureActions,signing,signingConfigured:!!(process.env.DOCUSEAL_API_KEY||process.env.DOCUSEAL_TEST_API_KEY),properties:visible,propertyAttentionIds,hasMore:!screeningId&&(properties.length>pageSize||instantRows.length>pageSize),deals,contacts,controls,conversations,callbacks,callRequests,handoffs,page,attentionPage,attentionHasMore:Object.values(attentionHasMoreByKind).some(Boolean),attentionHasMoreByKind,searchSupported:true,query},{headers});
 }catch{return NextResponse.json({error:'Could not load your work. Sign in and retry.'},{status:503,headers});}
}
