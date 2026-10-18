import {instantLeadsEnabled} from '../lib/meta-instant-lead-service.ts';
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
const originalHistory=JSON.stringify(queues);
const active=id=>properties.some(p=>p.id===id&&p.account_id===account&&p.state==='complete');
const page=(rows,q)=>rows.slice(Number(q.get('offset')??0),Number(q.get('offset')??0)+Number(q.get('limit')??rows.length));
let onlyTable=null,unmatchedText=false,closingEnabled=true;
const db=async(path,method='GET',body)=>{
 if(path.startsWith('rpc/')){
  assert.equal(method,'POST');assert.equal(body.p_account,account);
  if(path==='rpc/icash_closing_task_attention')return closingEnabled?requests.filter(r=>active(r.screening_id)).slice(body.p_offset,body.p_offset+body.p_limit):[];
  if(path==='rpc/icash_sms_route_review_items')return unmatchedText?[{message_id:uuid(800),needs_review:true,candidates:[]}]:[];
  if(path==='rpc/icash_activity_report')return {days:body.p_days,timezone:'America/Chicago',startAt:'2026-10-01T00:00:00Z',endAt:'2026-10-12T00:00:00Z',leads:0,calls:0,texts:0,contracts:0};
  if(['rpc/icash_journey_progress','rpc/icash_buyer_reception_calls','rpc/icash_prioritized_work'].includes(path))return [];
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
  if(q.get('select').includes('!inner()'))return [];
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
  return page(rows,q).map(r=>signing?{id:r.id,deal_id:r.deal_id,kind:r.kind,test_mode:r.test_mode}:{...r});
 }
 if(['icash_owner_contacts','icash_seller_matches','icash_property_controls','icash_live_conversations','icash_live_callbacks','icash_automation_tickets'].includes(table))return [];
 throw Error('Unexpected read '+table);
};
const {GET}=await loadService('app/api/work/activity/route.ts',{instantLeadsEnabled,db,z,workspaceAttentionQuery,workAccount:async()=>({accountId:account}),attachTaskRecovery:async(_,rows)=>rows,NextResponse:{json:(body,options={})=>({body,status:options.status??200})}});
const {workspaceAssistantContext}=await loadService('lib/workspace-assistant-context.ts',{db,workspaceAttentionQuery,workspaceAttentionTables,validActivityReport,currentBotActivity:()=>({checkedAt:'2026-10-12T00:00:00Z',label:'Ready',active:false})});
const get=query=>GET(new Request('https://example.invalid/api/work/activity'+query));
const attentionKeys=['textAttention','callRequests','handoffs','signatureActions','viewingRequests','sellerRecovery','closingReview','closingTasks'];
let response=await get('');assert.equal(response.status,200);assert.equal(response.body.properties.length,6);
for(const key of attentionKeys){
 assert.equal(response.body[key].length,6,key+' fills the page after excluding old history');
 assert.equal(response.body[key][0].screening_id,uuid(17),key+' ignores archived and other-account parents');
 assert.equal(response.body[key][0].address,'17 Fixture Street');
}
assert.equal(response.body.attentionHasMore,true);
response=await get('?attentionPage=1');
for(const key of attentionKeys)assert.deepEqual(response.body[key].map(r=>r.screening_id),[uuid(23)],key+' has the real final page');
assert.equal(response.body.attentionHasMore,false);
response=await get('?query=NoMatches');assert.equal(response.body.properties.length,0);assert.equal(response.body.signatureActions.length,6,'Empty search does not suppress active work elsewhere');

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
