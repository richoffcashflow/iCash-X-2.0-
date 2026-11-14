import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHmac,createHash,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {smsLength} from '../lib/sms-length.ts';
import {hashLeadToken,instantLeadToken,instantAddressLink,instantLeadInitialText,instantAddress,validInstantLeadToken} from '../lib/meta-instant-leads.ts';

// Actual service, fictional database/provider boundaries. No paid requests.
const env={META_INSTANT_LEADS_ENABLED:'true',VERCEL_ENV:'production',META_LEAD_LINK_SECRET:'fixture-secret-'+ 'x'.repeat(40),META_GRAPH_VERSION:'v26.0'};
const submitted=new Date().toISOString();
const lead=n=>({lead_id:'lead-'+n,account_id:'account-'+n,screening_id:'screen-'+n,meta_id:String(10000+n),submitted_at:submitted,link_hash:hashLeadToken(instantLeadToken(String(10000+n),submitted,env.META_LEAD_LINK_SECRET)),link_expires_at:new Date(Date.now()+86400000).toISOString(),paused:false,declined_at:null,offer_ready_at:null,lead:{state:'received',name:'Fixture',phone:'+12125550123',address:'Fixture address'}});
let fault,actions,patches,logs,measurementFinished,waitStep,waitFor;
const fail=step=>{actions.push(step);if(fault===step)throw Error('private fixture failure');};
function reset(value){fault=value;actions=[];patches=[];logs=[];measurementFinished=0;}
const service=await loadService('lib/meta-instant-lead-service.ts',{
 createHmac,smsLength,hashLeadToken,instantLeadToken,instantAddressLink,instantLeadInitialText,
 metaLeadAccessToken:()=> 'fixture-token',parseMetaLead:()=>({metaId:'10001',submittedAt:submitted}),
 processSellerIntake:async(_db,_key,_fetch,id)=>{fail('research:'+id);if(waitStep==='research')await waitFor;return {status:'property_checked'};},
 processMakeLead:async()=>{fail('make');return {status:'idle'};},
 deliverInstantCrmEvent:async()=>{await new Promise(r=>setImmediate(r));measurementFinished++;return {status:'idle'};},
 console:{warn:(...x)=>logs.push(x)},
});
function dependencies({completion=false,retrieve=false}={}){
 return {env,fetch:async()=>Response.json({id:'fixture'}),
 sms:async(_account,message)=>{fail('sms:'+message);return {status:'message_accepted'};},
 voice:async(_account,job)=>{fail('voice:'+job);return {status:'call_started'};},
 db:async(path,method='GET',body)=>{
  if(path==='rpc/icash_meta_claim_notice'){fail('notice');return retrieve?{metaId:'1',sourceId:'source',notice:{},token:'claim'}:null;}
  if(path.startsWith('icash_meta_lead_sources?'))return [{enabled:true,page_id:'page'}];
  if(path==='rpc/icash_meta_accept_lead'){fail('accept');return {leadId:'lead-1',accountId:'account-1'};}
  if(path.startsWith('icash_meta_lead_inbox?')){patches.push(body);fail('inbox:'+body.state);return [];}
  if(path.startsWith('icash_meta_leads?')&&method==='PATCH'){const id=new URLSearchParams(path.split('?')[1]).get('lead_id').slice(3);fail('lease:'+id);patches.push(body);return [];}
  if(path.startsWith('icash_meta_leads?paused=')){fail('due');return [1,2,3].map(n=>({lead_id:'lead-'+n}));}
  if(path.startsWith('icash_meta_leads?lead_id=')){const id=new URLSearchParams(path.split('?')[1]).get('lead_id').slice(3);fail('read:'+id);return [lead(Number(id.split('-')[1]))];}
  if(path==='rpc/icash_meta_assign_contact'){fail('assign:'+body.p_lead);return {status:'assigned'};}
  if(path==='rpc/icash_meta_match_address_request'){fail('match:'+body.p_lead);if(waitStep==='match')await waitFor;return completion;}
  if(path.startsWith('icash_customer_identities?'))return [{principal:'Fixture buyer'}];
  if(path==='rpc/icash_meta_queue_message'){fail('queue:'+body.p_purpose+':'+body.p_lead);return body.p_purpose+':'+body.p_lead;}
  if(path.startsWith('icash_text_messages?'))return [{state:'ready',provider_id:null}];
  if(path==='rpc/icash_meta_prepare_voice'){fail('prepare:'+body.p_lead);return {accountId:'account-'+body.p_lead.split('-')[1],voiceJobId:body.p_lead};}
  if(path==='rpc/icash_meta_promote_property')return {status:'property_ready'};
  if(path==='rpc/icash_meta_prepare_followups'){fail('followups:'+body.p_lead);return null;}
  if(path==='rpc/icash_meta_offer_followup'){fail('offer:'+body.p_lead);return {accountId:'account-'+body.p_lead.split('-')[1],voiceJobId:'offer:'+body.p_lead};}
  throw Error('Unexpected fixture database boundary '+path);
 }};
}

await test('completion lookup and link failures cannot suppress independent first contact',async()=>{
 for(const step of ['match:lead-1','queue:address_link:lead-1','sms:address_link:lead-1']){
  reset(step);const result=await service.processInstantLead(dependencies({completion:true}),'lead-1');
  assert.equal(result.voice,'call_started');assert(actions.includes('sms:initial:lead-1'));
  assert.equal(actions.filter(x=>x==='voice:lead-1').length,1);assert(result.failures>0);
 }
});

await test('accepted intake remains accepted when immediate follow-through fails',async()=>{
 reset('assign:lead-1');const result=await service.retrieveInstantLead(dependencies({retrieve:true}));
 assert.equal(result.status,'accepted');assert.equal(result.work,'pending');
 assert.deepEqual(patches.map(p=>p.state),['accepted'],'A saved accepted receipt must not be reset to pending');
 assert.equal(actions.filter(x=>x==='accept').length,1);
});

await test('failed Graph retrieval closes the unused body and keeps intake retryable',async()=>{
 reset(null);let cancelled=0;
 const d={...dependencies({retrieve:true}),fetch:async()=>new Response(new ReadableStream({cancel(){cancelled++;}},{highWaterMark:0}),{status:503})};
 assert.equal((await service.retrieveInstantLead(d)).status,'retry_pending');assert.equal(cancelled,1);
 assert.deepEqual(patches.map(p=>p.state),['pending']);assert(!actions.includes('accept'));
});

await test('oversized Graph responses stop reading at the receipt limit',async()=>{
 for(const declared of [false,true]){
  reset(null);let reads=0,cancelled=0;
  const d={...dependencies({retrieve:true}),fetch:async()=>new Response(new ReadableStream({pull(controller){if(reads++===10){controller.close();return;}controller.enqueue(new Uint8Array(16000));},cancel(){cancelled++;}},{highWaterMark:0}),{headers:declared?{'Content-Length':'160000'}:{}})};
  assert.equal((await service.retrieveInstantLead(d)).status,'retry_pending');
  assert.equal(reads,declared?0:5);assert.equal(cancelled,1);assert(!actions.includes('accept'));
  assert.equal(patches.at(-1).reason,'META_RECEIPT_TOO_LARGE');
 }
});

await test('slow research and address matching do not delay initial contact',async()=>{
 for(const step of ['research','match']){
  reset(null);waitStep=step;let release;waitFor=new Promise(r=>{release=r;});
  const task=step==='research'?service.processInstantLeadWork(dependencies()):service.processInstantLead(dependencies(),'lead-1');
  try{await new Promise(r=>setImmediate(r));assert(actions.includes('voice:lead-1'),step+' blocked first call');}
  finally{release();await task;waitStep=undefined;waitFor=undefined;}
 }
});

await test('lost acceptance acknowledgments cannot downgrade either transport receipt',async()=>{
 const make=await loadService('lib/meta-make-intake.ts',{z,createHash,timingSafeEqual,hashLeadToken,instantLeadToken,metaId:z.string(),parseMetaLead:()=>({metaId:'10001',submittedAt:submitted}),console:{warn:()=>{}}});
 for(const transport of ['graph','make']){
  reset(null);const d=dependencies({retrieve:true});const original=d.db;let state='claimed',accepts=0;
  d.db=async(path,method,body)=>{
   if(path==='rpc/icash_make_claim_lead')return {metaId:'10001',sourceId:'source',token:'claim',isTest:false,payload:{id:'10001',page_id:'page',form_id:'form',created_time:submitted}};
   if(path==='rpc/icash_meta_accept_lead')accepts++;
   if(path.startsWith('icash_meta_lead_inbox?')||path.startsWith('icash_make_lead_inbox?')){
    if(body.state==='accepted'){state='accepted';throw Error('Fixture lost write acknowledgment');}
    if(!path.includes('state=neq.accepted')||state!=='accepted')state=body.state;
    return [];
   }
   return original(path,method,body);
  };
  await (transport==='graph'?service.retrieveInstantLead(d):make.processMakeLead({...d,onAccepted:async()=>{throw Error('Must not run on lost acknowledgment');}}));
  assert.equal(state,'accepted',transport);assert.equal(accepts,1);
 }
});

await test('invalid or expired address links cannot queue a message',async()=>{
 for(const expiry of ['not-a-date','',new Date(Date.now()-1).toISOString()]){
  reset(null);assert.equal((await service.queueInstantAddressLink(dependencies(),{...lead(1),link_expires_at:expiry},'address_link','completion')).status,'link_expired');assert.deepEqual(actions,[]);
 }
 for(const overrides of [{paused:true},{declined_at:submitted},{account_id:null},{screening_id:null}]){
  reset(null);assert.equal((await service.queueInstantAddressLink(dependencies(),{...lead(1),...overrides},'initial','initial')).status,'held');assert.deepEqual(actions,[]);
 }
});

await test('saved address response schedules contact even when property research fails',async()=>{
 const oldSecret=process.env.META_LEAD_LINK_SECRET;process.env.META_LEAD_LINK_SECRET=env.META_LEAD_LINK_SECRET;
 let continuation,contacts=0,saves=0,origin=true;
 const route=await loadService('app/api/seller/instant-address/route.ts',{
  z,instantAddress,validInstantLeadToken,hashLeadToken,sellerPhone:value=>value,
  after:work=>{continuation=work;},allowedOrigin:()=>origin,instantLeadsEnabled:()=>true,limitRequest:async()=>{},
  db:async path=>{if(path==='rpc/icash_meta_address_session')return {leadId:'lead-1'};if(path==='rpc/icash_meta_save_address'){saves++;return {status:'saved'};}throw Error('Unexpected fixture boundary');},
  researchInstantAddress:async()=>{throw Error('Fixture lookup unavailable');},
  processInstantLead:async()=>{contacts++;return {status:'processed'};},
  dispatchTextMessage:()=>{},dispatchLiveVoice:()=>{},console:{warn:()=>{}},
 });
 const request=()=>new Request('https://www.geticashx.com/api/seller/instant-address',{method:'POST',body:JSON.stringify({action:'save',token:instantLeadToken('10001',submitted,env.META_LEAD_LINK_SECRET),address:'123 Fixture Street, Dallas, TX 75217'})});
 try{
  assert.equal((await route.POST(request())).status,200);assert.equal(saves,1);assert(continuation);
  await continuation();assert.equal(contacts,1);
  origin=false;continuation=null;assert.equal((await route.POST(request())).status,403);assert.equal(saves,1);assert.equal(continuation,null);
 }finally{if(oldSecret===undefined)delete process.env.META_LEAD_LINK_SECRET;else process.env.META_LEAD_LINK_SECRET=oldSecret;}
});

await test('one failure does not strand other leads or independent work for the same lead',async()=>{
 const stages=['notice','make','lease','read','research','assign','match','prepare','followups','offer','voice:offer'];
 for(const position of [1,2,3])for(const stage of stages){
  const step=['notice','make'].includes(stage)?stage:stage+':lead-'+position;
  reset(step);const result=await service.processInstantLeadWork(dependencies());
  assert.equal(result.status,'pending',step);assert(result.failures>0,step);
  assert.equal(measurementFinished,3,'Every launched measurement is awaited');
  for(const n of [1,2,3].filter(n=>n!==position))assert(actions.includes('voice:lead-'+n),step+' cannot suppress lead '+n);
  if(stage==='research')assert(actions.includes('voice:lead-'+position),'Research and initial contact are independent');
  if(stage==='assign')assert(actions.includes('offer:lead-'+position),'Offer admission still performs its own current checks');
  assert(logs.every(row=>!JSON.stringify(row).includes('private fixture failure')),'Operator logs redact error payloads');
 }
});

await test('follow-up holds and returned transport failures are not reported as processed',async()=>{
 for(const status of ['message_held','message_delivery_needs_review','business_number_mismatch','provider_outcome_unknown_no_retry']){
  let messages=0,calls=0;
  const result=await service.processInstantFollowups({env,db:async()=>({accountId:'fixture-account',messageIds:['fixture-message'],voiceJobId:'fixture-call'}),sms:async()=>{messages++;return {status};},voice:async()=>{calls++;return {status:'call_started'};}},'fixture-lead');
  assert.equal(result.status,'pending',status);assert.equal(messages,1);assert.equal(calls,1);
 }
});

await test('unchanged successful and disabled paths retain their bounded work',async()=>{
 reset(null);const result=await service.processInstantLeadWork(dependencies());
 assert.equal(result.status,'processed');assert.equal(result.failures,0);assert.equal(measurementFinished,3);
 assert.equal(actions.filter(x=>/^voice:lead-/.test(x)).length,3);
 reset(null);assert.equal((await service.processInstantLeadWork({...dependencies(),env:{...env,VERCEL_ENV:'preview'}})).status,'disabled');assert.deepEqual(actions,[]);
});
