import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {enrichOwners} from '../lib/owner-enrichment.ts';
import {runScreeningJob} from '../lib/screening-job.ts';
import * as liveWorkAdmission from '../lib/live-work-admission.ts';

// Exercise the actual service AND reservation code; the specialized claim is modeled here and exercised with real SQL separately; all I/O stays in local fakes.
const accountId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const screeningId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const operationKey=`owners:${accountId}:${screeningId}`;
const rights=new Date(Date.now()+3600000).toISOString();
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date().toISOString(),sellerCostReserveCents:100000,raw:{data:{dm_property_id:'prop_123',full_address:'Fixture',estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:50000}}};
let state;
function reset(){
 state={config:{enabled:true,contacts_enabled:true,contact_rate_id:'rate',contact_credit_cap:25,property_credit_micros:10000,data_rights_until:rights},job:{state:'complete',completed_at:new Date().toISOString(),result:runScreeningJob(snapshot),snapshot:structuredClone(snapshot)},rate:{operation:'owner_enrichment',enabled:true,expires_at:rights,costs_micros:{dealmachine:250000}},manual:false,requests:[],dbCalls:[],observations:[],saved:[],claimed:false,reserved:false,reserveCount:0,paidCount:0,previewCount:0,denyReserve:null,denyClaim:false,denyRateSlot:0,afterPreview:null,beforeFinalClaim:null,previewTransform:null,paidTransform:null,paidError:null,previewError:null,owners:Array.from({length:30},(_,i)=>({dm_person_id:'per_'+i,full_name:'Fixture',is_likely_owner:true,is_in_owner_family:false,is_resident:false,is_likely_renter:false}))};
}
const db=async(path,method,body)=>{
 state.dbCalls.push({path,method,body});
 if(path.startsWith(`icash_discovery_configs?account_id=eq.${accountId}&select=`))return [structuredClone(state.config)];
 if(path.startsWith(`icash_screening_jobs?id=eq.${screeningId}&account_id=eq.${accountId}&select=`))return state.job?[structuredClone(state.job)]:[];
 if(path===`icash_property_controls?account_id=eq.${accountId}&property_id=eq.prop_123&select=manual`)return [{manual:state.manual}];
 if(path.startsWith('icash_operation_rates?id=eq.rate&select='))return [structuredClone(state.rate)];
 if(path==='rpc/icash_take_dealmachine_request'){
  const slots=state.dbCalls.filter(c=>c.path===path).length;
  return slots!==state.denyRateSlot;
 }
 if(path==='rpc/icash_reserve_operation'){
  assert.equal(body.p_account,accountId);assert.equal(body.p_operation,operationKey);assert.equal(body.p_rate,'rate');assert.equal(body.p_permission_until,rights);
  assert(state.previewCount>0,'Free preview must precede paid reservation');
  if(state.denyReserve)throw Error(state.denyReserve);
  state.reserved=true;state.reserveCount++;
  return {operationKey,state:state.claimed?'dispatched':'reserved',reservedMicros:348000};
 }
 if(path==='rpc/icash_claim_owner_enrichment'){
  assert.equal(body.p_account,accountId);assert.equal(body.p_screening,screeningId);assert.equal(body.p_operation,operationKey);
  assert.equal(body.p_rate,'rate');assert.equal(body.p_credit_cap,25);assert.equal(body.p_unit_cost_micros,10000);assert.equal(body.p_quoted_data_cost_micros,250000);assert.equal(body.p_rights_until,rights);
  state.beforeFinalClaim?.();
  if(state.manual||!state.config.enabled||!state.config.contacts_enabled||state.config.data_rights_until!==body.p_rights_until||state.config.contact_credit_cap!==body.p_credit_cap||state.job?.state!=='complete'||JSON.stringify(state.job.snapshot)!==JSON.stringify(body.p_snapshot))return false;
  return db('rpc/icash_claim_operation','POST',{p_operation:body.p_operation});
 }
 if(path==='rpc/icash_claim_operation'){
  assert.equal(body.p_operation,operationKey);assert(state.reserved);
  if(state.claimed||state.denyClaim)return false;
  state.claimed=true;return true;
 }
 if(path==='rpc/icash_record_cost_observation'){
  assert(state.claimed);assert.equal(body.p_provider,'dealmachine');assert.equal(body.p_units,'provider_credits');
  assert(body.p_event.startsWith(operationKey));state.observations.push(body);return null;
 }
 if(path==='rpc/icash_save_contacts'){
  assert(state.claimed);assert.equal(body.p_account,accountId);assert.equal(body.p_screening,screeningId);assert.equal(body.p_operation,operationKey);
  state.saved.push(body.p_result);return null;
 }
 throw Error('Unexpected database request '+path);
};
const transport=async(url,options)=>{
 state.requests.push({url,options});
 assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert(options.signal instanceof AbortSignal);
 assert.equal(options.headers.Authorization,'Bearer dm_sk_live_fixture');
 if(options.method==='GET'){
  assert.equal(url,'https://api.v2.dealmachine.com/v1/properties/prop_123?enrich=false&contact_audience=owners');
  assert.equal(options.body,undefined);state.previewCount++;
  if(state.previewError)throw Error(state.previewError);
  const raw={data:{dm_property_id:'prop_123',contacts:structuredClone(state.owners)},credits:{used:0,people:0,properties:0,deduplicated:0}};
  state.previewTransform?.(raw);state.afterPreview?.();return Response.json(raw);
 }
 assert.equal(options.method,'POST');assert.equal(url,'https://api.v2.dealmachine.com/v1/people/ids');
 assert(state.claimed,'Paid provider access requires an atomic claim');state.paidCount++;
 const body=JSON.parse(options.body);
 assert.deepEqual(Object.keys(body).sort(),['enrich','ids','include_properties']);assert.equal(body.enrich,true);assert.equal(body.include_properties,false);
 assert(body.ids.length>0&&body.ids.length<=state.config.contact_credit_cap&&body.ids.length<=25);assert.equal(new Set(body.ids).size,body.ids.length);
 assert.deepEqual(body.ids,Array.from({length:Math.min(state.owners.length,25)},(_,i)=>'per_'+i));
 if(state.paidError)throw Error(state.paidError);
 const raw={data:body.ids.map((id,i)=>({dm_person_id:id,found:i<2,full_name:'Fixture',phones:[{number:'5555555555',do_not_call:false}],emails:[{address:'fixture@example.com'}]})),totals:{submitted:body.ids.length,found:2,not_found:body.ids.length-2},credits:{used:1,people:2,properties:0,deduplicated:1}};
 state.paidTransform?.(raw);return Response.json(raw);
};
async function loadActual(path,bindings,key){
 globalThis[key]=bindings;
 let source=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .* from .*;$/gm,'');
 source=`const {${Object.keys(bindings).join(',')}}=globalThis.${key};\n`+source;
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
const previous={key:process.env.DEALMACHINE_API_KEY,ready:process.env.ICASH_LIVE_WORK_READY,fetch:globalThis.fetch};
process.env.DEALMACHINE_API_KEY='dm_sk_live_fixture';process.env.ICASH_LIVE_WORK_READY='true';globalThis.fetch=transport;
try{
 const {reserveOperation,dispatchReservedOperation}=await loadActual('../lib/operating-costs.ts',{db,...liveWorkAdmission},'__ownerCostsFixture');
 const {enrichForAccount}=await loadActual('../lib/owner-enrichment-service.ts',{db,enrichOwners,runScreeningJob,reserveOperation,...liveWorkAdmission},'__ownerServiceFixture');
 const run=()=>enrichForAccount(accountId,screeningId);
 reset();assert.equal((await run()).status,'contacts_saved');
 assert.equal(state.paidCount,1);assert.equal(state.previewCount,1);assert.equal(state.observations.length,4);
 const result=state.saved[0];assert.equal(result.propertyId,'prop_123');assert.equal(result.contacts.length,2);assert.equal(result.requestedPersonIds.length,25);
 assert.deepEqual(result.providerCredits,{used:1,people:2,properties:0,deduplicated:1});assert.equal(result.creditsUsed,1);assert.equal(result.outreachAuthorized,false);
 assert.equal(result.contacts[0].phones[0].doNotCall,false);assert.equal(result.contacts[0].phones[0].permission,'unverified');assert.equal(result.contacts[0].ownershipVerified,false);
 assert.deepEqual(state.observations.map(x=>x.p_amount),[1,2,0,1]);
 assert.equal(state.observations[0].p_event,operationKey);assert.equal(state.observations[0].p_source,`dealmachine:owners:${operationKey}`);
 await assert.rejects(run(),/already dispatched/);assert.equal(state.paidCount,1,'Duplicate claim must never replay the paid lookup');

 // Concurrent invocations both preview, but only one reaches the paid endpoint.
 reset();const concurrent=await Promise.allSettled([run(),run()]);assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(state.paidCount,1);

 reset();state.owners=[];assert.equal((await run()).status,'empty');assert.equal(state.reserveCount,0);assert.equal(state.paidCount,0);
 for(const transform of [r=>{delete r.data.contacts[0].dm_person_id;},r=>{r.data.dm_property_id='prop_456';},r=>{r.data.contacts=null;},r=>{r.credits.people=2;}]){
  reset();state.previewTransform=transform;await assert.rejects(run(),/CONTACT_PREVIEW_INVALID/);assert.equal(state.reserveCount,0);assert.equal(state.paidCount,0);
 }
 reset();state.owners.splice(1,0,structuredClone(state.owners[0]));await run();assert.equal(state.saved[0].requestedPersonIds.length,25);assert.equal(new Set(state.saved[0].requestedPersonIds).size,25);

 // Mutable scope cannot change during preview and still reach reserve/claim.
 for(const change of [()=>{state.job.snapshot.propertyId='prop_456';},()=>{state.job.state='held';},()=>{state.job.snapshot.raw.data.estimated_value=999999;},()=>{state.manual=true;},()=>{state.config.contacts_enabled=false;},()=>{state.config.enabled=false;},()=>{state.config.contact_credit_cap=24;},()=>{state.config.property_credit_micros=20000;},()=>{state.config.data_rights_until='invalid';},()=>{state.config.data_rights_until='2000-01-01';}]){
  reset();state.afterPreview=change;assert.equal((await run()).status,'held');assert.equal(state.reserveCount,0);assert.equal(state.paidCount,0);
 }
 for(const change of [()=>{state.manual=true;},()=>{state.config.contacts_enabled=false;},()=>{state.config.data_rights_until='2000-01-01';},()=>{state.job.snapshot.propertyId='prop_456';}]){
  reset();state.beforeFinalClaim=change;await assert.rejects(run(),/already dispatched/);assert.equal(state.paidCount,0);assert.equal(state.claimed,false);assert.equal(state.reserveCount,1);
 }
 for(const deny of ['Insufficient wallet balance','Daily limit reached','Lifetime budget reached']){
  reset();state.denyReserve=deny;await assert.rejects(run(),new RegExp(deny));assert.equal(state.paidCount,0);assert.equal(state.claimed,false);
 }
 reset();state.denyClaim=true;await assert.rejects(run(),/already dispatched/);assert.equal(state.paidCount,0);
 for(const value of [249999,-1,null]){
  reset();state.rate.costs_micros.dealmachine=value;await assert.rejects(run(),/CONTACT_RATE_REQUIRED/);assert.equal(state.previewCount,0);assert.equal(state.paidCount,0);
 }
 for(const mutate of [()=>{state.config.data_rights_until='invalid';},()=>{state.rate.expires_at='invalid';},()=>{state.rate.operation='property_search';},()=>{state.manual=true;},()=>{state.job=null;},()=>{state.config.contacts_enabled=false;}]){
  reset();mutate();await run();assert.equal(state.previewCount,0);assert.equal(state.paidCount,0);
 }
 reset();state.job.snapshot.fetchedAt='2025-01-01';await assert.rejects(run(),/INVALID_SNAPSHOT/);assert.equal(state.previewCount,0);
 reset();delete state.job.snapshot.sellerCostReserveCents;assert.equal((await run()).status,'financial_hold');assert.equal(state.previewCount,0);
 reset();state.job.snapshot.raw.data.dm_property_id='prop_456';await assert.rejects(run(),/PROPERTY_RESPONSE_INVALID/);assert.equal(state.previewCount,0);

 // Timeout and HTTP/response uncertainty retain the claim; next invocation cannot replay.
 reset();state.paidError='timeout';await assert.rejects(run(),/OWNER_LOOKUP_FAILED_NO_RETRY/);assert.equal(state.paidCount,1);assert(state.reserved&&state.claimed);
 await assert.rejects(run(),/already dispatched/);assert.equal(state.paidCount,1);
 reset();state.previewError='timeout';await assert.rejects(run(),/OWNER_PREVIEW_FAILED_NO_RETRY/);assert.equal(state.reserveCount,0);assert.equal(state.paidCount,0);
 reset();state.denyRateSlot=1;await assert.rejects(run(),/PROVIDER_RATE_LIMIT/);assert.equal(state.requests.length,0);assert.equal(state.reserveCount,0);
 reset();state.denyRateSlot=2;await assert.rejects(run(),/PROVIDER_RATE_LIMIT/);assert.equal(state.requests.length,1);assert(state.claimed);assert.equal(state.paidCount,0);
 for(const mutate of [r=>{r.data[0].dm_person_id='per_unexpected';},r=>{r.credits.used=26;r.credits.people=26;},r=>{r.credits.properties=1;},r=>{r.data[0].properties=[{dm_property_id:'prop_456'}];}]){
  reset();state.paidTransform=mutate;await assert.rejects(run(),/CONTACT_RECEIPT_REQUIRES_RECONCILIATION/);
  assert.equal(state.paidCount,1);assert.equal(state.saved.length,0);assert.equal(state.observations.length,4);assert(state.claimed);
  if(state.observations[0].p_amount===26)assert.equal(state.observations[1].p_amount,26,'Overrun receipt stays visible');
  await assert.rejects(run(),/already dispatched/);assert.equal(state.paidCount,1);
 }
 reset();process.env.ICASH_LIVE_WORK_READY='false';delete process.env.ICASH_CONTACT_WORK_READY;assert.equal((await run()).status,'live_work_not_ready');assert.equal(state.dbCalls.length,0);assert.equal(state.paidCount,0);
 process.env.ICASH_CONTACT_WORK_READY='true';reset();assert.equal((await run()).status,'contacts_saved');assert.equal(state.paidCount,1);assert.equal(state.reserveCount,1);
 const input={accountId,screeningId,operationKey,rateId:'rate',permissionUntil:rights,operation:'owner_enrichment'};
 await assert.rejects(()=>dispatchReservedOperation(input,async()=>{throw Error('Generic dispatch must never send contacts');}),/atomic screening claim/);
 for(const patch of [{operation:undefined},{operation:'property_search'},{screeningId:undefined},{operationKey:'owners:another-account:another-screening'},{rateId:'other-rate'}]){reset();await assert.rejects(()=>reserveOperation({...input,...patch}));assert.equal(state.reserveCount,0);}
 reset();state.job.result.financialCheck.status='hold';await assert.rejects(()=>reserveOperation(input),/Owned eligible screening/);assert.equal(state.reserveCount,0);
 delete process.env.ICASH_CONTACT_WORK_READY;
}finally{
 globalThis.fetch=previous.fetch;
 if(previous.key===undefined)delete process.env.DEALMACHINE_API_KEY;else process.env.DEALMACHINE_API_KEY=previous.key;
 if(previous.ready===undefined)delete process.env.ICASH_LIVE_WORK_READY;else process.env.ICASH_LIVE_WORK_READY=previous.ready;
 delete globalThis.__ownerCostsFixture;delete globalThis.__ownerServiceFixture;
}
console.log('Actual owner service + reservation with final contact claim: bounded request, tenant/snapshot/rights/manual gates, claim races, budget refusals, wrong quote, immutable cost evidence and uncertain no-retry passed.');
