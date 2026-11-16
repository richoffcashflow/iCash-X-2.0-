import assert from 'node:assert/strict';
import {z} from 'zod';
import {workspaceAttentionQuery,sellerAttentionFilters,sellerReminderDeliveryEmbed} from '../lib/workspace-attention-query.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';

const account='00000000-0000-4000-8000-000000000001';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const responseCounts={responded:0,total:0},textReplyCounts={properties:0,unreadProperties:0,unreadMessages:0};
const primary=new Set(['rpc/icash_workspace_response_counts','rpc/icash_workspace_text_reply_counts','rpc/icash_workspace_opportunities','rpc/icash_workspace_ready_opportunities','rpc/icash_meta_workspace_response_leads']);
async function fixture({enabled=true,replyIds=[],refresh=false}={}){
 const calls=[],pending=[],refreshGate=deferred();let active=0,maxActive=0;
 const db=async(path,method,body)=>{
  calls.push({path,method,body});
  if(path.startsWith('rpc/'))assert.equal(body.p_account,account,'Every RPC retains the authenticated account');
  else assert.equal(new URLSearchParams(path.split('?')[1]).get('account_id'),'eq.'+account,'Every table read remains account-bound');
  if(path==='rpc/icash_refresh_opportunity_outcomes')return refreshGate.promise;
  if(path==='rpc/icash_workspace_text_reply_ids')return replyIds;
  if(primary.has(path)||path.startsWith('icash_screening_jobs?')&&!path.includes('!inner(')){
   const gate=deferred();pending.push({path,body,gate});active++;maxActive=Math.max(maxActive,active);
   try{return await gate.promise;}finally{active--;}
  }
  if(path.startsWith('rpc/')||path.includes('?'))return [];
  throw Error('Unexpected request');
 };
 const {workspaceActivity}=await loadService('lib/workspace-activity-read.ts',{
  db,z,workspaceAttentionQuery,sellerAttentionFilters,sellerReminderDeliveryEmbed,
  isConfirmedVoicemail:()=>false,instantLeadsEnabled:()=>enabled,
  attachTaskRecovery:async(_,rows)=>rows,
  NextResponse:{json:(body,options={})=>({body,status:options.status??200,headers:options.headers})}
 });
 const start=query=>workspaceActivity(new Request('https://app.example.test/api/work/activity'+query),account,{refreshOutcomes:refresh});
 const finish=()=>{for(const {path,gate} of pending)gate.resolve(path==='rpc/icash_workspace_response_counts'?responseCounts:path==='rpc/icash_workspace_text_reply_counts'?textReplyCounts:[]);};
 return {calls,pending,start,finish,refreshGate,maxActive:()=>maxActive};
}

// Hold every database response. The page and inbound page must be requested
// before either independent count finishes: three serial read stages become one.
for(const query of ['', '?view=opportunities', '?view=responses', '?page=2&query=Main', '?screeningId='+id(5)]){
 const f=await fixture(),result=f.start(query);await tick();
 assert.equal(f.pending.length,4,'Two counts and both independent page reads start in the same bounded stage');
 assert.equal(f.maxActive(),4);
 f.finish();const response=await result;
 assert.equal(response.status,200);assert.deepEqual(response.body.responseCounts,responseCounts);assert.deepEqual(response.body.textReplyCounts,textReplyCounts);
 assert.deepEqual(response.body.properties,[]);assert.deepEqual(response.body.instantLeads,[]);assert.equal(response.headers['Cache-Control'],'private, no-store');
 assert.equal(new Set(f.pending.map(p=>p.path)).size,4,'Each original query is issued once');
}

// Text ordering requires the reply-page result first. Six slots can contain
// inbound or complete properties, so counts plus page lookups peak at eight.
for(const states of [['awaiting_address','awaiting_address','complete','complete','complete','complete'],Array(6).fill('awaiting_address'),Array(6).fill('complete')]){
 const replyIds=states.map((state,index)=>({screening_id:id(index+10),state}));
 const f=await fixture({replyIds}),result=f.start('?view=unread');await tick();
 assert.equal(f.calls[0].path,'rpc/icash_workspace_text_reply_ids');
 assert.equal(f.pending.length,2+states.filter(s=>s==='awaiting_address').length+(states.includes('complete')?1:0));
 assert(f.maxActive()<=8,'Early page concurrency stays below the existing ten-read attention stage');
 for(const item of f.pending.filter(p=>p.path==='rpc/icash_meta_workspace_response_leads')){
  assert(replyIds.some(row=>row.state==='awaiting_address'&&row.screening_id===item.body.p_screening));assert.equal(item.body.p_limit,1);
 }
 f.finish();const response=await result;assert.equal(response.status,200);assert.deepEqual(response.body.replyOrder,replyIds.map(r=>r.screening_id));
}

// Independent reads may finish in any order. Retain the original reply order,
// distinct inbound/property sources, pagination arguments and exact IDs.
const orderedIds=[{screening_id:id(12),state:'complete'},{screening_id:id(10),state:'awaiting_address'},{screening_id:id(11),state:'complete'}];
const ordered=await fixture({replyIds:orderedIds}),orderedResult=ordered.start('?view=texts&page=2&query=Main');await tick();
assert.deepEqual(ordered.calls[0].body,{p_account:account,p_query:'Main',p_offset:12,p_limit:7,p_unread_only:false});
const property=n=>({id:id(n),state:'complete',completed_at:'2026-11-15T10:00:00Z',result:{property:{propertyId:'prop_'+n,address:n+' Main Street'},financialCheck:{status:'eligible',reason:'Fixture'},preliminarySellerCeilingCents:100000}});
const completeRead=ordered.pending.find(p=>p.path.startsWith('icash_screening_jobs?'));
assert.equal(new URLSearchParams(completeRead.path.split('?')[1]).get('id'),`in.(${id(12)},${id(11)})`);
completeRead.gate.resolve([property(11),property(12)]);
ordered.pending.find(p=>p.path==='rpc/icash_meta_workspace_response_leads').gate.resolve([{screeningId:id(10),leadId:id(20)}]);
ordered.finish();const orderedResponse=await orderedResult;
assert.equal(orderedResponse.status,200);assert.deepEqual(orderedResponse.body.properties.map(p=>p.id),[id(12),id(11)]);assert.deepEqual(orderedResponse.body.instantLeads,[{screeningId:id(10),leadId:id(20)}]);assert.deepEqual(orderedResponse.body.replyOrder,orderedIds.map(r=>r.screening_id));

// No inbound feature means no inbound query, and malformed input never reaches DB.
const disabled=await fixture({enabled:false}),disabledResult=disabled.start('');await tick();assert.equal(disabled.pending.length,3);disabled.finish();assert.equal((await disabledResult).status,200);
for(const query of ['?query=*','?page=-1','?screeningId=invalid']){const f=await fixture();assert.notEqual((await f.start(query)).status,200);assert.equal(f.calls.length,0);}

// Preserve the prior write/read boundary. An owner inspection never passes this
// option; ordinary outcome refresh must finish successfully before page reads.
const refreshed=await fixture({refresh:true}),refreshedResult=refreshed.start('');await tick();assert.equal(refreshed.calls.length,1);refreshed.refreshGate.resolve(null);await tick();assert.equal(refreshed.pending.length,4);refreshed.finish();assert.equal((await refreshedResult).status,200);
const refreshFailure=await fixture({refresh:true}),refreshFailureResult=refreshFailure.start('');await tick();refreshFailure.refreshGate.reject(Error('Unavailable'));assert.equal((await refreshFailureResult).status,503);assert.equal(refreshFailure.calls.length,1);

// Inspect every settled read, retaining failure instead of displaying an empty
// or partial successful page. No dependent metadata read follows a failed stage.
for(let failed=0;failed<4;failed++){
 const f=await fixture(),result=f.start('');let done=false;result.then(()=>{done=true;});await tick();
 f.pending[failed].gate.reject(Error('Unavailable'));await tick();assert.equal(done,false,'All concurrent reads are observed before returning failure');
 f.finish();assert.equal((await result).status,503);assert.equal(f.calls.length,4,'Failed initial reads never start dependent queries');
}
const inboundFailure=await fixture({replyIds:Array.from({length:6},(_,index)=>({screening_id:id(index+30),state:'awaiting_address'}))}),inboundFailureResult=inboundFailure.start('?view=texts');let inboundDone=false;inboundFailureResult.then(()=>{inboundDone=true;});await tick();
inboundFailure.pending.find(p=>p.path==='rpc/icash_meta_workspace_response_leads').gate.reject(Error('Unavailable'));await tick();assert.equal(inboundDone,false);inboundFailure.finish();assert.equal((await inboundFailureResult).status,503);assert.equal(inboundFailure.calls.length,9,'One reply-ID dependency plus eight bounded initial reads, with no dependent metadata after failure');
console.log('PASS workspace page concurrency: unchanged bounded/account-scoped reads; 3 initial database stages become 1; every rejection remains unavailable.');
