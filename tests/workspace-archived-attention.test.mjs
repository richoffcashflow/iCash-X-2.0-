import {isConfirmedVoicemail} from '../lib/call-display-evidence.ts';
import {instantLeadsEnabled} from '../lib/meta-instant-lead-service.ts';
process.env.META_INSTANT_LEADS_ENABLED='true';process.env.VERCEL_ENV='production';
// Local fixtures only: archived agreements remain intact, but never create work.
import assert from 'node:assert/strict';
import {z} from 'zod';
import {workspaceAttentionQuery,workspaceAttentionTables} from '../lib/workspace-attention-query.ts';
import {validActivityReport} from '../lib/activity-report.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';

const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=uuid(900),other=uuid(901);
const properties=Array.from({length:23},(_,i)=>({id:uuid(i+1),account_id:i===7?other:account,state:i<7?'archived':'complete',result:{property:{propertyId:`prop_${i+1}`,address:`${i+1} Fixture Street`}}}));
const deals=properties.map((p,i)=>({id:uuid(100+i),account_id:account,screening_id:p.id}));
// Old rows precede current work. Current tasks are outside the first lead page.
const requests=deals.filter((_,i)=>i<8||i>=16).map((d,i)=>({id:uuid(200+i),account_id:account,deal_id:d.id,screening_id:d.screening_id,created_at:'2026-10-01T00:00:00Z'}));
const states={icash_text_attention:'open',icash_sms_call_requests:'needs_review',icash_handoffs:'acknowledged',icash_signing_envelopes:'customer_signature_needed',icash_buyer_viewing_requests:'needs_confirmation',icash_seller_gaps:'needs_review',icash_closing_setup:'needs_review'};
const queues=Object.fromEntries(workspaceAttentionTables.map(table=>[table,requests.map(r=>({...r,state:states[table],kind:'purchase',test_mode:false,portal_journey_id:null}))]));
const expiredRecovery=deals.slice(8,16).map((d,i)=>({id:uuid(600+i),account_id:account,deal_id:d.id,screening_id:d.screening_id,state:'needs_review',reason:'no_response',review_reason:'contact_checks_expired',quote:'Saved unanswered question',created_at:'2026-09-01T00:00:00Z'}));
queues.icash_seller_gaps=[...expiredRecovery,...queues.icash_seller_gaps.map(r=>({...r,reason:'human',review_reason:r.screening_id===uuid(23)?'unrecognized_review':null}))];
const originalHistory=JSON.stringify(queues);
const active=id=>properties.some(p=>p.id===id&&p.account_id===account&&p.state==='complete');
const page=(rows,q)=>rows.slice(Number(q.get('offset')??0),Number(q.get('offset')??0)+Number(q.get('limit')??rows.length));
// Model the relevant PostgREST predicates, including SQL NULL != value semantics.
const contactReviewRows=(rows,expression)=>!expression?rows:rows.filter(r=>expression.slice(1,-1).split(',').some(clause=>{
 const [column,operator,...parts]=clause.split('.'),value=parts.join('.');
 assert.equal(column,'review_reason');
 if(operator==='is'&&value==='null')return r[column]==null;
 assert.equal(operator,'neq');return r[column]!=null&&r[column]!==value;
}));
let onlyTable=null,unmatchedText=false,closingEnabled=true;
const db=async(path,method='GET',body)=>{
 if(path.startsWith('rpc/')){
  assert.equal(method,'POST');assert.equal(body.p_account,account);
  if(path==='rpc/icash_prospecting_progress')return {status:'budget_reached',callsBudgetHeld:2};
  if(path==='rpc/icash_closing_task_attention')return closingEnabled?requests.filter(r=>active(r.screening_id)).slice(body.p_offset,body.p_offset+body.p_limit):[];
  if(path==='rpc/icash_sms_route_review_items')return unmatchedText?[{message_id:uuid(800),needs_review:true,candidates:[]}]:[];
  if(path==='rpc/icash_activity_report')return {days:body.p_days,timezone:'America/Chicago',startAt:'2026-10-01T00:00:00Z',endAt:'2026-10-12T00:00:00Z',leads:0,calls:0,texts:0,contracts:0};
  if(path==='rpc/icash_refresh_opportunity_outcomes')return null;
  if(path==='rpc/icash_workspace_text_reply_counts')return {properties:0,unreadProperties:0,unreadMessages:0};
  if(path==='rpc/icash_workspace_seller_texts')return [];
  if(path==='rpc/icash_workspace_response_counts')return {responded:0,total:0};
  if(path==='rpc/icash_workspace_opportunities')return properties.filter(p=>p.account_id===account&&p.state==='complete'&&(!body.p_query||p.result.property.address.includes(body.p_query))).slice(body.p_offset,body.p_offset+body.p_limit);
  if(['rpc/icash_journey_progress','rpc/icash_buyer_reception_calls','rpc/icash_prioritized_work','rpc/icash_meta_workspace_response_leads'].includes(path))return [];
  throw Error('Unexpected RPC '+path);
 }
 assert.equal(method,'GET','Workspace reads never mutate retained history');
 const [table,search]=path.split('?'),q=new URLSearchParams(search);
 assert.equal(q.get(table==='icash_accounts'?'id':'account_id'),`eq.${account}`);
 if(table==='icash_accounts')return [{bot_paused:false}];
 if(table==='icash_wallets')return [{balance_cents:1000,reserved_cents:0}];
 if(table==='icash_sms_route_reviews')return unmatchedText?[{message_id:uuid(800)}]:[];
 if(table==='icash_screening_jobs'){
  let rows=properties.filter(p=>p.account_id===account&&(!q.has('state')||q.get('state')===`eq.${p.state}`));
  if(q.has('id'))rows=rows.filter(p=>q.get('id').includes(p.id));
  const fragment=q.get('result->property->>address');if(fragment)rows=rows.filter(p=>p.result.property.address.includes(fragment.slice(7,-1)));
  if(q.get('select')==='id,result:result->property')return rows.map(p=>({id:p.id,result:p.result.property}));
  if(q.get('select').includes('!inner()')){
   const related=workspaceAttentionTables.find(name=>q.get('select').includes(`${name}!inner()`));
   if(!related||(onlyTable&&onlyTable!==related))return [];
   let children=queues[related].filter(r=>q.get(`${related}.account_id`)===`eq.${r.account_id}`&&(q.get(`${related}.state`)==='neq.resolved'?r.state!=='resolved':q.get(`${related}.state`)===`eq.${r.state}`));
   if(related==='icash_seller_gaps')children=contactReviewRows(children,q.get(`${related}.or`));
   return page(rows.filter(p=>children.some(r=>r.screening_id===p.id)),q).map(p=>({id:p.id}));
  }
  return page(rows,q);
 }
 if(table==='icash_deal_files')return q.has('id')?deals.filter(d=>q.get('id').includes(d.id)):[];
 if(workspaceAttentionTables.includes(table)){
  if(onlyTable&&onlyTable!==table)return [];
  let rows=queues[table];
  const signing=table==='icash_signing_envelopes',prefix=signing?'active_deal.active_property':'active_property';
  // Model PostgREST's INNER semantics: a left/omitted join cannot remove parents.
  if(q.get('select').includes('active_property:icash_screening_jobs!inner()')&&(!signing||q.get('select').includes('active_deal:icash_deal_files!inner('))){
   rows=rows.filter(r=>properties.some(p=>p.id===r.screening_id&&q.get(`${prefix}.state`)===`eq.${p.state}`&&q.get(`${prefix}.account_id`)===`eq.${p.account_id}`));
   if(signing)rows=rows.filter(r=>deals.some(d=>d.id===r.deal_id&&q.get('active_deal.account_id')===`eq.${d.account_id}`));
  }
  if(q.get('state')==='neq.resolved')rows=rows.filter(r=>r.state!=='resolved');
  else if(q.has('state'))rows=rows.filter(r=>q.get('state')===`eq.${r.state}`);
  if(q.get('portal_journey_id')==='is.null')rows=rows.filter(r=>r.portal_journey_id===null);
  if(table==='icash_seller_gaps')rows=contactReviewRows(rows,q.get('or'));
  return page(rows,q).map(r=>signing?{id:r.id,deal_id:r.deal_id,kind:r.kind,test_mode:r.test_mode}:{...r});
 }
 if(['icash_owner_contacts','icash_seller_matches','icash_property_controls','icash_live_conversations','icash_live_callbacks','icash_automation_tickets'].includes(table))return [];
 throw Error('Unexpected read '+table);
};
const activityDeps={isConfirmedVoicemail,instantLeadsEnabled,db,z,workspaceAttentionQuery,workAccount:async()=>({accountId:account}),attachTaskRecovery:async(_,rows)=>rows,NextResponse:{json:(body,options={})=>({body,status:options.status??200})}};
const {workspaceActivity}=await loadService('lib/workspace-activity-read.ts',activityDeps);
const {GET}=await loadService('app/api/work/activity/route.ts',{...activityDeps,workspaceActivity});
const {workspaceAssistantContext}=await loadService('lib/workspace-assistant-context.ts',{db,workspaceAttentionQuery,workspaceAttentionTables,validActivityReport,currentBotActivity:input=>{assert.deepEqual(input.progress,{status:'budget_reached',callsBudgetHeld:2});return {checkedAt:'2026-10-12T00:00:00Z',label:'New outreach allowance used',active:false};}});
const get=query=>GET(new Request('https://example.invalid/api/work/activity'+query));
const attentionKeys=['textAttention','callRequests','handoffs','signatureActions','viewingRequests','sellerRecovery','closingReview','closingTasks'];
let response=await get('');assert.equal(response.status,200);assert.equal(response.body.properties.length,6);
for(const key of attentionKeys){
 assert.equal(response.body[key].length,6,key+' fills the page after excluding old history');
 assert.equal(response.body[key][0].screening_id,uuid(17),key+' ignores archived and other-account parents');
 assert.equal(response.body[key][0].address,'17 Fixture Street');
}
assert.equal(response.body.attentionHasMore,true);
assert.deepEqual(response.body.propertyAttentionIds,[],'Expired contact checks alone do not flag visible properties');
response=await get('?attentionPage=1');
for(const key of attentionKeys)assert.deepEqual(response.body[key].map(r=>r.screening_id),[uuid(23)],key+' has the real final page');
assert.equal(response.body.attentionHasMore,false);
response=await get('?query=NoMatches');assert.equal(response.body.properties.length,0);assert.equal(response.body.signatureActions.length,6,'Empty search does not suppress active work elsewhere');

// Hidden internal holds cannot consume queue pages or tell the assistant a user action is needed.
onlyTable='icash_seller_gaps';closingEnabled=false;
response=await get('');
assert.deepEqual(response.body.sellerRecovery.map(r=>r.screening_id),[17,18,19,20,21,22].map(uuid),'Null review reasons remain actionable after eight earlier expired checks');
assert.equal(response.body.attentionHasMoreByKind.sellerRecovery,true);
response=await get('?attentionPage=1');
assert.deepEqual(response.body.sellerRecovery.map(r=>r.screening_id),[uuid(23)],'Unknown review reasons stay visible on the real final page');
assert.equal(response.body.sellerRecovery[0].review_reason,'unrecognized_review');
assert.equal(response.body.attentionHasMore,false);
response=await get('?screeningId='+uuid(17));
assert.deepEqual(response.body.propertyAttentionIds,[uuid(17)],'A genuine follow-up still flags its property');
const recoveryStates=properties.map(p=>p.state);
for(const p of properties)if(Number(p.id.slice(-12))>=17)p.state='archived';
response=await get('');
assert.deepEqual(response.body.sellerRecovery,[],'An expired-only account has no customer resolution form');
assert.deepEqual(response.body.propertyAttentionIds,[],'An expired-only account has no ghost property flags');
assert.equal(response.body.attentionHasMore,false,'Hidden rows do not create empty extra pages');
assert.equal((await workspaceAssistantContext(account,'America/Chicago','What needs me?')).needsYou,false,'Expired-only checks do not ask the customer to act');
properties.forEach((p,i)=>{p.state=recoveryStates[i];});
assert.equal((await workspaceAssistantContext(account,'America/Chicago','What needs me?')).needsYou,true,'Genuine follow-up still informs the assistant');
assert.equal(JSON.stringify(queues),originalHistory,'Filtering leaves expired holds and source history intact');

closingEnabled=false;
for(const table of workspaceAttentionTables){onlyTable=table;assert.equal((await workspaceAssistantContext(account,'America/Chicago','What needs me?')).needsYou,true,table+' remains visible to the assistant, including acknowledged handoffs');}
onlyTable='no_direct_queue';closingEnabled=true;
assert.equal((await workspaceAssistantContext(account,'America/Chicago','What needs me?')).needsYou,true,'Closing deadlines also inform the assistant');
onlyTable=null;
for(const p of properties)if(p.account_id===account)p.state='archived';
response=await get('');assert.equal(response.status,200);assert.deepEqual(response.body.properties,[]);
for(const key of attentionKeys)assert.deepEqual(response.body[key],[],key+' stays empty after a clean slate');
assert.equal(response.body.attentionHasMore,false);
assert.equal((await workspaceAssistantContext(account,'America/Chicago','What needs me?')).needsYou,false);
response=await get('?screeningId='+uuid(1));assert.deepEqual(response.body.properties,[],'Old links do not reopen archived properties');
unmatchedText=true;
response=await get('');assert.equal(response.body.smsRouteReviews.length,1,'New unmatched messages still require review without a property');
assert.equal((await workspaceAssistantContext(account,'America/Chicago','What needs me?')).needsYou,true);
assert.equal(JSON.stringify(queues),originalHistory,'No agreement or request status was rewritten to clear the workspace');
console.log('Archived attention: all queues, nested signing ownership, pagination, cross-page context, empty search/workspace, assistant and unmatched messages passed. No provider calls.');
